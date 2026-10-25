import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { orgClock, type OrgClock } from "./mcpRecords";
import { runItem } from "./mcpWrites";
import { referenceNames, requireMember, requireTask, type ReferenceNames } from "./mcpSaveTasks";
import type { SaveTimeEntriesResult } from "./mcpWriteResults";
import { assertValidDateString } from "./dateValidation";
import {
  createTimeEntryForAuth,
  updateTimeEntryForAuth,
  type UpdateTimeEntryInput,
} from "../timeEntries";
import { anchorStartedAt, reanchorStartedAt } from "../../lib/workday";
import { TIME_ENTRY_MINUTES_MAX, TIME_ENTRY_NOTE_MAX } from "../../lib/mcp/limits";

/**
 * MCP `save_time_entries` (docs/prd-mcp.md §6): a batch of time-entry
 * creates and edits in ONE mutation, all-or-nothing (I5). Every item runs
 * the app's write path (timeEntries.ts `createTimeEntryForAuth` /
 * `updateTimeEntryForAuth`) as the caller, with the same arguments the
 * app's time-entry form sends (components/projects/time-entry-modal.tsx):
 *
 * - Who: members log and edit their own time; admins log for any member
 *   (`member`) and edit any entry. A member's entry ref to someone else's
 *   time is "not found" (the resolver shows members their own entries only).
 * - Create: `startedAt` is anchored on the date like the form
 *   (`anchorStartedAt`: today → now minus the duration, a past date → noon,
 *   both in the org timezone); no date = today in the org timezone. The
 *   category runs the app's chain — explicit `category` ?? the member's
 *   default ?? the task's — and billability follows the task.
 * - Edit: only fields that differ are sent; a date change re-anchors
 *   `startedAt` keeping its time of day (`reanchorStartedAt`). An entry
 *   settled by a close (closed period, draft or final invoice) is refused
 *   with the app's message. Moving to another task stays within the project.
 * - Rates and amounts are computed by the app (D1); they are never input
 *   and never returned.
 *
 * Read budget per item (at most MCP_BATCH_MAX = 25): ref resolution ~5 each
 * (entry, task), category names one range per call (≤ REF_CAP rows), member
 * emails one range per org member once per call, then the write path —
 * task, project, settings, category chain and rate lookups, the activity row
 * and its unseen-change fan-out: ~30 ranges an item, under ~1,000 a batch.
 */

export type SaveTimeEntryItem = {
  /** A time-entry ref (ID): edit that entry. */
  ref?: string;
  task?: string;
  /** YYYY-MM-DD in the org timezone. */
  date?: string;
  minutes?: number;
  /** null (or "") clears the note on an edit. */
  note?: string | null;
  /** A work category name. */
  category?: string;
  /** Admins: the member the new entry belongs to. */
  member?: string;
};

type Row = SaveTimeEntriesResult["items"][number];

function assertMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > TIME_ENTRY_MINUTES_MAX) {
    throw new ConvexError(`minutes must be a whole number from 1 to ${TIME_ENTRY_MINUTES_MAX} (24 hours).`);
  }
}

function cleanNote(note: string | null | undefined): string {
  const text = (note ?? "").trim();
  if (text.length > TIME_ENTRY_NOTE_MAX) {
    throw new ConvexError(`note is ${text.length} characters; at most ${TIME_ENTRY_NOTE_MAX} are accepted.`);
  }
  return text;
}

async function resultRow(ctx: MutationCtx, entryId: Id<"timeEntries">, action: Row["action"]): Promise<Row> {
  const entry = (await ctx.db.get(entryId))!;
  const task = await ctx.db.get(entry.taskId);
  const member = await ctx.db.get(entry.userId);
  return {
    entryId,
    task: task?.identifier ?? entry.taskId,
    date: entry.date,
    minutes: entry.durationMinutes,
    member: member?.name ?? "Former member",
    action,
  };
}

async function editItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  resolver: RefResolver,
  clock: OrgClock,
  item: SaveTimeEntryItem & { ref: string },
): Promise<Row> {
  if (item.member !== undefined) {
    throw new ConvexError(
      "member applies to new entries: an entry stays with the member who logged it. Delete it and log it again for the other member.",
    );
  }
  const resolved = await resolver.require(item.ref, "time_entry");
  if (resolved.type !== "time_entry") throw new Error(`Expected a time entry, resolved a ${resolved.type}`);
  const entry: Doc<"timeEntries"> = resolved.entry;

  // The form's diff: send only what changes.
  const update: UpdateTimeEntryInput = { id: entry._id };
  if (item.task !== undefined) {
    const task = await requireTask(resolver, item.task);
    if (task._id !== entry.taskId) update.taskId = task._id;
  }
  if (item.minutes !== undefined) {
    assertMinutes(item.minutes);
    if (item.minutes !== entry.durationMinutes) update.durationMinutes = item.minutes;
  }
  if (item.date !== undefined) {
    assertValidDateString(item.date);
    if (item.date !== entry.date) {
      update.date = item.date;
      update.startedAt = reanchorStartedAt(entry.startedAt, item.date, clock.timezone);
    }
  }
  if (item.category !== undefined) {
    const categoryId = await names.category(item.category);
    if (categoryId !== entry.snapshotCategoryId) update.workCategoryId = categoryId;
  }
  if (item.note !== undefined) {
    const note = cleanNote(item.note);
    if (note !== (entry.note ?? "")) update.note = note === "" ? null : note;
  }

  if (Object.keys(update).length === 1) return await resultRow(ctx, entry._id, "unchanged");
  await updateTimeEntryForAuth(ctx, auth, update);
  return await resultRow(ctx, entry._id, "updated");
}

async function createItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  names: ReferenceNames,
  resolver: RefResolver,
  clock: OrgClock,
  item: SaveTimeEntryItem,
): Promise<Row> {
  if (item.task === undefined) {
    throw new ConvexError("task is required to log time (or pass ref to edit an entry).");
  }
  if (item.minutes === undefined) throw new ConvexError("minutes is required to log time.");
  assertMinutes(item.minutes);
  const date = item.date ?? clock.today;
  assertValidDateString(date);
  const task = await requireTask(resolver, item.task);
  const note = cleanNote(item.note);
  const entryId = await createTimeEntryForAuth(ctx, auth, {
    taskId: task._id,
    durationMinutes: item.minutes,
    startedAt: anchorStartedAt(date, item.minutes, clock.timezone),
    date,
    note: note === "" ? undefined : note,
    userId: item.member !== undefined ? await requireMember(resolver, item.member) : undefined,
    // Only an explicit category; otherwise the app's member-default chain decides.
    workCategoryId: item.category !== undefined ? await names.category(item.category) : undefined,
  });
  return await resultRow(ctx, entryId, "created");
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function saveTimeEntries(
  ctx: MutationCtx,
  auth: McpAuthContext,
  items: readonly SaveTimeEntryItem[],
  now: number,
): Promise<SaveTimeEntriesResult> {
  const names = referenceNames(ctx, auth.orgId);
  const resolver = createRefResolver(ctx, auth);
  const clock = await orgClock(ctx, auth.orgId, now);
  const results: Row[] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? item.task ?? null;
    results.push(
      await runItem(index, label, () =>
        item.ref !== undefined
          ? editItem(ctx, auth, names, resolver, clock, { ...item, ref: item.ref })
          : createItem(ctx, auth, names, resolver, clock, item),
      ),
    );
  }
  return { tool: "save_time_entries", items: results };
}
