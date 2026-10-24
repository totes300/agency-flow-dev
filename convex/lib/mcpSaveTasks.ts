import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { markdownToRichText, runItem } from "./mcpWrites";
import type { SaveTasksResult } from "./mcpWriteResults";
import {
  addExternalRefs,
  externalRefOwner,
  normalizeExternalRefs,
  ownerLabel,
} from "./mcpExternalRefs";
import { loadTaskForReadOrNull, loadTaskForWrite } from "../tasks/access";
import { PRIORITY, type TaskPriority } from "../tasks/model";
import {
  createTask,
  defaultStatusFor,
  placeSubtask,
  updateTask,
  type CreateTaskInput,
  type TaskPatch,
} from "../tasks/write";
import { REF_CAP } from "../workspaceRefs";
import type { PriorityName } from "../../lib/mcp/limits";

/**
 * MCP `save_tasks` (docs/prd-mcp.md §6, D21, D24, D27, D28): a batch of task
 * creates and patches in ONE mutation, all-or-nothing (I5). Every item runs
 * the app's write path (tasks/write.ts `createTask` / `updateTask` /
 * `placeSubtask`) as the caller, so access rules (§5.3: members only touch
 * tasks they are assigned to, billing fields are admin-only) and
 * notifications (D16) are exactly the app's.
 *
 * - An item with `ref` patches that task.
 * - An item without `ref` whose `externalRefs` already belong to a task
 *   updates that task instead (D21): duplicates are impossible by
 *   construction. Refs spread over two tasks are an error.
 * - Otherwise the item creates a task. No project = the org's task key and
 *   no client (D28). `assignees: []` creates it unassigned (no default
 *   assignee, no notification — D27).
 * - `done: true` = the org's default completed status (D24); `after` /
 *   `before` order a sub-task among its siblings (fractional sort keys).
 * - `externalRefs` are add-only; a ref another task owns fails, naming it.
 *
 * Read budget per item (Convex: 4,096 index ranges per call; at most
 * MCP_BATCH_MAX = 25 items): ref resolution ~5, reference names one read
 * per table per call (≤ REF_CAP rows each), external refs one range each,
 * then the write path — identifier allocation, edges, activity and the
 * notification checks (~6 per recipient). Typically 40–80 ranges an item,
 * ~2,000 for a 25-item batch. Member emails (assignees, @mentions) add one
 * range per org member, once per call (mcpRefs.ts, ≤ REF_CAP).
 */

export type SaveTaskItem = {
  ref?: string;
  title?: string;
  description?: string;
  project?: string | null;
  parent?: string;
  status?: string;
  done?: boolean;
  after?: string;
  before?: string;
  assignees?: string[];
  labels?: string[];
  priority?: PriorityName;
  startDate?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  category?: string | null;
  externalRefs?: string[];
};

const PRIORITY_BY_NAME: Record<PriorityName, TaskPriority> = {
  none: PRIORITY.none,
  urgent: PRIORITY.urgent,
  high: PRIORITY.high,
  medium: PRIORITY.medium,
  low: PRIORITY.low,
};

const WORKSPACE_HINT = 'Use a name listed in fetch("workspace").';

/** Status, label and work-category names → ids, each table read once per call (≤ REF_CAP rows). */
function referenceNames(ctx: MutationCtx, orgId: string) {
  const load = <T>(rows: Promise<T[]>, noun: string) =>
    rows.then((all) => {
      if (all.length > REF_CAP) {
        throw new ConvexError(`This workspace has more than ${REF_CAP} ${noun}, so ${noun} cannot be matched by name.`);
      }
      return all;
    });
  let statuses: Promise<Doc<"statuses">[]> | null = null;
  let labels: Promise<Doc<"labels">[]> | null = null;
  let categories: Promise<Doc<"workCategories">[]> | null = null;

  /** The one row named `name` (case-insensitive), else a model-actionable error. */
  function pick<T extends { name: string; archivedAt?: number }>(rows: T[], name: string, noun: string): T {
    const value = name.trim().toLowerCase();
    const named = rows.filter((r) => r.name.trim().toLowerCase() === value);
    const active = named.filter((r) => r.archivedAt === undefined);
    if (active.length === 1) return active[0];
    if (active.length > 1) throw new ConvexError(`${noun} "${name}" is ambiguous: ${active.length} share that name.`);
    if (named.length > 0) throw new ConvexError(`The ${noun.toLowerCase()} "${name}" is archived. ${WORKSPACE_HINT}`);
    throw new ConvexError(`No ${noun.toLowerCase()} "${name}". ${WORKSPACE_HINT}`);
  }

  return {
    async status(name: string): Promise<Id<"statuses">> {
      statuses ??= load(
        ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1),
        "statuses",
      );
      return pick(await statuses, name, "Status")._id;
    },
    async label(name: string): Promise<Id<"labels">> {
      labels ??= load(
        ctx.db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1),
        "labels",
      );
      return pick(await labels, name, "Label")._id;
    },
    async category(name: string): Promise<Id<"workCategories">> {
      categories ??= load(
        ctx.db.query("workCategories").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1),
        "work categories",
      );
      return pick(await categories, name, "Work category")._id;
    },
  };
}

type ReferenceNames = ReturnType<typeof referenceNames>;

async function requireTask(resolver: RefResolver, ref: string): Promise<Doc<"tasks">> {
  const resolved = await resolver.require(ref, "task");
  if (resolved.type !== "task") throw new Error(`Expected a task, resolved a ${resolved.type}`);
  return resolved.access.task;
}

async function requireMember(resolver: RefResolver, ref: string): Promise<Id<"users">> {
  const resolved = await resolver.require(ref, "member");
  if (resolved.type !== "member") throw new Error(`Expected a member, resolved a ${resolved.type}`);
  return resolved.user._id;
}

/** The item's property values resolved to ids (`undefined` = not given, `null` = clear). */
async function resolveProperties(names: ReferenceNames, resolver: RefResolver, item: SaveTaskItem) {
  let project: Doc<"projects"> | null | undefined;
  if (item.project === null) project = null;
  else if (item.project !== undefined) {
    const resolved = await resolver.require(item.project, "project");
    if (resolved.type !== "project") throw new Error(`Expected a project, resolved a ${resolved.type}`);
    project = resolved.project;
  }

  let assigneeIds: Id<"users">[] | undefined;
  if (item.assignees !== undefined) {
    assigneeIds = [];
    for (const ref of item.assignees) assigneeIds.push(await requireMember(resolver, ref));
  }
  let labelIds: Id<"labels">[] | undefined;
  if (item.labels !== undefined) {
    labelIds = [];
    for (const name of item.labels) labelIds.push(await names.label(name));
  }

  let description: string | undefined;
  if (item.description !== undefined) {
    const doc = await markdownToRichText(resolver, item.description);
    description = doc ? JSON.stringify(doc) : "";
  }

  return {
    project,
    assigneeIds,
    labelIds,
    description,
    statusId: item.status !== undefined ? await names.status(item.status) : undefined,
    workCategoryId:
      item.category === null ? null : item.category !== undefined ? await names.category(item.category) : undefined,
    priority: item.priority !== undefined ? PRIORITY_BY_NAME[item.priority] : undefined,
  };
}

/** The task an item without `ref` updates through its external refs, or null to create. */
async function taskByExternalRefs(
  ctx: MutationCtx,
  auth: McpAuthContext,
  refs: readonly string[],
): Promise<Id<"tasks"> | null> {
  const owners = new Map<Id<"tasks">, string>();
  for (const ref of refs) {
    const owner = await externalRefOwner(ctx, auth.orgId, ref);
    if (owner !== null && !owners.has(owner)) owners.set(owner, ref);
  }
  if (owners.size === 0) return null;
  if (owners.size > 1) {
    const parts = [];
    for (const [taskId, ref] of owners) parts.push(`${ref} is on ${await ownerLabel(ctx, auth, taskId)}`);
    throw new ConvexError(`${parts.join(" and ")}: one item cannot update two tasks. Pass ref to choose the task.`);
  }
  const [[taskId, ref]] = [...owners];
  if (!(await loadTaskForReadOrNull(ctx, taskId, auth))) {
    throw new ConvexError(`${ref} is already on a task you cannot access.`);
  }
  return taskId;
}

/** Applies `after` / `before` to a sub-task; returns whether its position changed. */
async function position(
  ctx: MutationCtx,
  auth: McpAuthContext,
  resolver: RefResolver,
  task: Doc<"tasks">,
  item: SaveTaskItem,
): Promise<boolean> {
  const anchorRef = item.after ?? item.before;
  if (anchorRef === undefined) return false;
  if (!task.parentTaskId) throw new ConvexError("after / before order sub-tasks only; this task has no parent.");
  const anchor = await requireTask(resolver, anchorRef);
  const parentAccess = await loadTaskForWrite(ctx, task.parentTaskId, auth);
  return await placeSubtask(
    ctx,
    parentAccess,
    task._id,
    item.after !== undefined ? { after: anchor._id } : { before: anchor._id },
  );
}

async function saveItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  resolver: RefResolver,
  item: SaveTaskItem,
  now: number,
): Promise<SaveTasksResult["items"][number]> {
  if (item.status !== undefined && item.done !== undefined) {
    throw new ConvexError("Use status or done, not both.");
  }
  if (item.done === false) {
    throw new ConvexError('done only accepts true. To reopen a task, set status to an open status from fetch("workspace").');
  }
  if (item.after !== undefined && item.before !== undefined) {
    throw new ConvexError("Use after or before, not both.");
  }
  const externalRefs = normalizeExternalRefs(item.externalRefs ?? []);

  const targetId =
    item.ref !== undefined
      ? (await requireTask(resolver, item.ref))._id
      : await taskByExternalRefs(ctx, auth, externalRefs);
  const props = await resolveProperties(names, resolver, item);

  if (targetId !== null) {
    const access = await loadTaskForWrite(ctx, targetId, auth);
    const { task } = access;
    if (item.parent !== undefined && (await requireTask(resolver, item.parent))._id !== task.parentTaskId) {
      throw new ConvexError("A task's parent cannot change. Create a new sub-task under the other parent instead.");
    }
    let statusId = props.statusId;
    // done: true on a task that is already completed keeps its status.
    if (item.done && task.statusCategory !== "completed") {
      statusId = (await defaultStatusFor(ctx, auth.orgId, ["completed"])).status._id;
    }
    const patch: TaskPatch = {
      title: item.title,
      description: props.description,
      statusId,
      projectId: props.project === undefined ? undefined : (props.project?._id ?? null),
      assigneeIds: props.assigneeIds,
      workCategoryId: props.workCategoryId,
      estimateMinutes: item.estimateMinutes,
      dueDate: item.dueDate,
      startDate: item.startDate,
      priority: props.priority,
      labelIds: props.labelIds,
    };
    const { changed } = await updateTask(ctx, access, patch);
    const updated = (await ctx.db.get(targetId))!;
    const added = await addExternalRefs(ctx, auth, updated, externalRefs, now);
    const moved = await position(ctx, auth, resolver, updated, item);
    return {
      identifier: updated.identifier ?? updated._id,
      title: updated.title,
      action: changed.length > 0 || added > 0 || moved ? "updated" : "unchanged",
    };
  }

  if (item.title === undefined) {
    throw new ConvexError(
      "title is required to create a task. To update one, pass its ref (or an external ref it already has).",
    );
  }
  const parent = item.parent !== undefined ? await requireTask(resolver, item.parent) : undefined;
  const input: CreateTaskInput = {
    title: item.title,
    description: props.description,
    statusId: item.done ? (await defaultStatusFor(ctx, auth.orgId, ["completed"])).status._id : props.statusId,
    projectId: props.project?._id,
    parentTaskId: parent?._id,
    assigneeIds: props.assigneeIds,
    workCategoryId: props.workCategoryId ?? undefined,
    estimateMinutes: item.estimateMinutes ?? undefined,
    dueDate: item.dueDate ?? undefined,
    startDate: item.startDate ?? undefined,
    priority: props.priority,
    labelIds: props.labelIds,
  };
  // As in the app: the project's default assignee only when no assignees were given.
  const taskId = await createTask(ctx, auth, input, { defaultAssignee: item.assignees === undefined });
  const created = (await ctx.db.get(taskId))!;
  await addExternalRefs(ctx, auth, created, externalRefs, now);
  await position(ctx, auth, resolver, created, item);
  return { identifier: created.identifier ?? created._id, title: created.title, action: "created" };
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function saveTasks(
  ctx: MutationCtx,
  auth: McpAuthContext,
  items: readonly SaveTaskItem[],
  now: number,
): Promise<SaveTasksResult> {
  const names = referenceNames(ctx, auth.orgId);
  const resolver = createRefResolver(ctx, auth);
  const results: SaveTasksResult["items"] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? (item.title ? item.title.slice(0, 40) : null);
    results.push(await runItem(index, label, () => saveItem(ctx, auth, names, resolver, item, now)));
  }
  return { tool: "save_tasks", items: results };
}
