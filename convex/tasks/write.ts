import { ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { validateStringLength, type AuthContext } from "../lib/auth";
import { assertValidDateString } from "../lib/dateValidation";
import {
  cascadeDeleteTaskData,
  resolveDefaultAssignee,
  validateAssignees,
  validateWorkCategory,
} from "../lib/task_helpers";
import { autoSaveTimersForTasks } from "../lib/timerEntry";
import {
  diffMentionIds,
  extractMentionIds,
  safeParseDoc,
  truncatePreview,
} from "../lib/notificationEvents";
import { extractPlainText } from "../../lib/tiptap-utils";
import { logActivity } from "../activityLog";
import { createNotifications } from "../notifications";
import {
  assertCanArchive,
  assertCanChangeAssignees,
  assertCanDelete,
  assertCanEditFields,
  loadTaskForWrite,
  type TaskAccess,
  type TaskField,
} from "./access";
import { onSubtaskChange } from "./derived";
import {
  DEFAULT_ORG_TASK_KEY,
  EXTERNAL_REFS_PER_TASK_MAX,
  PRIORITY,
  categoryOfStatus,
  compareBySortKey,
  completedAtAfterTransition,
  deriveIdentifierKey,
  formatIdentifier,
  hasDescriptionContent,
  isValidIdentifierKey,
  numberScopeFor,
  sameNumberScope,
  uniqueIdentifierKey,
  type ActivityEvent,
  type ActivityVia,
  type NumberScope,
  type TaskCategory,
  type TaskPriority,
} from "./model";

/**
 * THE task write path (docs/prd-tasks-refactor.md §5.1, invariants T2–T6, T8).
 *
 * This module is the only code that inserts, patches or deletes rows of
 * `tasks`, `taskAssignees`, `taskLabels` and `taskIdentifierAliases`
 * (enforced by convex/__tests__/tasksWrite.test.ts). Public mutations,
 * the Planner, seeds and maintenance scripts call the functions below; the
 * access decision comes from `access.ts` (callers pass a `TaskAccess` or an
 * `AuthContext`, never a client-supplied org or role).
 *
 * Maintained here:
 * - T3 `statusCategory` = the status's category (`categoryOfStatus`).
 * - T4 `completedAt` via `completedAtAfterTransition`.
 * - T5 identifiers: allocated from `projects.nextTaskNumber` /
 *   `orgSettings.taskKey + nextTaskNumber` in the same mutation; a project
 *   move renumbers and aliases the old identifier; a project-code rename
 *   rewrites identifiers and aliases the old ones. A live identifier never
 *   equals an alias (allocation skips numbers whose identifier is an alias;
 *   a rename drops aliases its new identifiers shadow).
 * - T6 `assigneeIds` / `labelIds` caches == edge rows (full reconcile on
 *   every change); counters via `derived.ts`.
 * - T8 one-level sub-tasks that share the parent's project/client; archive
 *   and restore cascade from the parent.
 */

const TITLE_MAX_LENGTH = 500;

type TaskDocFields = Omit<Doc<"tasks">, "_id" | "_creationTime">;
type TaskPatchFields = Partial<TaskDocFields>;

/** Derived fields only `derived.ts` decides (§5.5). */
export type DerivedFields = Partial<
  Pick<
    Doc<"tasks">,
    | "trackedMinutes"
    | "commentCount"
    | "lastCommentAt"
    | "subtaskCount"
    | "subtaskDoneCount"
    | "lastActivityAt"
    | "lastActivity"
  >
>;

/** The single primitive `derived.ts` writes through. Never bumps `updatedAt`. */
export async function patchDerivedFields(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  fields: DerivedFields,
): Promise<void> {
  await ctx.db.patch(taskId, fields);
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((x) => setB.has(x));
}

function normalizeTitle(raw: string, label: string): string {
  const title = raw.trim();
  if (!title) throw new ConvexError(`${label} is required`);
  validateStringLength(title, TITLE_MAX_LENGTH, label);
  return title;
}

function normalizeDescription(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

function normalizeDate(raw: string | null | undefined, label: string): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  assertValidDateString(raw, label);
  return raw;
}

function normalizeEstimate(raw: number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw < 0) throw new ConvexError("Estimate must be zero or more minutes");
  return raw;
}

// ─── Reference data ──────────────────────────────────────────────────────────

export type ResolvedStatus = { status: Doc<"statuses">; category: TaskCategory };

/** A status a task may move into: the org's, and not archived (archived statuses stay only on tasks that had them). */
async function loadStatus(
  ctx: MutationCtx,
  orgId: string,
  statusId: Id<"statuses">,
): Promise<ResolvedStatus> {
  const status = await ctx.db.get(statusId);
  if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
  if (status.archivedAt) throw new ConvexError(`The status "${status.name}" is archived`);
  return { status, category: categoryOfStatus(status) };
}

/**
 * The default status of the first of `categories` the org has an active
 * status in: the one flagged `isDefault`, else the first by position.
 */
export async function defaultStatusFor(
  ctx: MutationCtx,
  orgId: string,
  categories: readonly TaskCategory[],
): Promise<ResolvedStatus> {
  for (const category of categories) {
    const inCategory = await ctx.db
      .query("statuses")
      .withIndex("by_orgId_category_position", (q) => q.eq("orgId", orgId).eq("category", category))
      .take(100);
    const active = inCategory.filter((s) => !s.archivedAt);
    const status = active.find((s) => s.isDefault === true) ?? active[0];
    if (status) return { status, category };
  }
  throw new ConvexError(`No ${categories[0]} status found for org`);
}

/** The status fields of a task entering `next` (T3, T4). */
function statusFields(
  next: ResolvedStatus,
  prev: { statusCategory?: TaskCategory; completedAt?: number } | undefined,
  now: number,
): Pick<TaskDocFields, "statusId" | "statusCategory" | "completedAt"> {
  return {
    statusId: next.status._id,
    statusCategory: next.category,
    completedAt: completedAtAfterTransition({
      prevCategory: prev?.statusCategory,
      nextCategory: next.category,
      prevCompletedAt: prev?.completedAt,
      now,
    }),
  };
}

async function currentCategory(ctx: MutationCtx, task: Doc<"tasks">): Promise<TaskCategory | undefined> {
  if (task.statusCategory) return task.statusCategory;
  const status = await ctx.db.get(task.statusId);
  return status ? categoryOfStatus(status) : undefined;
}

async function loadProject(
  ctx: MutationCtx,
  orgId: string,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
  return project;
}

async function loadLabels(
  ctx: MutationCtx,
  orgId: string,
  labelIds: readonly Id<"labels">[],
): Promise<Doc<"labels">[]> {
  const labels: Doc<"labels">[] = [];
  for (const id of unique(labelIds)) {
    const label = await ctx.db.get(id);
    if (!label || label.orgId !== orgId || label.archivedAt) throw new ConvexError("Label not found");
    labels.push(label);
  }
  return labels;
}

async function childrenOf(ctx: MutationCtx, task: Doc<"tasks">): Promise<Doc<"tasks">[]> {
  return await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .collect();
}

async function userName(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  return (await ctx.db.get(userId))?.name ?? "Unknown";
}

// ─── Identifiers (T5) ────────────────────────────────────────────────────────

async function identifierTaken(ctx: MutationCtx, orgId: string, identifier: string): Promise<boolean> {
  const task = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
    .first();
  if (task) return true;
  const alias = await ctx.db
    .query("taskIdentifierAliases")
    .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
    .first();
  return alias !== null;
}

/** Keeps `identifier` resolving to `taskId` after it changed (no duplicate rows). */
export async function addIdentifierAlias(
  ctx: MutationCtx,
  orgId: string,
  identifier: string,
  taskId: Id<"tasks">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("taskIdentifierAliases")
    .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
    .collect();
  if (existing.some((a) => a.taskId === taskId)) return false;
  for (const stale of existing) await ctx.db.delete(stale._id);
  await ctx.db.insert("taskIdentifierAliases", { orgId, identifier, taskId });
  return true;
}

/** Drops aliases equal to a live identifier (a rename made it live again). */
async function dropShadowedAliases(ctx: MutationCtx, orgId: string, identifier: string): Promise<void> {
  const aliases = await ctx.db
    .query("taskIdentifierAliases")
    .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
    .collect();
  for (const alias of aliases) await ctx.db.delete(alias._id);
}

async function projectCodeInUse(ctx: MutationCtx, orgId: string, code: string): Promise<boolean> {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_orgId_code", (q) => q.eq("orgId", orgId).eq("code", code))
    .first();
  return project !== null;
}

/**
 * The org's identifier key (D2 fallback for tasks without a project). Set
 * lazily from the brand name on first use, avoiding every project code.
 */
async function ensureOrgTaskKey(ctx: MutationCtx, settings: Doc<"orgSettings">): Promise<string> {
  if (settings.taskKey && isValidIdentifierKey(settings.taskKey)) return settings.taskKey;
  const used = new Set<string>();
  let key = deriveIdentifierKey(settings.brandName);
  while (await projectCodeInUse(ctx, settings.orgId, key)) {
    used.add(key);
    key = uniqueIdentifierKey([deriveIdentifierKey(settings.brandName)], used);
  }
  await ctx.db.patch(settings._id, { taskKey: key, updatedAt: Date.now() });
  return key;
}

async function maxNumberInScope(ctx: MutationCtx, orgId: string, scope: NumberScope): Promise<number> {
  const projectId = scope.kind === "project" ? scope.projectId : undefined;
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .collect();
  let max = 0;
  for (const t of tasks) {
    if (t.number !== undefined && sameNumberScope(t.numberScope, scope)) max = Math.max(max, t.number);
  }
  return max;
}

/**
 * Allocates the next number in a scope and bumps its counter. Every task has
 * an identifier (T5): project codes are validated on create/rename, and the
 * legacy `PRJ-042` style codes were recoded by the dev cleanup.
 */
async function allocateNumber(
  ctx: MutationCtx,
  orgId: string,
  scope: NumberScope,
): Promise<{ number: number; identifier: string }> {
  let key: string;
  let counter: number | undefined;
  let commit: (next: number) => Promise<void> = async () => {};
  if (scope.kind === "project") {
    const project = await loadProject(ctx, orgId, scope.projectId);
    if (!isValidIdentifierKey(project.code)) {
      throw new ConvexError(`The project code "${project.code}" can't number tasks. Rename it in the project's settings.`);
    }
    key = project.code;
    counter = project.nextTaskNumber;
    commit = async (next) => await ctx.db.patch(project._id, { nextTaskNumber: next });
  } else {
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (settings) {
      key = await ensureOrgTaskKey(ctx, settings);
      counter = settings.nextTaskNumber;
      commit = async (next) => await ctx.db.patch(settings._id, { nextTaskNumber: next });
    } else {
      key = DEFAULT_ORG_TASK_KEY;
    }
  }
  let number = counter ?? (await maxNumberInScope(ctx, orgId, scope)) + 1;
  while (await identifierTaken(ctx, orgId, formatIdentifier(key, number))) number++;
  await commit(number + 1);
  return { number, identifier: formatIdentifier(key, number) };
}

/**
 * Moves a task (and, for a parent, its sub-tasks — T8) into the scope of
 * `project` (null = org): new number + identifier there, the old identifier
 * becomes an alias, `clientId` follows the project.
 */
async function moveToProject(
  ctx: MutationCtx,
  auth: AuthContext,
  task: Doc<"tasks">,
  project: Doc<"projects"> | null,
  now: number,
): Promise<void> {
  const scope = numberScopeFor(project?._id);
  for (const t of [task, ...(await childrenOf(ctx, task))]) {
    const { number, identifier } = await allocateNumber(ctx, task.orgId, scope);
    await ctx.db.patch(t._id, {
      projectId: project?._id,
      clientId: project?.clientId,
      numberScope: scope,
      number,
      identifier,
      updatedAt: now,
    });
    if (t.identifier && t.identifier !== identifier) {
      await addIdentifierAlias(ctx, task.orgId, t.identifier, t._id);
    }
    if (identifier !== t.identifier) {
      await logActivity(ctx, {
        taskId: t._id,
        orgId: task.orgId,
        userId: auth.userId,
        via: auth.via,
        type: "identifier_changed",
        metadata: { from: t.identifier ?? null, to: identifier, reason: "project_move" },
      });
    }
  }
}

/**
 * A project's code changed (§11.1): every task numbered in the project gets
 * `NEWCODE-n`, the old identifier becomes an alias. Tasks the old paths
 * created without a number get one now. Caller validates `newCode`.
 * `via` attributes the activity rows to an agent write (docs/prd-mcp.md D15).
 */
export async function rewriteProjectIdentifiers(
  ctx: MutationCtx,
  actorId: Id<"users">,
  project: Doc<"projects">,
  newCode: string,
  via?: ActivityVia,
): Promise<{ rewritten: number }> {
  if (!isValidIdentifierKey(newCode)) throw new ConvexError(`Invalid project code: ${newCode}`);
  const scope = numberScopeFor(project._id);
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", project.orgId).eq("projectId", project._id))
    .collect();
  const ordered = [...tasks].sort((a, b) => a.createdAt - b.createdAt);
  const used = new Set<number>();
  for (const t of ordered) {
    if (t.number !== undefined && sameNumberScope(t.numberScope, scope)) used.add(t.number);
  }
  let next = Math.max(project.nextTaskNumber ?? 1, used.size > 0 ? Math.max(...used) + 1 : 1);
  const now = Date.now();
  let rewritten = 0;
  for (const t of ordered) {
    let number = t.number;
    if (number === undefined || !sameNumberScope(t.numberScope, scope)) number = next++;
    const identifier = formatIdentifier(newCode, number);
    if (identifier === t.identifier && t.number === number) continue;
    await dropShadowedAliases(ctx, project.orgId, identifier);
    await ctx.db.patch(t._id, { identifier, number, numberScope: scope, updatedAt: now });
    if (t.identifier && t.identifier !== identifier) {
      await addIdentifierAlias(ctx, project.orgId, t.identifier, t._id);
    }
    await logActivity(ctx, {
      taskId: t._id,
      orgId: project.orgId,
      userId: actorId,
      via,
      type: "identifier_changed",
      metadata: { from: t.identifier ?? null, to: identifier, reason: "code_rename" },
    });
    rewritten++;
  }
  if (project.nextTaskNumber !== next) await ctx.db.patch(project._id, { nextTaskNumber: next });
  return { rewritten };
}

// ─── Sort keys ───────────────────────────────────────────────────────────────

/** A key after every existing `sortKey` in the org (one global manual order). */
async function sortKeyAtEnd(ctx: MutationCtx, orgId: string): Promise<string> {
  const last = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_sortKey", (q) => q.eq("orgId", orgId))
    .order("desc")
    .first();
  return generateKeyBetween(last?.sortKey ?? null, null);
}

/** A key right after `task` in manual order (between it and its next neighbour). */
async function sortKeyAfter(ctx: MutationCtx, task: Doc<"tasks">): Promise<string> {
  const key = task.sortKey;
  if (!key) return await sortKeyAtEnd(ctx, task.orgId);
  const next = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_sortKey", (q) => q.eq("orgId", task.orgId).gt("sortKey", key))
    .first();
  return generateKeyBetween(key, next?.sortKey ?? null);
}

// ─── Edges (T6) ──────────────────────────────────────────────────────────────

/**
 * Reconciles `taskAssignees` to exactly `next` (drops duplicates, extras and
 * other-org rows) and writes the `assigneeIds` cache.
 */
export async function syncAssigneeEdges(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  next: readonly Id<"users">[],
  by: { actorId: Id<"users">; at: number },
): Promise<{ inserted: number; deleted: number }> {
  const wanted = unique(next);
  const edges = await ctx.db
    .query("taskAssignees")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", task._id))
    .collect();
  const kept = new Set<Id<"users">>();
  let deleted = 0;
  let inserted = 0;
  for (const edge of edges) {
    if (wanted.includes(edge.userId) && !kept.has(edge.userId) && edge.orgId === task.orgId) {
      kept.add(edge.userId);
    } else {
      await ctx.db.delete(edge._id);
      deleted++;
    }
  }
  for (const userId of wanted) {
    if (kept.has(userId)) continue;
    await ctx.db.insert("taskAssignees", {
      orgId: task.orgId,
      taskId: task._id,
      userId,
      assignedAt: by.at,
      assignedBy: by.actorId,
    });
    inserted++;
  }
  if (task.assigneeIds.length !== wanted.length || task.assigneeIds.some((id, i) => id !== wanted[i])) {
    await ctx.db.patch(task._id, { assigneeIds: wanted });
  }
  return { inserted, deleted };
}

/** Reconciles `taskLabels` to exactly `next` and writes the `labelIds` cache. */
export async function syncLabelEdges(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  next: readonly Id<"labels">[],
): Promise<{ inserted: number; deleted: number }> {
  const wanted = unique(next);
  const edges = await ctx.db
    .query("taskLabels")
    .withIndex("by_taskId_labelId", (q) => q.eq("taskId", task._id))
    .collect();
  const kept = new Set<Id<"labels">>();
  let deleted = 0;
  let inserted = 0;
  for (const edge of edges) {
    if (wanted.includes(edge.labelId) && !kept.has(edge.labelId) && edge.orgId === task.orgId) {
      kept.add(edge.labelId);
    } else {
      await ctx.db.delete(edge._id);
      deleted++;
    }
  }
  for (const labelId of wanted) {
    if (kept.has(labelId)) continue;
    await ctx.db.insert("taskLabels", { orgId: task.orgId, taskId: task._id, labelId });
    inserted++;
  }
  const cache = task.labelIds ?? [];
  if (cache.length !== wanted.length || cache.some((id, i) => id !== wanted[i])) {
    await ctx.db.patch(task._id, { labelIds: wanted });
  }
  return { inserted, deleted };
}

/** Deletes the edge rows of a hard-deleted task (seed sweep). */
export async function deleteOrphanEdges(
  ctx: MutationCtx,
  orgId: string,
  liveTaskIds: ReadonlySet<Id<"tasks">>,
): Promise<number> {
  let deleted = 0;
  const assigneeEdges = await ctx.db
    .query("taskAssignees")
    .withIndex("by_orgId_userId_taskId", (q) => q.eq("orgId", orgId))
    .collect();
  const labelEdges = await ctx.db
    .query("taskLabels")
    .withIndex("by_orgId_labelId", (q) => q.eq("orgId", orgId))
    .collect();
  for (const edge of [...assigneeEdges, ...labelEdges]) {
    if (!liveTaskIds.has(edge.taskId)) {
      await ctx.db.delete(edge._id);
      deleted++;
    }
  }
  return deleted;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export type CreateTaskInput = {
  title: string;
  description?: string;
  /** Explicit status; else the default status of the first of `defaultCategories` (default: backlog). */
  statusId?: Id<"statuses">;
  defaultCategories?: readonly TaskCategory[];
  projectId?: Id<"projects">;
  /** Creates a sub-task (T8): one level, the parent's project/client. */
  parentTaskId?: Id<"tasks">;
  /** Omitted = not specified (sub-tasks inherit the parent's). */
  assigneeIds?: Id<"users">[];
  workCategoryId?: Id<"workCategories">;
  billable?: boolean;
  estimateMinutes?: number;
  dueDate?: string;
  startDate?: string;
  priority?: TaskPriority;
  labelIds?: Id<"labels">[];
};

export type CreateTaskOptions = {
  /** Use the project's default assignee for the work category when the task would have none. */
  defaultAssignee?: boolean;
  /** Seeds: historical timestamp for createdAt/updatedAt/activity. */
  now?: number;
  duplicatedFrom?: Doc<"tasks">;
  /** Default true: notify assignees and description mentions. */
  notify?: boolean;
};

/**
 * THE create path (all five entry points call it). A member is always
 * assigned to what they create (§5.3). Sub-task creation requires write
 * access to the parent.
 */
export async function createTask(
  ctx: MutationCtx,
  auth: AuthContext,
  input: CreateTaskInput,
  options: CreateTaskOptions = {},
): Promise<Id<"tasks">> {
  const { orgId, userId } = auth;
  const now = options.now ?? Date.now();
  const title = normalizeTitle(input.title, input.parentTaskId ? "Subtask title" : "Task title");
  const description = normalizeDescription(input.description);

  let parent: Doc<"tasks"> | undefined;
  if (input.parentTaskId) {
    const parentAccess = await loadTaskForWrite(ctx, input.parentTaskId, auth);
    assertCanEditFields(parentAccess, ["subtasks"]);
    parent = parentAccess.task;
    if (parent.parentTaskId) throw new ConvexError("Subtasks cannot have subtasks (max 1 level)");
    if (input.projectId !== undefined && input.projectId !== parent.projectId) {
      throw new ConvexError("A sub-task always belongs to its parent's project");
    }
  }

  let project: Doc<"projects"> | null = null;
  if (parent) {
    // A parent may still point at a hard-deleted project (projects.remove keeps tasks).
    const parentProject = parent.projectId ? await ctx.db.get(parent.projectId) : null;
    project = parentProject && parentProject.orgId === orgId ? parentProject : null;
  } else if (input.projectId) {
    project = await loadProject(ctx, orgId, input.projectId);
  }

  const status = input.statusId
    ? await loadStatus(ctx, orgId, input.statusId)
    : await defaultStatusFor(ctx, orgId, input.defaultCategories ?? ["backlog"]);
  if (input.workCategoryId) await validateWorkCategory(ctx, orgId, input.workCategoryId);
  const workCategoryId = input.workCategoryId ?? parent?.workCategoryId;
  const billable = input.billable ?? parent?.billable ?? true;
  const dueDate = normalizeDate(input.dueDate, "due date");
  const startDate = normalizeDate(input.startDate, "start date");
  const estimateMinutes = normalizeEstimate(input.estimateMinutes);
  const labels = await loadLabels(ctx, orgId, input.labelIds ?? []);

  let assigneeIds = unique(input.assigneeIds ?? parent?.assigneeIds ?? []);
  if (!auth.isAdmin && !assigneeIds.includes(userId)) assigneeIds = [userId, ...assigneeIds];
  if (assigneeIds.length === 0 && options.defaultAssignee) {
    const fallback = await resolveDefaultAssignee(ctx, orgId, project?._id, workCategoryId);
    if (fallback) assigneeIds = [fallback];
  }
  await validateAssignees(ctx, orgId, assigneeIds);

  const scope = numberScopeFor(project?._id);
  const { number, identifier } = await allocateNumber(ctx, orgId, scope);
  const sortKey =
    options.duplicatedFrom && !parent
      ? await sortKeyAfter(ctx, options.duplicatedFrom)
      : await sortKeyAtEnd(ctx, orgId);

  const taskId = await ctx.db.insert("tasks", {
    orgId,
    title,
    description,
    hasDescription: hasDescriptionContent(description),
    ...statusFields(status, undefined, now),
    projectId: project?._id,
    clientId: project?.clientId,
    assigneeIds,
    labelIds: labels.map((l) => l._id),
    workCategoryId,
    billable,
    estimateMinutes,
    dueDate,
    startDate,
    priority: input.priority ?? PRIORITY.none,
    parentTaskId: parent?._id,
    sortKey,
    identifier,
    numberScope: scope,
    number,
    trackedMinutes: 0,
    commentCount: 0,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    lastActivityAt: now,
    lastActivity: { kind: "task_created", actorId: userId, at: now },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });
  for (const assignee of assigneeIds) {
    await ctx.db.insert("taskAssignees", { orgId, taskId, userId: assignee, assignedAt: now, assignedBy: userId });
  }
  for (const label of labels) {
    await ctx.db.insert("taskLabels", { orgId, taskId, labelId: label._id });
  }

  await logActivity(ctx, {
    taskId,
    orgId,
    userId,
    via: auth.via,
    type: "task_created",
    metadata: options.duplicatedFrom ? { duplicatedFrom: options.duplicatedFrom._id } : {},
    at: now,
  });
  if (parent) {
    await logActivity(ctx, {
      taskId: parent._id,
      orgId,
      userId,
      via: auth.via,
      type: "subtask_created",
      metadata: { subtaskId: taskId, title },
      at: now,
    });
    await onSubtaskChange(ctx, parent._id);
  }

  if (options.notify !== false) {
    const created = (await ctx.db.get(taskId))!;
    const events: Parameters<typeof createNotifications>[1]["events"] = assigneeIds.map((recipientId) => ({
      recipientId,
      type: "assigned" as const,
      previewText: title,
    }));
    const descDoc = safeParseDoc(description);
    const mentions = extractMentionIds(descDoc);
    if (mentions.length > 0) {
      const preview = truncatePreview(extractPlainText(descDoc));
      for (const recipientId of mentions) {
        events.push({ recipientId, type: "mention_description", previewText: preview });
      }
    }
    if (events.length > 0) await createNotifications(ctx, { orgId, actorId: userId, task: created, events });
  }

  return taskId;
}

/** Duplicate = a create with the original's properties, placed right after it. */
export async function duplicateTask(ctx: MutationCtx, access: TaskAccess): Promise<Id<"tasks">> {
  const { task } = access;
  // An archived status can't be set on a new task: the copy gets its category's default.
  const status = await ctx.db.get(task.statusId);
  const keepStatus = status !== null && !status.archivedAt;
  const activeLabelIds: Id<"labels">[] = [];
  for (const labelId of task.labelIds ?? []) {
    const label = await ctx.db.get(labelId);
    if (label && !label.archivedAt) activeLabelIds.push(labelId);
  }
  const copyTitle = `${task.title} (copy)`;
  return await createTask(
    ctx,
    access.auth,
    {
      title: copyTitle.length > TITLE_MAX_LENGTH ? task.title : copyTitle,
      description: task.description,
      statusId: keepStatus ? task.statusId : undefined,
      defaultCategories: task.statusCategory ? [task.statusCategory] : undefined,
      projectId: task.parentTaskId ? undefined : task.projectId,
      parentTaskId: task.parentTaskId,
      assigneeIds: task.assigneeIds,
      workCategoryId: task.workCategoryId,
      billable: task.billable,
      estimateMinutes: task.estimateMinutes,
      priority: task.priority,
      labelIds: activeLabelIds,
    },
    { duplicatedFrom: task },
  );
}

// ─── Update ──────────────────────────────────────────────────────────────────

/** A partial update. `null` clears an optional property; omitted = unchanged. */
export type TaskPatch = {
  title?: string;
  description?: string;
  statusId?: Id<"statuses">;
  projectId?: Id<"projects"> | null;
  assigneeIds?: Id<"users">[];
  workCategoryId?: Id<"workCategories"> | null;
  estimateMinutes?: number | null;
  billable?: boolean;
  dueDate?: string | null;
  startDate?: string | null;
  priority?: TaskPriority;
  labelIds?: Id<"labels">[];
};

/**
 * The update path behind `tasks.update`, `updateDescription`, `bulkUpdate`
 * and the property mutations. Only fields whose value actually changes are
 * written, policy-checked (§5.3) and logged. Validation and policy run
 * before any write.
 */
export async function updateTask(
  ctx: MutationCtx,
  access: TaskAccess,
  patch: TaskPatch,
  options: { now?: number } = {},
): Promise<{ changed: TaskField[]; assigneesChanged: boolean }> {
  const { task, auth } = access;
  const { orgId, userId } = auth;
  const now = options.now ?? Date.now();
  const set: TaskPatchFields = {};
  const events: ActivityEvent[] = [];
  const changed = new Set<TaskField>();

  if (patch.title !== undefined) {
    const title = normalizeTitle(patch.title, task.parentTaskId ? "Subtask title" : "Task title");
    if (title !== task.title) {
      changed.add("title");
      set.title = title;
      events.push({ type: "title_changed", metadata: { from: task.title, to: title } });
    }
  }

  if (patch.description !== undefined) {
    const description = normalizeDescription(patch.description);
    if (description !== task.description) {
      changed.add("description");
      set.description = description;
      set.hasDescription = hasDescriptionContent(description);
    }
  }

  let statusChange: { from: TaskCategory | undefined; to: TaskCategory } | undefined;
  if (patch.statusId !== undefined && patch.statusId !== task.statusId) {
    const next = await loadStatus(ctx, orgId, patch.statusId);
    const prevStatus = await ctx.db.get(task.statusId);
    const prevCategory = await currentCategory(ctx, task);
    changed.add("status");
    Object.assign(set, statusFields(next, { statusCategory: prevCategory, completedAt: task.completedAt }, now));
    statusChange = { from: prevCategory, to: next.category };
    events.push({
      type: "status_changed",
      metadata: {
        from: prevStatus?.name ?? "None",
        to: next.status.name,
        fromId: task.statusId,
        toId: next.status._id,
        toCategory: next.category,
      },
    });
  }

  if (patch.priority !== undefined && patch.priority !== (task.priority ?? PRIORITY.none)) {
    changed.add("priority");
    set.priority = patch.priority;
    events.push({ type: "priority_changed", metadata: { from: task.priority ?? PRIORITY.none, to: patch.priority } });
  }

  if (patch.dueDate !== undefined) {
    const dueDate = normalizeDate(patch.dueDate, "due date");
    if (dueDate !== task.dueDate) {
      changed.add("dueDate");
      set.dueDate = dueDate;
      events.push({ type: "due_date_changed", metadata: { from: task.dueDate ?? null, to: dueDate ?? null } });
    }
  }

  if (patch.startDate !== undefined) {
    const startDate = normalizeDate(patch.startDate, "start date");
    if (startDate !== task.startDate) {
      changed.add("startDate");
      set.startDate = startDate;
      events.push({ type: "start_date_changed", metadata: { from: task.startDate ?? null, to: startDate ?? null } });
    }
  }

  if (patch.estimateMinutes !== undefined) {
    const estimate = normalizeEstimate(patch.estimateMinutes);
    const current = task.estimateMinutes;
    if (estimate !== current) {
      changed.add("estimate");
      set.estimateMinutes = estimate;
      events.push({ type: "estimate_changed", metadata: { from: current ?? null, to: estimate ?? null } });
    }
  }

  if (patch.billable !== undefined && patch.billable !== task.billable) {
    changed.add("billable");
    set.billable = patch.billable;
    events.push({ type: "billable_changed", metadata: { from: task.billable, to: patch.billable } });
  }

  let nextWorkCategoryId = task.workCategoryId;
  if (patch.workCategoryId !== undefined && (patch.workCategoryId ?? undefined) !== task.workCategoryId) {
    if (patch.workCategoryId !== null) await validateWorkCategory(ctx, orgId, patch.workCategoryId);
    nextWorkCategoryId = patch.workCategoryId ?? undefined;
    changed.add("workCategory");
    set.workCategoryId = nextWorkCategoryId;
    const from = task.workCategoryId ? await ctx.db.get(task.workCategoryId) : null;
    const to = nextWorkCategoryId ? await ctx.db.get(nextWorkCategoryId) : null;
    events.push({ type: "category_changed", metadata: { from: from?.name ?? "None", to: to?.name ?? "None" } });
  }

  let projectMove: { project: Doc<"projects"> | null } | undefined;
  if (patch.projectId !== undefined && (patch.projectId ?? undefined) !== task.projectId) {
    if (task.parentTaskId) throw new ConvexError("A sub-task always belongs to its parent's project");
    const project = patch.projectId ? await loadProject(ctx, orgId, patch.projectId) : null;
    // An entry's `projectId` is stamped from its task, so a task tree with
    // logged time keeps its project forever (clearing included).
    for (const t of [task, ...(await childrenOf(ctx, task))]) {
      const entry = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
        .first();
      if (entry) {
        throw new ConvexError(
          "Cannot change the project of a task with time entries — existing entries keep their original rate snapshots",
        );
      }
    }
    changed.add("project");
    projectMove = { project };
    const from = task.projectId ? await ctx.db.get(task.projectId) : null;
    events.push({ type: "project_changed", metadata: { from: from?.name ?? null, to: project?.name ?? null } });
  }

  let labelChange: { added: Doc<"labels">[]; removed: Id<"labels">[]; next: Id<"labels">[] } | undefined;
  if (patch.labelIds !== undefined) {
    const next = unique(patch.labelIds);
    const current = task.labelIds ?? [];
    if (!sameSet(next, current)) {
      const added = await loadLabels(ctx, orgId, next.filter((id) => !current.includes(id)));
      changed.add("labels");
      labelChange = { added, removed: current.filter((id) => !next.includes(id)), next };
    }
  }

  let nextAssignees: Id<"users">[] | undefined;
  let autoAssigned: Id<"users"> | undefined;
  if (patch.assigneeIds !== undefined) {
    const next = unique(patch.assigneeIds);
    if (!sameSet(next, task.assigneeIds)) {
      assertCanChangeAssignees(access, task.assigneeIds, next);
      await validateAssignees(ctx, orgId, next);
      nextAssignees = next;
    }
  } else if ((changed.has("workCategory") || changed.has("project")) && task.assigneeIds.length === 0) {
    // A task without assignees picks up the project's default for its category.
    const projectId = projectMove ? projectMove.project?._id : task.projectId;
    const fallback = await resolveDefaultAssignee(ctx, orgId, projectId, nextWorkCategoryId);
    if (fallback) {
      autoAssigned = fallback;
      nextAssignees = [fallback];
    }
  }

  assertCanEditFields(access, [...changed]);
  if (changed.size === 0 && nextAssignees === undefined) return { changed: [], assigneesChanged: false };

  // ── Writes ──
  await ctx.db.patch(task._id, { ...set, updatedAt: now });
  if (projectMove) await moveToProject(ctx, auth, task, projectMove.project, now);
  if (labelChange) await syncLabelEdges(ctx, (await ctx.db.get(task._id))!, labelChange.next);
  if (nextAssignees) {
    await syncAssigneeEdges(ctx, (await ctx.db.get(task._id))!, nextAssignees, { actorId: userId, at: now });
  }

  // ── Activity ──
  const log = async (event: ActivityEvent, taskId: Id<"tasks"> = task._id) =>
    await logActivity(ctx, { taskId, orgId, userId, via: auth.via, ...event });
  for (const event of events) await log(event);
  if (labelChange) {
    for (const label of labelChange.added) {
      await log({ type: "label_added", metadata: { labelId: label._id, labelName: label.name } });
    }
    for (const labelId of labelChange.removed) {
      const label = await ctx.db.get(labelId);
      await log({ type: "label_removed", metadata: { labelId, labelName: label?.name ?? "Unknown" } });
    }
  }
  const addedAssignees = nextAssignees ? nextAssignees.filter((id) => !task.assigneeIds.includes(id)) : [];
  if (nextAssignees) {
    for (const id of addedAssignees) {
      if (id === autoAssigned) {
        const category = nextWorkCategoryId ? await ctx.db.get(nextWorkCategoryId) : null;
        await log({
          type: "assignee_added",
          metadata: {
            userId: id,
            userName: await userName(ctx, id),
            reason: "default_assignee",
            categoryName: category?.name ?? "Unknown",
          },
        });
      } else {
        await log({ type: "assignee_added", metadata: { userId: id, userName: await userName(ctx, id) } });
      }
    }
    for (const id of task.assigneeIds.filter((x) => !nextAssignees!.includes(x))) {
      await log({ type: "assignee_removed", metadata: { userId: id, userName: await userName(ctx, id) } });
    }
  }

  // ── Parent counters (sub-task category change) ──
  if (statusChange && task.parentTaskId) {
    if (statusChange.to === "completed" && statusChange.from !== "completed") {
      await log(
        { type: "subtask_completed", metadata: { title: set.title ?? task.title, subtaskId: task._id } },
        task.parentTaskId,
      );
    }
    await onSubtaskChange(ctx, task.parentTaskId);
  }

  // ── Notifications: new assignees + newly added description mentions ──
  const notifications: Parameters<typeof createNotifications>[1]["events"] = [];
  const title = set.title ?? task.title;
  for (const recipientId of addedAssignees) {
    notifications.push({ recipientId, type: "assigned", previewText: title });
  }
  if (changed.has("description")) {
    const newDoc = safeParseDoc(set.description);
    const added = diffMentionIds(safeParseDoc(task.description), newDoc);
    if (added.length > 0) {
      const preview = truncatePreview(extractPlainText(newDoc));
      for (const recipientId of added) {
        notifications.push({ recipientId, type: "mention_description", previewText: preview });
      }
    }
  }
  if (notifications.length > 0) {
    // Re-read: the recipient access check must see the NEW assignee list.
    const updated = (await ctx.db.get(task._id))!;
    await createNotifications(ctx, { orgId, actorId: userId, task: updated, events: notifications });
  }

  return { changed: [...changed], assigneesChanged: nextAssignees !== undefined };
}

// ─── Archive / restore (T8) ──────────────────────────────────────────────────

export type TimerRescue = Awaited<ReturnType<typeof autoSaveTimersForTasks>>;

/**
 * Archives the task and its non-archived sub-tasks with one timestamp (so a
 * restore can undo exactly this cascade), then auto-saves running timers on
 * them as entries.
 */
export async function archiveTask(ctx: MutationCtx, access: TaskAccess): Promise<TimerRescue> {
  assertCanArchive(access);
  const { task, auth } = access;
  if (task.archivedAt) return { saved: [], failed: [] };
  const now = Date.now();
  await ctx.db.patch(task._id, { archivedAt: now, updatedAt: now });
  await logActivity(ctx, {
    taskId: task._id,
    orgId: task.orgId,
    userId: auth.userId,
    via: auth.via,
    type: "task_archived",
    metadata: {},
  });
  const children = await childrenOf(ctx, task);
  for (const child of children) {
    if (child.archivedAt) continue;
    await ctx.db.patch(child._id, { archivedAt: now, updatedAt: now });
    await logActivity(ctx, {
      taskId: child._id,
      orgId: task.orgId,
      userId: auth.userId,
      via: auth.via,
      type: "task_archived",
      metadata: { viaParent: task._id },
    });
  }
  if (children.length > 0) await onSubtaskChange(ctx, task._id);
  if (task.parentTaskId) await onSubtaskChange(ctx, task.parentTaskId);

  return await autoSaveTimersForTasks(ctx, {
    orgId: task.orgId,
    actorUserId: auth.userId,
    via: auth.via,
    taskIds: new Set([task._id.toString(), ...children.map((c) => c._id.toString())]),
    noteLabel: "Auto-saved when the task was archived",
  });
}

/** Restores the task and the sub-tasks its archive cascaded to (same `archivedAt`). */
export async function restoreTask(ctx: MutationCtx, access: TaskAccess): Promise<void> {
  assertCanArchive(access);
  const { task, auth } = access;
  if (!task.archivedAt) throw new ConvexError("Task is not archived");
  const now = Date.now();
  await ctx.db.patch(task._id, { archivedAt: undefined, updatedAt: now });
  await logActivity(ctx, {
    taskId: task._id,
    orgId: task.orgId,
    userId: auth.userId,
    via: auth.via,
    type: "task_restored",
    metadata: {},
  });
  const children = await childrenOf(ctx, task);
  let restored = 0;
  for (const child of children) {
    if (child.archivedAt !== task.archivedAt) continue;
    await ctx.db.patch(child._id, { archivedAt: undefined, updatedAt: now });
    await logActivity(ctx, {
      taskId: child._id,
      orgId: task.orgId,
      userId: auth.userId,
      via: auth.via,
      type: "task_restored",
      metadata: { viaParent: task._id },
    });
    restored++;
  }
  if (restored > 0) await onSubtaskChange(ctx, task._id);
  if (task.parentTaskId) await onSubtaskChange(ctx, task.parentTaskId);
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Hard-deletes one task row with everything hanging off it: time entries,
 * activity, comments, attachments, receipts, notifications, mutes, plan
 * segments (cascadeDeleteTaskData), plus its edges, aliases and per-user
 * state. Callers enforce the ledger rule first. Does not touch sub-tasks.
 */
export async function deleteTaskRecord(ctx: MutationCtx, task: Doc<"tasks">): Promise<void> {
  await cascadeDeleteTaskData(ctx, task._id);
  await syncAssigneeEdges(ctx, task, [], { actorId: task.createdBy, at: Date.now() });
  await syncLabelEdges(ctx, task, []);
  const aliases = await ctx.db
    .query("taskIdentifierAliases")
    .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
    .collect();
  for (const alias of aliases) await ctx.db.delete(alias._id);
  const userStates = await ctx.db
    .query("taskUserState")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", task._id))
    .collect();
  for (const state of userStates) await ctx.db.delete(state._id);
  // External source refs (MCP, D21): a deleted task frees its refs. Capped
  // per task on insert; the bounded read keeps a delete possible even past
  // the cap (a leftover row points at no task and is reclaimed on reuse).
  const externalRefs = await ctx.db
    .query("taskExternalRefs")
    .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
    .take(EXTERNAL_REFS_PER_TASK_MAX * 10);
  for (const ref of externalRefs) await ctx.db.delete(ref._id);
  await ctx.db.delete(task._id);
}

/**
 * Admin delete of a task and its sub-tasks (§5.3). Close-locked entries
 * always block; unlocked entries need explicit consent. Timers on the tree
 * are cleared (an entry cannot outlive its task).
 */
export async function removeTask(
  ctx: MutationCtx,
  access: TaskAccess,
  options: { deleteEntries?: boolean } = {},
): Promise<void> {
  assertCanDelete(access);
  const { task, auth } = access;
  const children = await childrenOf(ctx, task);

  let hasEntries = false;
  for (const t of [task, ...children]) {
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
      .collect();
    for (const e of entries) {
      if (e.closeId) {
        throw new ConvexError(
          "This task has invoiced or settled time entries. Archive it instead to keep billing records intact.",
        );
      }
      hasEntries = true;
    }
  }
  if (hasEntries && !options.deleteEntries) {
    throw new ConvexError(
      "This task has logged time. Archive it instead, or confirm deleting the time entries with it.",
    );
  }

  const affected = new Set([task._id.toString(), ...children.map((c) => c._id.toString())]);
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", task.orgId))
    .collect();
  for (const member of members) {
    if (!member.userId) continue;
    const user = await ctx.db.get(member.userId);
    if (user?.timerTaskId && affected.has(user.timerTaskId.toString())) {
      await ctx.db.patch(member.userId, {
        timerTaskId: undefined,
        timerStartedAt: undefined,
        timerAccumulatedMs: undefined,
        timerStatus: undefined,
      });
    }
  }

  for (const child of children) await deleteTaskRecord(ctx, child);
  await deleteTaskRecord(ctx, task);

  if (task.parentTaskId) {
    const parent = await ctx.db.get(task.parentTaskId);
    if (parent) {
      await logActivity(ctx, {
        taskId: parent._id,
        orgId: task.orgId,
        userId: auth.userId,
        via: auth.via,
        type: "subtask_deleted",
        metadata: { title: task.title },
      });
      await onSubtaskChange(ctx, parent._id);
    }
  }
}

// ─── Order ───────────────────────────────────────────────────────────────────

/** Drag & drop in the global manual order. Not an activity event. */
export async function reorderTask(
  ctx: MutationCtx,
  access: TaskAccess,
  neighbours: { beforeKey?: string; afterKey?: string },
): Promise<void> {
  const key = generateKeyBetween(neighbours.beforeKey ?? null, neighbours.afterKey ?? null);
  await ctx.db.patch(access.task._id, { sortKey: key });
}

/**
 * Reorders a parent's sub-tasks: the siblings' existing sort keys are
 * permuted into the new order (they stay where they were in the global
 * space).
 */
export async function reorderSubtasks(
  ctx: MutationCtx,
  parentAccess: TaskAccess,
  orderedIds: readonly Id<"tasks">[],
): Promise<void> {
  assertCanEditFields(parentAccess, ["subtasks"]);
  const parent = parentAccess.task;
  const subs: Doc<"tasks">[] = [];
  for (const id of orderedIds) {
    const sub = await ctx.db.get(id);
    if (!sub || sub.orgId !== parent.orgId || sub.parentTaskId !== parent._id) {
      throw new ConvexError("Subtask does not belong to this parent");
    }
    subs.push(sub);
  }
  let keys = subs.map((s) => s.sortKey).filter((k): k is string => k !== undefined).sort();
  if (keys.length !== subs.length || new Set(keys).size !== keys.length) {
    keys = [];
    let prev: string | null = await sortKeyAtEnd(ctx, parent.orgId);
    for (let i = 0; i < subs.length; i++) {
      keys.push(prev);
      prev = generateKeyBetween(prev, null);
    }
  }
  const now = Date.now();
  for (const [i, sub] of subs.entries()) {
    await ctx.db.patch(sub._id, { sortKey: keys[i], updatedAt: now });
  }
}

/**
 * Moves a sub-task right after or right before a sibling (the MCP
 * checklist order, docs/prd-mcp.md D24) through `reorderSubtasks`, the
 * drawer's drag & drop path. Archived siblings keep their keys. Returns
 * whether the order changed.
 */
export async function placeSubtask(
  ctx: MutationCtx,
  parentAccess: TaskAccess,
  subtaskId: Id<"tasks">,
  anchor: { after: Id<"tasks"> } | { before: Id<"tasks"> },
): Promise<boolean> {
  const anchorId = "after" in anchor ? anchor.after : anchor.before;
  if (anchorId === subtaskId) throw new ConvexError("A sub-task cannot be placed relative to itself");
  const siblings = (await childrenOf(ctx, parentAccess.task)).filter((t) => !t.archivedAt).sort(compareBySortKey);
  const current = siblings.map((t) => t._id);
  if (!current.includes(subtaskId)) throw new ConvexError("Subtask does not belong to this parent");
  if (!current.includes(anchorId)) {
    throw new ConvexError("after / before must name another active sub-task of the same parent");
  }
  const next = current.filter((id) => id !== subtaskId);
  const at = next.indexOf(anchorId) + ("after" in anchor ? 1 : 0);
  next.splice(at, 0, subtaskId);
  if (next.every((id, i) => id === current[i])) return false;
  await reorderSubtasks(ctx, parentAccess, next);
  return true;
}

// ─── Maintenance (seeds) ─────────────────────────────────────────────────────

/**
 * Seeds only: inserts a task row as given; the reseed then computes and
 * writes the model fields (identifier, counters) and the edges.
 */
export async function insertTaskForSeed(ctx: MutationCtx, doc: TaskDocFields): Promise<Id<"tasks">> {
  return await ctx.db.insert("tasks", doc);
}

/**
 * Seeds only: writes model fields computed by the reseed (identifiers,
 * categories, caches, counters). Edges go through the sync functions.
 */
export async function patchTaskForSeed(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  fields: TaskPatchFields,
): Promise<void> {
  await ctx.db.patch(taskId, fields);
}
