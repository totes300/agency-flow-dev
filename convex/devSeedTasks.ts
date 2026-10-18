import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_STATUS_SEED,
  TASK_CATEGORIES,
  categoryFromLegacyType,
  deriveIdentifierKey,
  formatIdentifier,
  hasDescriptionContent,
  isClosedCategory,
  isValidIdentifierKey,
  numberScopeFor,
  sameNumberScope,
  suggestProjectCode,
  uniqueIdentifierKey,
  type NumberScope,
  type TaskCategory,
  type TaskPriority,
} from "./tasks/model";
import { recomputeTaskCounters } from "./tasks/derived";
import {
  addIdentifierAlias,
  deleteOrphanEdges,
  insertLegacyTaskForSeed,
  patchTaskForSeed,
  syncAssigneeEdges,
  syncLabelEdges,
} from "./tasks/write";

/**
 * DEV-ONLY reseed for the tasks refactor foundations
 * (docs/prd-tasks-refactor.md §9 slice 0). Reshapes one org's task data into
 * the §4 model IN PLACE, so time entries, closes and invoices that reference
 * the existing tasks stay intact:
 *
 *  1. Statuses get a category, a position and one default per category; a
 *     brand-new org gets the full §4.1 default set, an existing org only
 *     gets defaults for categories it has no status in (e.g. Canceled).
 *  2. The org gets a task key; projects whose code is not a valid identifier
 *     key (legacy "PRJ-042") get a short letter code ("ARLO").
 *  3. Default labels are upserted by name.
 *  4. A few org-level demo tasks (no project → org identifier, a canceled
 *     one, a multi-assignee one) are created once, matched by title.
 *  5. Every task gets identifier/number, statusCategory, completedAt,
 *     priority, sortKey, clientId, estimateMinutes, label/assignee caches,
 *     derived counters — and its `taskAssignees`/`taskLabels` edges are
 *     rewritten to equal the caches. Some single-assignee tasks get a second
 *     assignee (D1 demo). Legacy fields stay populated for the old UI.
 *  6. Project and org counters are set past the highest number.
 *
 * Idempotent: a second run changes nothing (existing numbers, positions,
 * priorities and labels are kept).
 *
 * Run:  npx convex run devSeedTasks:seed '{}'          (single-org deployment)
 *       npx convex run devSeedTasks:seed '{"orgId":"org_…"}'
 *
 * Reads whole-org tables on purpose: dummy-data dev tool, not a product path.
 */

export const DEFAULT_LABEL_SEED: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Bug", color: "red" },
  { name: "Feature", color: "purple" },
  { name: "Improvement", color: "blue" },
  { name: "Content", color: "green" },
  { name: "Quick win", color: "teal" },
];

type DemoTask = {
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  /** How many org members to assign (capped by the member count). */
  assignees: number;
  labels: string[];
};

export const DEMO_TASKS: readonly DemoTask[] = [
  { title: "Plan the Q4 internal retro", category: "started", priority: 2, assignees: 2, labels: ["Improvement"] },
  { title: "Refresh agency website case studies", category: "backlog", priority: 0, assignees: 1, labels: ["Content"] },
  { title: "Evaluate a new invoicing tool", category: "canceled", priority: 4, assignees: 1, labels: [] },
];

/** Deterministic, varied priorities for tasks that have none yet. */
const PRIORITY_CYCLE: readonly TaskPriority[] = [0, 3, 2, 4, 3, 1, 0, 2, 4, 3];

export type SeedTaskFoundationsResult = {
  orgId: string;
  orgKey: string;
  statusesCreated: number;
  statusesUpdated: number;
  projectsRecoded: Array<{ projectId: Id<"projects">; from: string; to: string }>;
  labelsCreated: number;
  demoTasksCreated: number;
  tasksUpdated: number;
  secondAssigneesAdded: number;
  edgesInserted: number;
  edgesDeleted: number;
  aliasesCreated: number;
  /** Tasks whose project was hard-deleted (projects.remove keeps tasks): projectId cleared. */
  danglingProjectsCleared: number;
};

async function resolveOrgId(ctx: MutationCtx, orgId: string | undefined): Promise<string> {
  if (orgId) return orgId;
  const settings = await ctx.db.query("orgSettings").collect();
  const orgIds = Array.from(new Set(settings.map((s) => s.orgId)));
  if (orgIds.length === 0) {
    throw new ConvexError("No org found in orgSettings. Sign into the app once so an org is created.");
  }
  if (orgIds.length > 1) {
    throw new ConvexError(
      `Multiple orgs in this deployment — pass {"orgId":"..."} explicitly. Candidates: ${orgIds.join(", ")}`,
    );
  }
  return orgIds[0];
}

/** Appends `count` fractional keys after `after` (null = start of the space). */
function keysAfter(after: string | null, count: number): string[] {
  const keys: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    prev = generateKeyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}

function maxKey(keys: Array<string | undefined>): string | null {
  let max: string | null = null;
  for (const k of keys) if (k !== undefined && (max === null || k > max)) max = k;
  return max;
}

/** Key-order-insensitive JSON, for "did this field change" checks on stored objects. */
function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

export async function seedTaskFoundations(
  ctx: MutationCtx,
  args: { orgId?: string; orgKey?: string },
): Promise<SeedTaskFoundationsResult> {
  const orgId = await resolveOrgId(ctx, args.orgId);
  const settings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  if (!settings) throw new ConvexError(`Org ${orgId} has no orgSettings — onboard it first`);
  const now = Date.now();

  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const memberUserIds: Id<"users">[] = [];
  for (const m of members.sort((a, b) => a.joinedAt - b.joinedAt)) {
    if (!m.userId) continue;
    const user = await ctx.db.get(m.userId);
    if (user && !user.deletedAt) memberUserIds.push(m.userId);
  }
  const actorId =
    members.find((m) => m.role === "admin" && m.userId)?.userId ?? settings.createdBy;

  const result: SeedTaskFoundationsResult = {
    orgId,
    orgKey: "",
    statusesCreated: 0,
    statusesUpdated: 0,
    projectsRecoded: [],
    labelsCreated: 0,
    demoTasksCreated: 0,
    tasksUpdated: 0,
    secondAssigneesAdded: 0,
    edgesInserted: 0,
    edgesDeleted: 0,
    aliasesCreated: 0,
    danglingProjectsCleared: 0,
  };

  // ── 1. Statuses ───────────────────────────────────────────────────────────
  let statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const seedByName = new Map(DEFAULT_STATUS_SEED.map((s) => [s.name.toLowerCase(), s]));
  const categoryOf = (s: Doc<"statuses">): TaskCategory =>
    s.category ?? seedByName.get(s.name.toLowerCase())?.category ?? categoryFromLegacyType(s.type);

  const coveredCategories = new Set(statuses.filter((s) => !s.archivedAt).map(categoryOf));
  const missingSeeds =
    statuses.length === 0
      ? DEFAULT_STATUS_SEED
      : DEFAULT_STATUS_SEED.filter((s) => s.isDefault && !coveredCategories.has(s.category));
  let nextSortOrder = statuses.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
  for (const s of missingSeeds) {
    await ctx.db.insert("statuses", {
      orgId,
      name: s.name,
      color: s.color,
      type: s.legacyType,
      sortOrder: nextSortOrder++,
      category: s.category,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    });
    result.statusesCreated++;
  }
  if (missingSeeds.length > 0) {
    statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  }

  const statusCategory = new Map<Id<"statuses">, TaskCategory>();
  const defaultStatusId = new Map<TaskCategory, Id<"statuses">>();
  for (const category of TASK_CATEGORIES) {
    const inCategory = statuses
      .filter((s) => categoryOf(s) === category)
      .sort((a, b) => a.sortOrder - b.sortOrder || a._creationTime - b._creationTime);
    const unpositioned = inCategory.filter((s) => s.position === undefined);
    const newKeys = keysAfter(maxKey(inCategory.map((s) => s.position)), unpositioned.length);
    const positionOf = new Map(unpositioned.map((s, i) => [s._id, newKeys[i]]));

    const active = inCategory.filter((s) => !s.archivedAt);
    const flagged = active.filter((s) => s.isDefault === true);
    const seedDefault = DEFAULT_STATUS_SEED.find((d) => d.category === category && d.isDefault);
    const byPosition = [...active].sort((a, b) =>
      (a.position ?? positionOf.get(a._id)!) < (b.position ?? positionOf.get(b._id)!) ? -1 : 1,
    );
    const defaultId =
      flagged.length === 1
        ? flagged[0]._id
        : (active.find((s) => s.name.toLowerCase() === seedDefault?.name.toLowerCase()) ?? byPosition[0])?._id;
    if (defaultId) defaultStatusId.set(category, defaultId);

    for (const s of inCategory) {
      statusCategory.set(s._id, category);
      const patch: Partial<Doc<"statuses">> = {};
      if (s.category !== category) patch.category = category;
      if (s.position === undefined) patch.position = positionOf.get(s._id);
      const isDefault = s._id === defaultId;
      if (s.isDefault !== isDefault) patch.isDefault = isDefault;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(s._id, { ...patch, updatedAt: now });
        result.statusesUpdated++;
      }
    }
  }
  // Every category has an active status here (missing defaults were created above).
  const defaultStatusFor = (category: TaskCategory): Doc<"statuses"> =>
    statuses.find((x) => x._id === defaultStatusId.get(category))!;

  // ── 2. Org key + project codes ────────────────────────────────────────────
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const projectCodes = new Set(projects.map((p) => p.code).filter(isValidIdentifierKey));
  let orgKey =
    settings.taskKey && isValidIdentifierKey(settings.taskKey)
      ? settings.taskKey
      : (args.orgKey ?? deriveIdentifierKey(settings.brandName));
  if (!isValidIdentifierKey(orgKey)) throw new ConvexError(`Invalid org key: ${orgKey}`);
  if (orgKey !== settings.taskKey && projectCodes.has(orgKey)) {
    orgKey = uniqueIdentifierKey([orgKey], projectCodes);
  }
  result.orgKey = orgKey;
  const usedKeys = new Set<string>([orgKey]);

  const codeOf = new Map<Id<"projects">, string>();
  const clientOf = new Map<Id<"projects">, Id<"clients">>();
  const recode: Doc<"projects">[] = [];
  for (const p of [...projects].sort((a, b) => a.createdAt - b.createdAt)) {
    clientOf.set(p._id, p.clientId);
    if (isValidIdentifierKey(p.code) && !usedKeys.has(p.code)) {
      usedKeys.add(p.code);
      codeOf.set(p._id, p.code);
    } else {
      recode.push(p);
    }
  }
  for (const p of recode) {
    const client = await ctx.db.get(p.clientId);
    const code = suggestProjectCode(
      { clientPrefix: client?.prefix, clientName: client?.name, projectName: p.name },
      usedKeys,
    );
    usedKeys.add(code);
    codeOf.set(p._id, code);
    await ctx.db.patch(p._id, { code, updatedAt: now });
    result.projectsRecoded.push({ projectId: p._id, from: p.code, to: code });
  }

  // ── 3. Labels ─────────────────────────────────────────────────────────────
  const labels = await ctx.db
    .query("labels")
    .withIndex("by_orgId_position", (q) => q.eq("orgId", orgId))
    .collect();
  let lastLabelKey = maxKey(labels.map((l) => l.position));
  for (const seed of DEFAULT_LABEL_SEED) {
    if (labels.some((l) => l.name.toLowerCase() === seed.name.toLowerCase())) continue;
    lastLabelKey = generateKeyBetween(lastLabelKey, null);
    const id = await ctx.db.insert("labels", {
      orgId,
      name: seed.name,
      color: seed.color,
      position: lastLabelKey,
    });
    labels.push((await ctx.db.get(id))!);
    result.labelsCreated++;
  }
  const activeLabels = labels
    .filter((l) => !l.archivedAt)
    .sort((a, b) => (a.position < b.position ? -1 : 1));
  const labelIdByName = new Map(activeLabels.map((l) => [l.name.toLowerCase(), l._id]));

  // ── 4. Demo org-level tasks ───────────────────────────────────────────────
  let tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  let lastSortKey = maxKey(tasks.flatMap((t) => [t.sortKey, t.manualSortKey]));
  for (const demo of DEMO_TASKS) {
    if (tasks.some((t) => t.title === demo.title && !t.projectId)) continue;
    const status = defaultStatusFor(demo.category);
    lastSortKey = generateKeyBetween(lastSortKey, null);
    const assigneeIds = memberUserIds.slice(0, demo.assignees);
    // Inserted with legacy-shaped fields only; step 5 fills the model.
    await insertLegacyTaskForSeed(ctx, {
      orgId,
      title: demo.title,
      statusId: status._id,
      statusType: status.type,
      assigneeIds,
      billable: false,
      manualSortKey: lastSortKey,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      priority: demo.priority,
      labelIds: demo.labels.flatMap((n) => labelIdByName.get(n.toLowerCase()) ?? []),
    });
    result.demoTasksCreated++;
  }
  if (result.demoTasksCreated > 0) {
    tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  }

  // ── 5. Tasks ──────────────────────────────────────────────────────────────
  // `projects.remove` does not delete a project's tasks; such a task has no
  // code to number under, so it becomes an org-level task.
  for (const [i, t] of tasks.entries()) {
    if (t.projectId && !codeOf.has(t.projectId)) {
      await patchTaskForSeed(ctx, t._id, { projectId: undefined });
      tasks[i] = { ...t, projectId: undefined };
      result.danglingProjectsCleared++;
    }
  }
  const scopeKey = (scope: NumberScope) => (scope.kind === "org" ? "org" : scope.projectId);
  const keyForScope = (scope: NumberScope) =>
    scope.kind === "org" ? orgKey : codeOf.get(scope.projectId)!;

  // Chronological, so numbers read in creation order.
  const ordered = [...tasks].sort(
    (a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime,
  );
  const usedNumbers = new Map<string, Set<number>>();
  const numberOf = new Map<Id<"tasks">, number>();
  for (const t of ordered) {
    const scope = numberScopeFor(t.projectId);
    if (t.number === undefined || !sameNumberScope(t.numberScope, scope)) continue;
    const used = usedNumbers.get(scopeKey(scope)) ?? new Set<number>();
    if (used.has(t.number)) continue; // duplicate → renumber below
    used.add(t.number);
    usedNumbers.set(scopeKey(scope), used);
    numberOf.set(t._id, t.number);
  }
  const nextNumber = new Map<string, number>();
  for (const [key, used] of usedNumbers) nextNumber.set(key, Math.max(...used) + 1);
  for (const t of ordered) {
    if (numberOf.has(t._id)) continue;
    const key = scopeKey(numberScopeFor(t.projectId));
    const n = nextNumber.get(key) ?? 1;
    numberOf.set(t._id, n);
    nextNumber.set(key, n + 1);
  }

  // sortKey: keep existing keys; append the rest, top-level tasks first, then
  // sub-tasks in (parent, sortOrder) order so siblings keep their order.
  const needsSortKey = ordered
    .filter((t) => t.sortKey === undefined && t.manualSortKey === undefined)
    .sort((a, b) => {
      if (!a.parentTaskId !== !b.parentTaskId) return a.parentTaskId ? 1 : -1;
      if (a.parentTaskId && b.parentTaskId && a.parentTaskId !== b.parentTaskId) {
        return a.parentTaskId < b.parentTaskId ? -1 : 1;
      }
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt;
    });
  const appendedKeys = keysAfter(lastSortKey, needsSortKey.length);
  const appendedKeyOf = new Map(needsSortKey.map((t, i) => [t._id, appendedKeys[i]]));

  const childrenOf = new Map<Id<"tasks">, Doc<"tasks">[]>();
  for (const t of tasks) {
    if (!t.parentTaskId || t.archivedAt) continue;
    childrenOf.set(t.parentTaskId, [...(childrenOf.get(t.parentTaskId) ?? []), t]);
  }

  for (const [index, t] of ordered.entries()) {
    const category = statusCategory.get(t.statusId);
    if (!category) throw new ConvexError(`Task ${t._id} has a status outside org ${orgId}`);
    const scope = numberScopeFor(t.projectId);
    const number = numberOf.get(t._id)!;
    const identifier = formatIdentifier(keyForScope(scope), number);

    // D1 demo: every 5th single-assignee open task gets a second assignee.
    let assigneeIds = t.assigneeIds;
    if (
      index % 5 === 2 &&
      assigneeIds.length === 1 &&
      !t.archivedAt &&
      !isClosedCategory(category) &&
      memberUserIds.length >= 2
    ) {
      const extra = memberUserIds.find((id) => id !== assigneeIds[0]);
      if (extra) {
        assigneeIds = [...assigneeIds, extra];
        result.secondAssigneesAdded++;
      }
    }

    const labelIds =
      t.labelIds ??
      (activeLabels.length === 0 || index % 3 !== 0
        ? []
        : index % 7 === 0 && activeLabels.length > 1
          ? [activeLabels[index % activeLabels.length]._id, activeLabels[(index + 1) % activeLabels.length]._id]
          : [activeLabels[index % activeLabels.length]._id]);

    // Derived counters (§5.5) — the same recompute derived.ts is tested against (T6).
    const counters = await recomputeTaskCounters(ctx, t);
    const lastLog = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .order("desc")
      .first();
    const lastActivity =
      counters.lastCommentAt !== undefined && (!lastLog || counters.lastCommentAt >= lastLog.createdAt)
        ? {
            kind: "comment_added",
            actorId: (await ctx.db
              .query("comments")
              .withIndex("by_task", (q) => q.eq("taskId", t._id).eq("createdAt", counters.lastCommentAt!))
              .first())!.userId,
            at: counters.lastCommentAt,
          }
        : lastLog
          ? { kind: lastLog.type, actorId: lastLog.userId, at: lastLog.createdAt }
          : { kind: "task_created", actorId: t.createdBy, at: t.createdAt };

    const next = {
      identifier,
      numberScope: scope,
      number,
      statusCategory: category,
      completedAt: isClosedCategory(category) ? (t.completedAt ?? t.updatedAt) : undefined,
      priority: t.priority ?? PRIORITY_CYCLE[index % PRIORITY_CYCLE.length],
      clientId: t.projectId ? clientOf.get(t.projectId) : undefined,
      hasDescription: hasDescriptionContent(t.description),
      estimateMinutes: t.estimateMinutes ?? t.estimate,
      sortKey: t.sortKey ?? t.manualSortKey ?? appendedKeyOf.get(t._id),
      assigneeIds,
      labelIds,
      ...counters,
      lastActivityAt: lastActivity.at,
      lastActivity,
    };
    const changed = (Object.keys(next) as Array<keyof typeof next>).some(
      (k) => canonical(t[k]) !== canonical(next[k]),
    );
    if (changed) {
      await patchTaskForSeed(ctx, t._id, next);
      result.tasksUpdated++;
    }

    // T5: an identifier that changed keeps resolving.
    if (t.identifier && t.identifier !== identifier) {
      if (await addIdentifierAlias(ctx, orgId, t.identifier, t._id)) result.aliasesCreated++;
    }

    // Edges == caches (T6).
    const updated = (await ctx.db.get(t._id))!;
    const assigneeSync = await syncAssigneeEdges(ctx, updated, assigneeIds, {
      actorId: t.createdBy,
      at: t.createdAt,
    });
    const labelSync = await syncLabelEdges(ctx, updated, labelIds);
    result.edgesInserted += assigneeSync.inserted + labelSync.inserted;
    result.edgesDeleted += assigneeSync.deleted + labelSync.deleted;
  }

  // Edges of hard-deleted tasks (tasks removed before the write path cascaded them).
  result.edgesDeleted += await deleteOrphanEdges(ctx, orgId, new Set(tasks.map((t) => t._id)));

  // ── 6. Counters ───────────────────────────────────────────────────────────
  for (const p of projects) {
    const next = nextNumber.get(p._id) ?? 1;
    if (p.nextTaskNumber !== next) await ctx.db.patch(p._id, { nextTaskNumber: next });
  }
  const orgNext = nextNumber.get("org") ?? 1;
  if (settings.taskKey !== orgKey || settings.nextTaskNumber !== orgNext) {
    await ctx.db.patch(settings._id, { taskKey: orgKey, nextTaskNumber: orgNext, updatedAt: now });
  }

  return result;
}

export const seed = internalMutation({
  args: {
    orgId: v.optional(v.string()),
    // Org identifier key for tasks without a project (default: derived from
    // the brand name, else "TASK"). Ignored once the org has a valid key.
    orgKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => await seedTaskFoundations(ctx, args),
});
