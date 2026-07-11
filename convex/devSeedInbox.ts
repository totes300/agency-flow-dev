import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { NotificationType } from "./notifications";

/**
 * DEV-ONLY dummy data. Seeds a handful of unread inbox notifications for a
 * recipient (looked up by email), from another org member, on real tasks — so
 * the Inbox badge + drawer can be seen without another human acting on you.
 *
 * Run:  npx convex run devSeedInbox:seed '{"email":"you@example.com"}'
 * Undo: npx convex run devSeedInbox:clear '{"email":"you@example.com"}'
 *
 * Safe to delete this whole file once you're done eyeballing the design.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Staggered so the drawer buckets into Today / This week (like Notion).
const SAMPLE: Array<{ type: NotificationType; preview: string; ago: number }> = [
  { type: "comment", preview: "@Frances — top version for sure! Let's ship the boxed layout.", ago: 8 * MINUTE },
  { type: "mention_comment", preview: "Btw, please take notes or record so I can follow along, thanks!", ago: 3 * HOUR },
  { type: "assigned", preview: "Assigned you to this task", ago: 6 * HOUR },
  { type: "comment", preview: "Thanks so much! Left instructions below, should be good.", ago: 22 * HOUR },
  { type: "comment_reply", preview: "The second row needs updating — the second column should have the new copy.", ago: 30 * HOUR },
  { type: "mention_description", preview: "Mentioned you in the task description", ago: 50 * HOUR },
];

export const seed = internalMutation({
  args: { email: v.string(), count: v.optional(v.number()) },
  handler: async (ctx, { email, count }) => {
    const users = await ctx.db.query("users").collect();
    const recipient = users.find((u) => u.email === email && !u.deletedAt);
    if (!recipient) throw new Error(`No user with email ${email}`);

    // Recipient's org (first membership resolved to this user).
    const membership = (
      await ctx.db.query("orgMembers").collect()
    ).find((m) => m.userId === recipient._id);
    if (!membership) throw new Error(`No org membership for ${email}`);
    const orgId = membership.orgId;

    // A different member of the same org to act as the notification actor.
    const orgMembers = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const actorMember = orgMembers.find(
      (m) => m.userId && m.userId !== recipient._id,
    );
    const actorId = (actorMember?.userId ?? recipient._id) as Id<"users">;

    // Real tasks in the org to attach notifications to.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(20);
    if (tasks.length === 0) throw new Error(`No tasks in org ${orgId} to attach to`);

    const now = Date.now();
    const items = SAMPLE.slice(0, count ?? SAMPLE.length);
    let inserted = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const task = tasks[i % tasks.length];
      const ts = now - item.ago;
      await ctx.db.insert("notifications", {
        orgId,
        recipientId: recipient._id,
        actorId,
        type: item.type,
        taskId: task._id,
        previewText: item.preview,
        inboxState: "unread",
        createdAt: ts,
        updatedAt: ts,
      });
      inserted++;
    }
    return { inserted, orgId, recipient: recipient.name, actor: actorMember ? "other member" : "self (no other member found)" };
  },
});

/** Delete every notification for the recipient (all states). Reset button. */
export const clear = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db.query("users").collect();
    const recipient = users.find((u) => u.email === email && !u.deletedAt);
    if (!recipient) throw new Error(`No user with email ${email}`);
    const rows = (await ctx.db.query("notifications").collect()).filter(
      (n) => n.recipientId === recipient._id,
    );
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});
