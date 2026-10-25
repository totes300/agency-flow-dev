import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { runItem } from "./mcpWrites";
import { requireMember, requireTask } from "./mcpSaveTasks";
import type { SavePlanResult } from "./mcpWriteResults";
import {
  createSegmentForAuth,
  removeSegmentForAuth,
  updateSegmentForAuth,
  type UpdateSegmentInput,
} from "../planner";

/**
 * MCP `save_plan` (docs/prd-mcp.md §6): Planner bars (plan segments: one
 * member × one task × one date range) in ONE mutation, all-or-nothing (I5),
 * through the Planner's own paths (convex/planner.ts `*ForAuth`):
 *
 * - Create (no `ref`) = scheduling a task on a member's row: `task`,
 *   `startDate`, optional `endDate` (default: the start, one day) and
 *   `member` (default: you). A task may have many bars (split sittings).
 * - Edit (`ref` = a bar's ID, from fetch include ["plan"] or an earlier
 *   save_plan) = move / resize / move to another member's row; `remove`
 *   unschedules it (the task is untouched). A bar's task never changes.
 * - Who: admins plan every row; members only their own row (create on it,
 *   touch their own bars, never move a bar to someone else), exactly
 *   `assertCanManagePlanFor`. Members schedule tasks they can open.
 * - The Planner records no activity and sends no notifications, so neither
 *   does this tool. Lane order is untouched: a bar keeps its stacking
 *   priority (manual order, else creation time) when its dates change, and
 *   a new bar stacks by its creation time — no capacity checks, as in the
 *   app.
 *
 * Read budget per item (at most MCP_BATCH_MAX = 25): the task ref ~5, a
 * member email one range per org member once per call, then the core — the
 * task or segment, the member's memberships: under 15 ranges an item.
 */

export type SavePlanItem = {
  /** A bar's ID: edit or remove it. Omit to schedule a new bar. */
  ref?: string;
  task?: string;
  /** The row: a member email or "me". */
  member?: string;
  startDate?: string;
  endDate?: string;
  /** true: unschedule the bar (`ref` required). */
  remove?: boolean;
};

type Row = SavePlanResult["items"][number];

const SEGMENT_HINT = 'Bar refs are listed by fetch on the task with include ["plan"].';

async function row(ctx: MutationCtx, segment: Doc<"planSegments">, action: Row["action"]): Promise<Row> {
  const task = await ctx.db.get(segment.taskId);
  const member = await ctx.db.get(segment.userId);
  return {
    segmentId: segment._id,
    task: { identifier: task?.identifier ?? segment.taskId, title: task?.title ?? "Deleted task" },
    member: { id: segment.userId, name: member?.name ?? "Former member" },
    startDate: segment.startDate,
    endDate: segment.endDate,
    action,
  };
}

/** The bar behind `ref` in the caller's org, else a not-found error. */
async function requireSegment(ctx: MutationCtx, auth: McpAuthContext, ref: string): Promise<Doc<"planSegments">> {
  const id = ctx.db.normalizeId("planSegments", ref.trim());
  const segment = id ? await ctx.db.get(id) : null;
  if (!segment || segment.orgId !== auth.orgId) throw new ConvexError(`Plan bar ${ref.trim()} not found. ${SEGMENT_HINT}`);
  return segment;
}

async function editItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  resolver: RefResolver,
  item: SavePlanItem & { ref: string },
): Promise<Row> {
  const segment = await requireSegment(ctx, auth, item.ref);
  if (item.task !== undefined) {
    throw new ConvexError("A bar's task cannot change: remove the bar and schedule the other task.");
  }
  if (item.remove === true) {
    if (item.member !== undefined || item.startDate !== undefined || item.endDate !== undefined) {
      throw new ConvexError("remove takes only ref: drop member, startDate and endDate.");
    }
    const removed = await row(ctx, segment, "removed");
    await removeSegmentForAuth(ctx, auth, { id: segment._id });
    return removed;
  }
  // Partial merge onto the stored bar, like the Planner's drag / resize.
  const update: UpdateSegmentInput = { id: segment._id };
  if (item.member !== undefined) {
    const userId: Id<"users"> = await requireMember(resolver, item.member);
    if (userId !== segment.userId) update.userId = userId;
  }
  if (item.startDate !== undefined && item.startDate !== segment.startDate) update.startDate = item.startDate;
  if (item.endDate !== undefined && item.endDate !== segment.endDate) update.endDate = item.endDate;
  if (Object.keys(update).length === 1) return await row(ctx, segment, "unchanged");
  await updateSegmentForAuth(ctx, auth, update);
  return await row(ctx, (await ctx.db.get(segment._id))!, "updated");
}

async function createItem(ctx: MutationCtx, auth: McpAuthContext, resolver: RefResolver, item: SavePlanItem): Promise<Row> {
  if (item.remove === true) throw new ConvexError("remove needs ref: the bar to unschedule.");
  if (item.task === undefined || item.startDate === undefined) {
    throw new ConvexError("task and startDate are required to schedule a bar (or pass ref to change one).");
  }
  const task = await requireTask(resolver, item.task);
  const userId = item.member !== undefined ? await requireMember(resolver, item.member) : auth.userId;
  const segmentId = await createSegmentForAuth(ctx, auth, {
    taskId: task._id,
    userId,
    startDate: item.startDate,
    endDate: item.endDate ?? item.startDate,
  });
  return await row(ctx, (await ctx.db.get(segmentId))!, "created");
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function savePlan(ctx: MutationCtx, auth: McpAuthContext, items: readonly SavePlanItem[]): Promise<SavePlanResult> {
  const resolver = createRefResolver(ctx, auth);
  const results: Row[] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? item.task ?? null;
    results.push(
      await runItem(index, label, () =>
        item.ref !== undefined ? editItem(ctx, auth, resolver, { ...item, ref: item.ref }) : createItem(ctx, auth, resolver, item),
      ),
    );
  }
  return { tool: "save_plan", items: results };
}
