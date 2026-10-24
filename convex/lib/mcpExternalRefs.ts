import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { loadTaskForReadOrNull } from "../tasks/access";
import { EXTERNAL_REFS_PER_TASK_MAX } from "../tasks/model";
import { normalizeExternalRef as parseExternalRef } from "../../lib/mcp/refs";

/**
 * External source refs on tasks (docs/prd-mcp.md D21): `gmail:<threadId>`,
 * `granola:<noteId>`, `slack:<ts>`. A task carries many; a ref belongs to
 * at most one task per org. Adding a ref another task owns fails and names
 * that task; a ref is never moved. Refs are add-only through MCP and go away
 * with their task (tasks/write.ts `deleteTaskRecord`).
 *
 * Read budget: one `by_orgId_ref` range plus one task read per ref looked
 * up; adding refs reads the task's refs once (≤ 101 rows, the per-task cap).
 */

/** Refs one `save_tasks` item may add. */
export const EXTERNAL_REFS_PER_ITEM_MAX = 20;
/** Refs listed on a fetched task. */
export const TASK_EXTERNAL_REFS_SHOWN = EXTERNAL_REFS_PER_TASK_MAX;

/** The canonical form of an external ref, or a model-actionable error (lib/mcp/refs.ts). */
export function normalizeExternalRef(raw: string): string {
  const result = parseExternalRef(raw);
  if (!result.ok) throw new ConvexError(result.error);
  return result.ref;
}

/** Normalized, de-duplicated refs of one item. */
export function normalizeExternalRefs(raw: readonly string[]): string[] {
  if (raw.length > EXTERNAL_REFS_PER_ITEM_MAX) {
    throw new ConvexError(`Add at most ${EXTERNAL_REFS_PER_ITEM_MAX} external refs per task in one call.`);
  }
  return [...new Set(raw.map(normalizeExternalRef))];
}

async function refRow(ctx: QueryCtx, orgId: string, ref: string) {
  return await ctx.db
    .query("taskExternalRefs")
    .withIndex("by_orgId_ref", (q) => q.eq("orgId", orgId).eq("ref", ref))
    .first();
}

/** The live task that owns `ref` in the org, or null (a row left by a deleted task owns nothing). */
export async function externalRefOwner(ctx: QueryCtx, orgId: string, ref: string): Promise<Id<"tasks"> | null> {
  const row = await refRow(ctx, orgId, ref);
  if (!row) return null;
  const task = await ctx.db.get(row.taskId);
  return task && task.orgId === orgId ? task._id : null;
}

/**
 * How an owning task is named in an error: its identifier when the caller
 * can read it, else a phrase that names nothing (members never learn about
 * tasks they cannot open).
 */
export async function ownerLabel(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">): Promise<string> {
  const access = await loadTaskForReadOrNull(ctx, taskId, auth);
  return access ? (access.task.identifier ?? access.task._id) : "a task you cannot access";
}

/**
 * Adds `refs` to `task`. A ref the task already has is skipped; one owned by
 * another task fails with that task named (`gmail:abc is already on
 * ARLO-21`). Returns how many refs were added.
 */
export async function addExternalRefs(
  ctx: MutationCtx,
  auth: AuthContext,
  task: Doc<"tasks">,
  refs: readonly string[],
  now: number,
): Promise<number> {
  let added = 0;
  let count: number | null = null;
  for (const ref of refs) {
    const row = await refRow(ctx, auth.orgId, ref);
    if (row?.taskId === task._id) continue;
    if (row) {
      const owner = await ctx.db.get(row.taskId);
      if (owner && owner.orgId === auth.orgId) {
        throw new ConvexError(`${ref} is already on ${await ownerLabel(ctx, auth, owner._id)}`);
      }
      // Left behind by a deleted task: reclaim it.
      await ctx.db.delete(row._id);
    }
    count ??= (
      await ctx.db
        .query("taskExternalRefs")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .take(EXTERNAL_REFS_PER_TASK_MAX + 1)
    ).length;
    if (count >= EXTERNAL_REFS_PER_TASK_MAX) {
      throw new ConvexError(`A task carries at most ${EXTERNAL_REFS_PER_TASK_MAX} external refs.`);
    }
    await ctx.db.insert("taskExternalRefs", { orgId: task.orgId, ref, taskId: task._id, createdAt: now });
    count += 1;
    added += 1;
  }
  return added;
}

/** A task's refs, oldest first (bounded; `truncated` = more exist). */
export async function listTaskExternalRefs(
  ctx: QueryCtx,
  orgId: string,
  taskId: Id<"tasks">,
): Promise<{ refs: string[]; truncated: boolean }> {
  const rows = await ctx.db
    .query("taskExternalRefs")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .take(TASK_EXTERNAL_REFS_SHOWN + 1);
  const inOrg = rows.filter((r) => r.orgId === orgId);
  return {
    refs: inOrg.slice(0, TASK_EXTERNAL_REFS_SHOWN).map((r) => r.ref),
    truncated: rows.length > TASK_EXTERNAL_REFS_SHOWN,
  };
}
