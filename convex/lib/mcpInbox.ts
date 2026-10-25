import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver } from "./mcpRefs";
import { orgClock, richTextMarkdown, userNames } from "./mcpRecords";
import { runItem } from "./mcpWrites";
import type { MarkReadResult } from "./mcpWriteResults";
import { loadTaskForReadOrNull } from "../tasks/access";
import { getUserState, markViewedForAuth } from "../tasks/userState";
import {
  markAllNotificationsReadForAuth,
  markNotificationsReadForAuth,
  type NotificationType,
} from "../notifications";
import { capText } from "../../lib/mcp/tiptap-markdown";
import { decodeInboxCursor, encodeInboxCursor, type InboxPosition } from "../../lib/mcp/cursor";
import { CHANGE_COMMENT_TEXT_MAX, INBOX_LIMIT_MAX } from "../../lib/mcp/limits";
import { parseRef } from "../../lib/mcp/refs";

/**
 * The caller's inbox for MCP (docs/prd-mcp.md D9): `fetch("inbox")` and
 * `mark_read`.
 *
 * `fetch("inbox")` lists what the app's Inbox view lists — the caller's
 * own unread and read notifications in this org (archived and snoozed ones
 * stay out, as in the app; rows whose task was deleted are dropped, as
 * `notifications.listInbox` does) — unread first, newest first in each,
 * one page at a time with an opaque cursor. Comment notifications carry the
 * comment's text capped at 500 characters like the changes feed (D29) when
 * the caller can still open the task; otherwise, and for description
 * mentions, the snapshot the app stored at notification time.
 *
 * `mark_read` runs the app's actions: a notification → the Inbox's "mark as
 * read" (`markNotificationsReadForAuth`); a task → opening it
 * (`markViewedForAuth`: its unread comments and changes are cleared, and its
 * inbox notifications read); `"inbox"` → "Mark all as read" (up to 200).
 * Idempotent: something already read reports "already read" and writes
 * nothing (a task is still stamped viewed, as opening it again would).
 *
 * Read budget: the inbox reads at most `limit + 1` rows per section (two
 * ranges each) plus 101 unread rows for the count, then per row one task,
 * one actor, one comment and (per distinct task) up to three access reads,
 * two per distinct mentioned user — under ~800 ranges for 100 rows.
 * mark_read: ~5 per task ref plus its unread slice (≤ 100 rows), one per
 * notification.
 */

/** Unread notifications counted for the header (the app's badge shows "99+" past its slice). */
export const INBOX_UNREAD_COUNT_CAP = 100;
/** Rough text budget of one inbox page (characters), like the changes feed's. */
export const INBOX_TEXT_BUDGET = 40_000;

const COMMENT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(["mention_comment", "comment", "comment_reply"]);

export type InboxArgs = { cursor?: string; limit: number; now: number };

/** One section's rows strictly after `from` (newest first), at most `cap`. */
async function sectionRows(
  ctx: QueryCtx,
  auth: McpAuthContext,
  state: "unread" | "read",
  from: InboxPosition | null,
  cap: number,
): Promise<Doc<"notifications">[]> {
  if (from === null || from.state !== state) {
    return await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) => q.eq("recipientId", auth.userId).eq("orgId", auth.orgId).eq("inboxState", state))
      .order("desc")
      .take(cap);
  }
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_org_state", (q) =>
      q
        .eq("recipientId", auth.userId)
        .eq("orgId", auth.orgId)
        .eq("inboxState", state)
        .eq("createdAt", from.createdAt)
        .lt("_creationTime", from.creationTime),
    )
    .order("desc")
    .take(cap);
  if (rows.length < cap) {
    rows.push(
      ...(await ctx.db
        .query("notifications")
        .withIndex("by_recipient_org_state", (q) =>
          q.eq("recipientId", auth.userId).eq("orgId", auth.orgId).eq("inboxState", state).lt("createdAt", from.createdAt),
        )
        .order("desc")
        .take(cap - rows.length)),
    );
  }
  return rows;
}

export async function listInbox(ctx: QueryCtx, auth: McpAuthContext, args: InboxArgs) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > INBOX_LIMIT_MAX) {
    throw new ConvexError(`limit must be between 1 and ${INBOX_LIMIT_MAX}.`);
  }
  let from: InboxPosition | null = null;
  if (args.cursor !== undefined) {
    from = decodeInboxCursor(args.cursor);
    if (!from) throw new ConvexError('Invalid inbox cursor. Call fetch("inbox") without a cursor to start from the top.');
  }
  const clock = await orgClock(ctx, auth.orgId, args.now);
  const unreadSlice = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_org_state", (q) => q.eq("recipientId", auth.userId).eq("orgId", auth.orgId).eq("inboxState", "unread"))
    .take(INBOX_UNREAD_COUNT_CAP + 1);

  // Unread first, then read; a cursor in the read section skips the unread one.
  const cap = args.limit + 1;
  const candidates: Doc<"notifications">[] =
    from?.state === "read" ? [] : await sectionRows(ctx, auth, "unread", from, cap);
  if (candidates.length < cap) candidates.push(...(await sectionRows(ctx, auth, "read", from, cap - candidates.length)));

  const tasks = new Map<Id<"tasks">, { task: Doc<"tasks"> | null; readable: boolean }>();
  const taskOf = async (taskId: Id<"tasks">) => {
    if (!tasks.has(taskId)) {
      const task = await ctx.db.get(taskId);
      const live = task && task.orgId === auth.orgId ? task : null;
      tasks.set(taskId, { task: live, readable: live !== null && (await loadTaskForReadOrNull(ctx, taskId, auth)) !== null });
    }
    return tasks.get(taskId)!;
  };
  const nameOf = userNames(ctx);
  const markdown = richTextMarkdown(ctx, auth.orgId);

  const items = [];
  let last: InboxPosition | null = null;
  let more = false;
  let textUsed = 0;
  for (const row of candidates) {
    if (items.length >= args.limit) {
      more = true;
      break;
    }
    const position: InboxPosition = { state: row.inboxState === "unread" ? "unread" : "read", createdAt: row.createdAt, creationTime: row._creationTime };
    const { task, readable } = await taskOf(row.taskId);
    if (!task) {
      // Deleted task: dropped, as the app's inbox does.
      last = position;
      continue;
    }
    let text: { text: string; truncated: boolean; snapshot: boolean; deleted: boolean } | null = null;
    if (row.type === "mention_description") {
      text = { text: row.previewText, truncated: false, snapshot: true, deleted: false };
    } else if (COMMENT_TYPES.has(row.type)) {
      const comment = readable && row.commentId ? await ctx.db.get(row.commentId) : null;
      if (comment && comment.orgId === auth.orgId && comment.taskId === task._id) {
        const capped = capText(await markdown.content(comment.content), CHANGE_COMMENT_TEXT_MAX);
        text = { text: capped.text, truncated: capped.truncated, snapshot: false, deleted: false };
      } else {
        text = { text: row.previewText, truncated: false, snapshot: true, deleted: readable && row.commentId !== undefined };
      }
    }
    const item = {
      id: row._id,
      unread: row.inboxState === "unread",
      type: row.type,
      at: row.createdAt,
      actor: await nameOf(row.actorId),
      task: { identifier: task.identifier ?? task._id, title: task.title },
      commentId: row.commentId ?? null,
      text,
    };
    const cost = 200 + (text?.text.length ?? 0);
    if (items.length > 0 && textUsed + cost > INBOX_TEXT_BUDGET) {
      more = true;
      break;
    }
    textUsed += cost;
    items.push(item);
    last = position;
  }
  // Every candidate consumed (some dropped) but the read was full: more may follow.
  if (!more && candidates.length === cap) more = true;
  return {
    items,
    unreadCount: Math.min(unreadSlice.length, INBOX_UNREAD_COUNT_CAP),
    unreadCapped: unreadSlice.length > INBOX_UNREAD_COUNT_CAP,
    cursor: more && last ? encodeInboxCursor(last) : null,
    timezone: clock.timezone,
  };
}

// ─── mark_read ───────────────────────────────────────────────────────────────

type MarkRow = MarkReadResult["items"][number];

const INBOX_HINT = 'Inbox items are listed by fetch("inbox").';

async function taskLabel(ctx: MutationCtx, taskId: Id<"tasks">): Promise<string> {
  const task = await ctx.db.get(taskId);
  return task ? `${task.identifier ?? task._id} · ${task.title}` : "deleted task";
}

/** Whether opening the task would clear anything for the caller. */
async function taskHasUnread(ctx: MutationCtx, auth: McpAuthContext, task: Doc<"tasks">): Promise<boolean> {
  const state = await getUserState(ctx, task._id, auth.userId);
  if (state && (state.unreadComments > 0 || state.hasUnseenChanges)) return true;
  const unread = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_org_state", (q) => q.eq("recipientId", auth.userId).eq("orgId", auth.orgId).eq("inboxState", "unread"))
    .take(INBOX_UNREAD_COUNT_CAP);
  return unread.some((n) => n.taskId === task._id);
}

async function markOne(ctx: MutationCtx, auth: McpAuthContext, resolver: ReturnType<typeof createRefResolver>, input: string, now: number): Promise<MarkRow> {
  const parsed = parseRef(input);
  if (parsed.ok && parsed.ref.kind === "special" && parsed.ref.name === "inbox") {
    const count = await markAllNotificationsReadForAuth(ctx, auth);
    return { input, type: "inbox", label: "inbox", action: count > 0 ? "marked_read" : "already_read", count };
  }
  const raw = input.trim();
  const notificationId = ctx.db.normalizeId("notifications", raw);
  if (notificationId) {
    const row = await ctx.db.get(notificationId);
    if (!row || row.recipientId !== auth.userId || row.orgId !== auth.orgId) {
      throw new ConvexError(`Inbox item ${raw} not found. ${INBOX_HINT}`);
    }
    const label = await taskLabel(ctx, row.taskId);
    if (row.inboxState === "read") return { input, type: "notification", label, action: "already_read" };
    await markNotificationsReadForAuth(ctx, auth, [notificationId]);
    return { input, type: "notification", label, action: "marked_read" };
  }
  if (ctx.db.normalizeId("comments", raw)) {
    throw new ConvexError("Comments are read per task, as when you open the task in the app: pass the task's ref instead.");
  }
  const resolved = await resolver.require(input, "task");
  if (resolved.type !== "task") throw new Error(`Expected a task, resolved a ${resolved.type}`);
  const { task } = resolved.access;
  const unread = await taskHasUnread(ctx, auth, task);
  await markViewedForAuth(ctx, resolved.access, now);
  return { input, type: "task", label: `${task.identifier ?? task._id} · ${task.title}`, action: unread ? "marked_read" : "already_read" };
}

/** Runs every ref in order; the first failing ref aborts the whole call (I5). */
export async function markRead(ctx: MutationCtx, auth: McpAuthContext, refs: readonly string[], now: number): Promise<MarkReadResult> {
  const resolver = createRefResolver(ctx, auth);
  const items: MarkRow[] = [];
  for (const [index, input] of refs.entries()) {
    items.push(await runItem(index, input, () => markOne(ctx, auth, resolver, input, now)));
  }
  return { tool: "mark_read", items };
}
