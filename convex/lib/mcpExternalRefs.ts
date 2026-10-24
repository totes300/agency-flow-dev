import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { loadTaskForReadOrNull } from "../tasks/access";

/**
 * External source refs on tasks (docs/prd-mcp.md D21): `gmail:<threadId>`,
 * `granola:<noteId>`, `slack:<ts>`. A task carries many; a ref belongs to
 * at most one task per org. Adding a ref another task owns fails and names
 * that task; a ref is never moved. Refs are add-only through MCP and go away
 * with their task (tasks/write.ts `deleteTaskRecord`).
 *
 * Read budget: one `by_orgId_ref` range per ref looked up (plus one task
 * read for an owner's label); a task's refs are one `by_taskId` range.
 */

/** Refs one `save_tasks` item may add. */
export const EXTERNAL_REFS_PER_ITEM_MAX = 20;
/** Refs listed on a fetched task. */
export const TASK_EXTERNAL_REFS_SHOWN = 50;

/** `<source>:<id>`: a source of letters, digits, `-` / `_` (starting with a letter) and an ID without spaces. */
const EXTERNAL_REF = /^([A-Za-z][A-Za-z0-9_-]{0,31}):(\S{1,256})$/;

/**
 * The canonical form of an external ref (source lowercased, ID kept exactly:
 * source IDs are case-sensitive), or a model-actionable error.
 */
export function normalizeExternalRef(raw: string): string {
  const match = EXTERNAL_REF.exec(raw.trim());
  if (!match) {
    throw new ConvexError(
      `Invalid external ref "${raw.slice(0, 80)}". Write <source>:<id>, e.g. gmail:18c2f0a1b2c3d4e5 (source: letters, digits, - or _; id: up to 256 characters, no spaces).`,
    );
  }
  return `${match[1].toLowerCase()}:${match[2]}`;
}

/** Normalized, de-duplicated refs of one item. */
export function normalizeExternalRefs(raw: readonly string[]): string[] {
  if (raw.length > EXTERNAL_REFS_PER_ITEM_MAX) {
    throw new ConvexError(`Add at most ${EXTERNAL_REFS_PER_ITEM_MAX} external refs per task in one call.`);
  }
  return [...new Set(raw.map(normalizeExternalRef))];
}

/** The task that owns `ref` in the org, or null. */
export async function externalRefOwner(ctx: QueryCtx, orgId: string, ref: string): Promise<Id<"tasks"> | null> {
  const row = await ctx.db
    .query("taskExternalRefs")
    .withIndex("by_orgId_ref", (q) => q.eq("orgId", orgId).eq("ref", ref))
    .first();
  return row?.taskId ?? null;
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
  for (const ref of refs) {
    const owner = await externalRefOwner(ctx, auth.orgId, ref);
    if (owner === task._id) continue;
    if (owner !== null) {
      throw new ConvexError(`${ref} is already on ${await ownerLabel(ctx, auth, owner)}`);
    }
    await ctx.db.insert("taskExternalRefs", { orgId: task.orgId, ref, taskId: task._id, createdAt: now });
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
