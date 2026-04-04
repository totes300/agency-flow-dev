import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { validateUpsertArgs } from "./lib/dailyNotesHelpers";

// ─── get ─────────────────────────────────────────────────────────────────────

export const get = query({
  args: {
    userId: v.id("users"),
    date: v.string(),
  },
  handler: async (ctx, { userId, date }) => {
    const auth = await getAuthContext(ctx);

    // Members can only read their own notes
    if (!auth.isAdmin && auth.userId !== userId) {
      throw new ConvexError("You can only view your own daily notes");
    }

    const note = await ctx.db
      .query("dailyNotes")
      .withIndex("by_userId_date", (q) =>
        q.eq("userId", userId).eq("date", date)
      )
      .unique();

    return note ?? null;
  },
});

// ─── upsert ──────────────────────────────────────────────────────────────────

export const upsert = mutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    content: v.optional(v.string()),
  },
  handler: async (ctx, { userId, date, content }) => {
    const auth = await getAuthContext(ctx);

    // Members can only write their own notes
    if (!auth.isAdmin && auth.userId !== userId) {
      throw new ConvexError("You can only edit your own daily notes");
    }

    validateUpsertArgs(date, content);

    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_userId_date", (q) =>
        q.eq("userId", userId).eq("date", date)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("dailyNotes", {
      orgId: auth.orgId,
      userId,
      date,
      content,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

// ─── list ────────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit }) => {
    const auth = await getAuthContext(ctx);

    // Members can only list their own notes
    if (!auth.isAdmin && auth.userId !== userId) {
      throw new ConvexError("You can only view your own daily notes");
    }

    const pageSize = limit ?? 30;

    const notes = await ctx.db
      .query("dailyNotes")
      .withIndex("by_userId_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(pageSize);

    return notes;
  },
});
