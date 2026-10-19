import { v } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import type { GenericDatabaseWriter, GenericDataModel } from "convex/server";
import type { GenericId } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveOrgId } from "./devSeedTasks";
import { recomputeTaskCounters } from "./tasks/derived";
import {
  DEFAULT_STATUS_SEED,
  TASK_CATEGORIES,
  hasDescriptionContent,
  isClosedCategory,
  isTaskCategory,
  isValidIdentifierKey,
  suggestProjectCode,
  type TaskCategory,
} from "./tasks/model";
import { setTaskMuted } from "./tasks/userState";
import {
  addIdentifierAlias,
  allocateIdentifierForCleanup,
  replaceTaskForCleanup,
  syncAssigneeEdges,
  syncLabelEdges,
} from "./tasks/write";

/**
 * DEV-ONLY one-off cleanup for the tasks refactor narrowing
 * (docs/prd-tasks-refactor.md §4.6, slice 7b). Removes every pre-refactor
 * field and table row from one org and backfills every field the narrowed
 * schema requires, so the narrowed schema (slice 7b commit B) can deploy:
 *
 *  - statuses: drop `type` / `sortOrder` / `icon`; backfill `category`,
 *    `position`, `isDefault` (one default per category; a category without
 *    an active status gets the §4.1 default);
 *  - orgSettings: drop `defaultStatusId`, `completionDefault*StatusId`,
 *    `defaultMyTasksStatusIds`;
 *  - projects: recode legacy codes that are not identifier keys (`PRJ-042`);
 *  - tasks: drop `statusType` / `manualSortKey` / `sortOrder` / `estimate`;
 *    backfill identifier/number/numberScope, statusCategory (T3),
 *    completedAt (T4), priority, sortKey (from `manualSortKey`, else
 *    appended), estimateMinutes (from `estimate`), hasDescription, labelIds,
 *    derived counters, lastActivityAt; edges re-synced to the caches (T6).
 *    Written through `tasks/write.ts` (T2);
 *  - users (of the org's members): drop `taskDetailView`, `todayVisibleStatuses`;
 *  - `taskMutes` rows become `taskUserState.muted`; `taskViewReceipts` rows
 *    are deleted (per-user state was backfilled in slice 2).
 *
 * Bounded: each run fixes at most `batchSize` tasks and legacy rows and
 * reports what is left. Idempotent — rerun until `remaining` is 0:
 *
 *   npx convex run devCleanupTasks:stripLegacy '{}'
 *   npx convex run devCleanupTasks:stripLegacy '{"orgId":"org_…"}'
 *
 * Reads the org's statuses/projects/tasks in one pass (dummy-data dev tool,
 * capped by `SCAN_CAP`); remove this module once the narrowing is deployed.
 */

export const LEGACY_TASK_FIELDS = ["statusType", "manualSortKey", "sortOrder", "estimate"] as const;
export const LEGACY_STATUS_FIELDS = ["type", "sortOrder", "icon"] as const;
export const LEGACY_SETTINGS_FIELDS = [
  "defaultStatusId",
  "completionDefaultAdminStatusId",
  "completionDefaultMemberStatusId",
  "defaultMyTasksStatusIds",
] as const;
export const LEGACY_USER_FIELDS = ["taskDetailView", "todayVisibleStatuses"] as const;
export const LEGACY_TABLES = ["taskMutes", "taskViewReceipts"] as const;

/** Fields the narrowed schema requires (optional during the widen phase). */
export const REQUIRED_TASK_FIELDS = [
  "hasDescription",
  "identifier",
  "numberScope",
  "number",
  "statusCategory",
  "priority",
  "sortKey",
  "labelIds",
  "trackedMinutes",
  "commentCount",
  "subtaskCount",
  "subtaskDoneCount",
  "lastActivityAt",
] as const;
export const REQUIRED_STATUS_FIELDS = ["category", "position", "isDefault"] as const;

const SCAN_CAP = 5000;
const DEFAULT_BATCH = 50;

type Raw = Record<string, unknown>;
const raw = (doc: object): Raw => doc as Raw;
const hasAny = (doc: object, fields: readonly string[]) => fields.some((f) => raw(doc)[f] !== undefined);
const missingAny = (doc: object, fields: readonly string[]) => fields.some((f) => raw(doc)[f] === undefined);
const without = <T extends object>(doc: T, fields: readonly string[]): T => {
  const copy = { ...raw(doc) };
  for (const f of ["_id", "_creationTime", ...fields]) delete copy[f];
  return copy as T;
};

/** The pre-refactor `statuses.type` → category (default seed names first, §4.1). */
function legacyCategory(status: Doc<"statuses">): TaskCategory {
  if (status.category && isTaskCategory(status.category)) return status.category;
  const seed = DEFAULT_STATUS_SEED.find((s) => s.name.toLowerCase() === status.name.trim().toLowerCase());
  if (seed) return seed.category;
  switch (raw(status).type) {
    case "done":
      return "completed";
    case "in_progress":
    case "review":
    case "blocked":
      return "started";
    default:
      return "backlog";
  }
}

/** Rows of a table the narrowed schema no longer declares (untyped, unindexed). */
function legacyDb(ctx: MutationCtx): GenericDatabaseWriter<GenericDataModel> {
  return ctx.db as unknown as GenericDatabaseWriter<GenericDataModel>;
}

export type StripLegacyResult = {
  orgId: string;
  statusesFixed: number;
  statusesCreated: number;
  orgSettingsFixed: number;
  projectsRecoded: number;
  tasksFixed: number;
  /** Tasks whose status is not one of the org's: left as they are (fix by hand). */
  tasksBlocked: number;
  usersFixed: number;
  taskMutesMigrated: number;
  taskViewReceiptsDeleted: number;
  /** Tasks and legacy-table rows still to clean; rerun until 0 (and `tasksBlocked` is 0). */
  remaining: number;
};

export async function stripLegacyTaskData(
  ctx: MutationCtx,
  args: { orgId?: string; batchSize?: number },
): Promise<StripLegacyResult> {
  const orgId = await resolveOrgId(ctx, args.orgId);
  const batch = Math.max(1, Math.min(500, Math.floor(args.batchSize ?? DEFAULT_BATCH)));
  const now = Date.now();
  const result: StripLegacyResult = {
    orgId,
    statusesFixed: 0,
    statusesCreated: 0,
    orgSettingsFixed: 0,
    projectsRecoded: 0,
    tasksFixed: 0,
    tasksBlocked: 0,
    usersFixed: 0,
    taskMutesMigrated: 0,
    taskViewReceiptsDeleted: 0,
    remaining: 0,
  };

  const settings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(SCAN_CAP);
  const actorId = members.find((m) => m.role === "admin" && m.userId)?.userId ?? settings?.createdBy;

  // ── Statuses ─────────────────────────────────────────────────────────────
  let statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(SCAN_CAP);
  if (actorId) {
    const covered = new Set(statuses.filter((s) => !s.archivedAt).map(legacyCategory));
    for (const seed of DEFAULT_STATUS_SEED.filter((s) => s.isDefault && !covered.has(s.category))) {
      let last: string | null = null;
      for (const s of statuses) {
        if (legacyCategory(s) === seed.category && s.position && (last === null || s.position > last)) last = s.position;
      }
      await ctx.db.insert("statuses", {
        orgId,
        name: seed.name,
        color: seed.color,
        category: seed.category,
        position: generateKeyBetween(last, null),
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
      result.statusesCreated++;
    }
    if (result.statusesCreated > 0) {
      statuses = await ctx.db
        .query("statuses")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .take(SCAN_CAP);
    }
  }
  const categoryOf = new Map<Id<"statuses">, TaskCategory>();
  for (const category of TASK_CATEGORIES) {
    const inCategory = statuses
      .filter((s) => legacyCategory(s) === category)
      .sort((a, b) => {
        const order = (s: Doc<"statuses">) => (typeof raw(s).sortOrder === "number" ? (raw(s).sortOrder as number) : 1e9);
        return (
          (a.position ?? "").localeCompare(b.position ?? "") ||
          order(a) - order(b) ||
          a._creationTime - b._creationTime
        );
      });
    // Keep valid existing keys; give the rest fresh keys after them, in order.
    let last: string | null = null;
    for (const s of inCategory) if (s.position && (last === null || s.position > last)) last = s.position;
    const position = new Map<Id<"statuses">, string>();
    for (const s of inCategory) {
      if (s.position) {
        position.set(s._id, s.position);
      } else {
        last = generateKeyBetween(last, null);
        position.set(s._id, last);
      }
    }
    const active = inCategory.filter((s) => !s.archivedAt);
    const flagged = active.filter((s) => s.isDefault === true);
    const seedDefault = DEFAULT_STATUS_SEED.find((d) => d.category === category && d.isDefault);
    const defaultId =
      flagged.length === 1
        ? flagged[0]._id
        : (active.find((s) => s.name.toLowerCase() === seedDefault?.name.toLowerCase()) ?? active[0])?._id;
    for (const s of inCategory) {
      categoryOf.set(s._id, category);
      const next = { category, position: position.get(s._id)!, isDefault: s._id === defaultId };
      const dirty =
        hasAny(s, LEGACY_STATUS_FIELDS) ||
        s.category !== next.category ||
        s.position !== next.position ||
        s.isDefault !== next.isDefault;
      if (!dirty) continue;
      await ctx.db.replace(s._id, { ...without(s, LEGACY_STATUS_FIELDS), ...next, updatedAt: now });
      result.statusesFixed++;
    }
  }

  // ── Org settings ─────────────────────────────────────────────────────────
  if (settings && hasAny(settings, LEGACY_SETTINGS_FIELDS)) {
    await ctx.db.replace(settings._id, { ...without(settings, LEGACY_SETTINGS_FIELDS), updatedAt: now });
    result.orgSettingsFixed++;
  }

  // ── Projects: identifier keys ────────────────────────────────────────────
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(SCAN_CAP);
  const usedKeys = new Set(projects.map((p) => p.code).filter(isValidIdentifierKey));
  if (settings?.taskKey) usedKeys.add(settings.taskKey);
  const projectById = new Map(projects.map((p) => [p._id, p]));
  for (const p of projects) {
    if (isValidIdentifierKey(p.code)) continue;
    const client = await ctx.db.get(p.clientId);
    const code = suggestProjectCode(
      { clientPrefix: client?.prefix, clientName: client?.name, projectName: p.name },
      usedKeys,
    );
    usedKeys.add(code);
    await ctx.db.patch(p._id, { code, updatedAt: now });
    projectById.set(p._id, { ...p, code });
    result.projectsRecoded++;
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(SCAN_CAP);
  const isDirty = (t: Doc<"tasks">) =>
    hasAny(t, LEGACY_TASK_FIELDS) ||
    missingAny(t, REQUIRED_TASK_FIELDS) ||
    t.statusCategory !== categoryOf.get(t.statusId);
  const blocked = tasks.filter((t) => !categoryOf.has(t.statusId));
  result.tasksBlocked = blocked.length;
  // Rows without a sort key get appended keys: top-level tasks first, then
  // sub-tasks grouped by parent in their legacy `sortOrder`, so siblings keep
  // their order.
  const legacyOrder = (t: Doc<"tasks">) => (typeof raw(t).sortOrder === "number" ? (raw(t).sortOrder as number) : 0);
  const dirty = tasks
    .filter((t) => categoryOf.has(t.statusId) && isDirty(t))
    .sort((a, b) => {
      if (!a.parentTaskId !== !b.parentTaskId) return a.parentTaskId ? 1 : -1;
      if (a.parentTaskId && b.parentTaskId && a.parentTaskId !== b.parentTaskId) {
        return a.parentTaskId < b.parentTaskId ? -1 : 1;
      }
      return legacyOrder(a) - legacyOrder(b) || a.createdAt - b.createdAt;
    });
  const lastSorted = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_sortKey", (q) => q.eq("orgId", orgId))
    .order("desc")
    .first();
  let lastSortKey = lastSorted?.sortKey ?? null;
  for (const t of dirty.slice(0, batch)) {
    const statusCategory = categoryOf.get(t.statusId)!;
    const legacy = raw(t);
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    const projectId = project ? t.projectId : undefined; // a hard-deleted project → org scope

    let numbering = { numberScope: t.numberScope, number: t.number, identifier: t.identifier };
    if (!t.numberScope || t.number === undefined || !t.identifier || (t.projectId && !project)) {
      numbering = await allocateIdentifierForCleanup(ctx, orgId, projectId);
    }
    let sortKey = t.sortKey ?? (typeof legacy.manualSortKey === "string" ? legacy.manualSortKey : undefined);
    if (!sortKey) {
      lastSortKey = generateKeyBetween(lastSortKey, null);
      sortKey = lastSortKey;
    }
    const counters =
      missingAny(t, ["trackedMinutes", "commentCount", "subtaskCount", "subtaskDoneCount"])
        ? await recomputeTaskCounters(ctx, t)
        : {
            trackedMinutes: t.trackedMinutes!,
            commentCount: t.commentCount!,
            lastCommentAt: t.lastCommentAt,
            subtaskCount: t.subtaskCount!,
            subtaskDoneCount: t.subtaskDoneCount!,
          };
    const closed = isClosedCategory(statusCategory);
    const doc = {
      ...without(t, LEGACY_TASK_FIELDS),
      projectId,
      clientId: project ? project.clientId : undefined,
      numberScope: numbering.numberScope!,
      number: numbering.number!,
      identifier: numbering.identifier!,
      statusCategory,
      completedAt: closed ? (t.completedAt ?? t.updatedAt) : undefined,
      priority: t.priority ?? 0,
      sortKey,
      estimateMinutes:
        t.estimateMinutes ?? (typeof legacy.estimate === "number" ? legacy.estimate : undefined),
      hasDescription: t.hasDescription ?? hasDescriptionContent(t.description),
      labelIds: t.labelIds ?? [],
      ...counters,
      lastActivityAt: t.lastActivityAt ?? t.lastActivity?.at ?? t.updatedAt,
    };
    await replaceTaskForCleanup(ctx, t._id, doc);
    if (t.identifier && t.identifier !== doc.identifier) {
      await addIdentifierAlias(ctx, orgId, t.identifier, t._id);
    }
    // Edges == caches (T6), for rows the old paths wrote without edges.
    const fixed = (await ctx.db.get(t._id))!;
    await syncAssigneeEdges(ctx, fixed, fixed.assigneeIds, { actorId: t.createdBy, at: t.createdAt });
    await syncLabelEdges(ctx, fixed, fixed.labelIds ?? []);
    result.tasksFixed++;
  }
  result.remaining += Math.max(0, dirty.length - result.tasksFixed);

  // ── Users of the org's members ───────────────────────────────────────────
  for (const m of members) {
    if (!m.userId) continue;
    const user = await ctx.db.get(m.userId);
    if (!user || !hasAny(user, LEGACY_USER_FIELDS)) continue;
    await ctx.db.replace(user._id, without(user, LEGACY_USER_FIELDS));
    result.usersFixed++;
  }

  // ── Legacy tables ────────────────────────────────────────────────────────
  const db = legacyDb(ctx);
  const mutes = await db
    .query("taskMutes")
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .take(batch + 1);
  for (const mute of mutes.slice(0, batch)) {
    const task = await ctx.db.get(mute.taskId as Id<"tasks">);
    if (task && task.orgId === orgId) await setTaskMuted(ctx, task, mute.userId as Id<"users">, true);
    await db.delete(mute._id as GenericId<"taskMutes">);
    result.taskMutesMigrated++;
  }
  const receipts = await db
    .query("taskViewReceipts")
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .take(batch + 1);
  for (const receipt of receipts.slice(0, batch)) {
    await db.delete(receipt._id as GenericId<"taskViewReceipts">);
    result.taskViewReceiptsDeleted++;
  }
  result.remaining += Math.max(0, mutes.length - batch) + Math.max(0, receipts.length - batch);

  return result;
}

export const stripLegacy = internalMutation({
  args: { orgId: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => await stripLegacyTaskData(ctx, args),
});
