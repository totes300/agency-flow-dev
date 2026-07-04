import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";

export type NotificationType =
  | "mention_comment"
  | "mention_description"
  | "assigned"
  | "comment"
  | "comment_reply";

// Hot queries read bounded slices of the recipient's index; the badge shows
// "99+" when the unread slice is capped.
const SLICE_LIMIT = 100;
const MUTATION_IDS_CAP = 50;

// ─── Fan-out helper (called from other mutations, like logActivity) ─────────────

/**
 * Insert notification rows for a set of events. Every recipient id is treated
 * as untrusted (may come from client-controlled Tiptap mention JSON) and runs
 * a validation ladder; ANY failure skips that event silently — a bad mention
 * must never fail the comment/task mutation that triggered the fan-out.
 *
 * Takes the task doc (not just the id): every call site has already loaded
 * and access-validated the task, so no extra read.
 */
export async function createNotifications(
  ctx: MutationCtx,
  args: {
    orgId: string;
    actorId: Id<"users">;
    task: Doc<"tasks">;
    events: Array<{
      recipientId: string; // unvalidated
      type: NotificationType;
      commentId?: Id<"comments">;
      previewText: string;
    }>;
  }
): Promise<void> {
  const { orgId, actorId, task } = args;

  for (const event of args.events) {
    try {
      // 1. Resolve + sanity-check the recipient
      const recipientId = ctx.db.normalizeId("users", event.recipientId);
      if (!recipientId) continue;
      if (recipientId === actorId) continue;
      const recipient = await ctx.db.get(recipientId);
      if (!recipient || recipient.deletedAt) continue;

      // 2. Org membership (one indexed point-read also yields the role)
      const membership = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) =>
          q.eq("orgId", orgId).eq("clerkUserId", recipient.externalId)
        )
        .unique();
      if (!membership) continue;

      // 3. Task access: assignee or org admin (defense in depth — a mention
      // must never leak a notification to someone who can't open the task)
      const hasAccess =
        membership.role === "admin" || task.assigneeIds.includes(recipientId);
      if (!hasAccess) continue;

      // 4. Mute check — only comment/comment_reply respect mutes; mentions
      // and assignments break through (Notion behavior)
      if (event.type === "comment" || event.type === "comment_reply") {
        const mute = await ctx.db
          .query("taskMutes")
          .withIndex("by_user_task", (q) =>
            q.eq("userId", recipientId).eq("taskId", task._id)
          )
          .unique();
        if (mute) continue;
      }

      // 5. Unread dedupe — absorbs remove→re-add assignment cycles and
      // description autosave churn. Comment-family events are never deduped:
      // each comment is a distinct event.
      if (event.type === "assigned" || event.type === "mention_description") {
        const unread = await ctx.db
          .query("notifications")
          .withIndex("by_recipient_org_state", (q) =>
            q.eq("recipientId", recipientId).eq("orgId", orgId).eq("inboxState", "unread")
          )
          .take(SLICE_LIMIT);
        if (unread.some((n) => n.type === event.type && n.taskId === task._id)) {
          continue;
        }
      }

      const now = Date.now();
      await ctx.db.insert("notifications", {
        orgId,
        recipientId,
        actorId,
        type: event.type,
        taskId: task._id,
        commentId: event.commentId,
        previewText: event.previewText,
        inboxState: "unread",
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Skip silently — see contract above.
    }
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────────

/**
 * Unread badge count. Bounded read: caps at SLICE_LIMIT and reports the cap
 * so the client can render "99+".
 */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) =>
        q.eq("recipientId", userId).eq("orgId", orgId).eq("inboxState", "unread")
      )
      .take(SLICE_LIMIT);

    return { count: unread.length, isCapped: unread.length >= SLICE_LIMIT };
  },
});

/**
 * Inbox list: unread + read slices merged desc by createdAt, enriched with
 * task title and actor identity. Rows whose task has been deleted are
 * dropped defensively (cascade delete should already have removed them).
 */
export const listInbox = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const readSlice = async (state: "unread" | "read") =>
      await ctx.db
        .query("notifications")
        .withIndex("by_recipient_org_state", (q) =>
          q.eq("recipientId", userId).eq("orgId", orgId).eq("inboxState", state)
        )
        .order("desc")
        .take(SLICE_LIMIT);

    const rows = [...(await readSlice("unread")), ...(await readSlice("read"))].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    return await enrichRows(ctx, rows);
  },
});

/** Archived view: one bounded read on the "archived" state, same enrichment. */
export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) =>
        q.eq("recipientId", userId).eq("orgId", orgId).eq("inboxState", "archived")
      )
      .order("desc")
      .take(SLICE_LIMIT);

    return await enrichRows(ctx, rows);
  },
});

/**
 * Join task title + actor identity onto notification rows. Rows whose task
 * has been deleted are dropped defensively (cascade delete should already
 * have removed them). Departed actors render as "Former member".
 */
async function enrichRows(ctx: QueryCtx, rows: Doc<"notifications">[]) {
  const taskCache = new Map<Id<"tasks">, Doc<"tasks"> | null>();
  const actorCache = new Map<Id<"users">, Doc<"users"> | null>();

  const enriched = [];
  for (const row of rows) {
    if (!taskCache.has(row.taskId)) {
      taskCache.set(row.taskId, await ctx.db.get(row.taskId));
    }
    const task = taskCache.get(row.taskId);
    if (!task) continue; // task deleted → drop row

    if (!actorCache.has(row.actorId)) {
      actorCache.set(row.actorId, await ctx.db.get(row.actorId));
    }
    const actor = actorCache.get(row.actorId);

    enriched.push({
      _id: row._id,
      type: row.type,
      inboxState: row.inboxState,
      createdAt: row.createdAt,
      previewText: row.previewText,
      taskId: row.taskId,
      commentId: row.commentId,
      taskTitle: task.title,
      actorId: row.actorId,
      actorName: actor?.name ?? "Former member",
      actorImageUrl: actor?.imageUrl,
    });
  }

  return enriched;
}

// ─── Mutations ──────────────────────────────────────────────────────────────────

/** Load a notification the caller owns, or throw. */
async function getOwnNotification(
  ctx: MutationCtx,
  id: Id<"notifications">,
  userId: Id<"users">,
  orgId: string
): Promise<Doc<"notifications">> {
  const row = await ctx.db.get(id);
  if (!row || row.recipientId !== userId || row.orgId !== orgId) {
    throw new ConvexError("Notification not found");
  }
  return row;
}

function assertIdsCap(ids: unknown[]): void {
  if (ids.length > MUTATION_IDS_CAP) {
    throw new ConvexError(`Too many notifications (max ${MUTATION_IDS_CAP})`);
  }
}

export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    assertIdsCap(args.ids);

    const now = Date.now();
    for (const id of args.ids) {
      await getOwnNotification(ctx, id, userId, orgId);
      await ctx.db.patch(id, { inboxState: "read", readAt: now, updatedAt: now });
    }
  },
});

/**
 * Back to unread. Also clears archivedAt — this doubles as "unarchive"
 * from the archived view.
 */
export const markUnread = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    assertIdsCap(args.ids);

    const now = Date.now();
    for (const id of args.ids) {
      await getOwnNotification(ctx, id, userId, orgId);
      await ctx.db.patch(id, {
        inboxState: "unread",
        readAt: undefined,
        archivedAt: undefined,
        updatedAt: now,
      });
    }
  },
});

export const archive = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    assertIdsCap(args.ids);

    const now = Date.now();
    for (const id of args.ids) {
      await getOwnNotification(ctx, id, userId, orgId);
      await ctx.db.patch(id, { inboxState: "archived", archivedAt: now, updatedAt: now });
    }
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) =>
        q.eq("recipientId", userId).eq("orgId", orgId).eq("inboxState", "unread")
      )
      .take(200);

    const now = Date.now();
    for (const row of unread) {
      await ctx.db.patch(row._id, { inboxState: "read", readAt: now, updatedAt: now });
    }
  },
});

/**
 * Honest badge: mark all of the viewer's unread notifications for one task
 * as read. Called from taskViewReceipts.markViewed, which fires on EVERY
 * task-detail open path — organically reading a task clears its inbox dots.
 */
export async function markTaskNotificationsRead(
  ctx: MutationCtx,
  args: { userId: Id<"users">; orgId: string; taskId: Id<"tasks"> }
): Promise<void> {
  const unread = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_org_state", (q) =>
      q.eq("recipientId", args.userId).eq("orgId", args.orgId).eq("inboxState", "unread")
    )
    .take(SLICE_LIMIT);

  const now = Date.now();
  for (const row of unread) {
    if (row.taskId !== args.taskId) continue;
    await ctx.db.patch(row._id, { inboxState: "read", readAt: now, updatedAt: now });
  }
}

// ─── Snooze ─────────────────────────────────────────────────────────────────────

/**
 * Snooze rows until a wall-clock time. One `wake` is scheduled per row with
 * `expectedUntil` as a guard token: archiving, reading, or re-snoozing
 * changes state/snoozedUntil, so a stale wake fires and no-ops. No
 * scheduler.cancel, no stored scheduled-function ids.
 */
export const snooze = mutation({
  args: { ids: v.array(v.id("notifications")), until: v.number() },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    assertIdsCap(args.ids);

    const now = Date.now();
    for (const id of args.ids) {
      await getOwnNotification(ctx, id, userId, orgId);
      await ctx.db.patch(id, {
        inboxState: "snoozed",
        snoozedUntil: args.until,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(args.until, internal.notifications.wake, {
        notificationId: id,
        expectedUntil: args.until,
      });
    }
  },
});

export const wake = internalMutation({
  args: { notificationId: v.id("notifications"), expectedUntil: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    // Guard token: no-op unless the row is still snoozed for THIS wake
    if (!row || row.inboxState !== "snoozed" || row.snoozedUntil !== args.expectedUntil) {
      return;
    }
    await ctx.db.patch(args.notificationId, {
      inboxState: "unread",
      snoozedUntil: undefined,
      readAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

// ─── Task mutes ─────────────────────────────────────────────────────────────────

export const muteTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Task not found");
    }

    const existing = await ctx.db
      .query("taskMutes")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .unique();
    if (existing) return; // idempotent

    await ctx.db.insert("taskMutes", {
      orgId,
      taskId: args.taskId,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const unmuteTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const existing = await ctx.db
      .query("taskMutes")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .unique();
    if (existing && existing.orgId === orgId) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Drives the mute/unmute menu item label. */
export const isTaskMuted = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { userId } = await getAuthContext(ctx);

    const existing = await ctx.db
      .query("taskMutes")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .unique();
    return existing !== null;
  },
});
