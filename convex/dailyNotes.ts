import { v, ConvexError, type ObjectType } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
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

    const notes = await ctx.db
      .query("dailyNotes")
      .withIndex("by_userId_date", (q) =>
        q.eq("userId", userId).eq("date", date)
      )
      .collect();

    // Cross-tenant guard: only return note from current org
    return notes.find((n) => n.orgId === auth.orgId) ?? null;
  },
});

// ─── upsert ──────────────────────────────────────────────────────────────────

const upsertDailyNoteArgs = {
  userId: v.id("users"),
  date: v.string(),
  content: v.optional(v.string()),
};

export type UpsertDailyNoteInput = ObjectType<typeof upsertDailyNoteArgs>;

/**
 * Creates or replaces a member's note for a date (`content` = TipTap JSON
 * string): members their own, admins anyone's in the org. Shared by the
 * Daily Notes panel and MCP `save_daily_notes` (docs/prd-mcp.md §6).
 */
export async function upsertDailyNoteForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  { userId, date, content }: UpsertDailyNoteInput,
): Promise<Id<"dailyNotes">> {
  // Members can only write their own notes
  if (!auth.isAdmin && auth.userId !== userId) {
    throw new ConvexError("You can only edit your own daily notes");
  }

  // Cross-tenant guard: verify target user belongs to this org
  const targetUser = await ctx.db.get(userId);
  if (!targetUser) {
    throw new ConvexError("User not found");
  }
  if (auth.userId !== userId) {
    // Admin writing for another user — verify they're in the same org
    const membership = await ctx.db
      .query("orgMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    if (!membership.some((m) => m.orgId === auth.orgId)) {
      throw new ConvexError("User not found in this organization");
    }
  }

  validateUpsertArgs(date, content);

  const candidates = await ctx.db
    .query("dailyNotes")
    .withIndex("by_userId_date", (q) =>
      q.eq("userId", userId).eq("date", date)
    )
    .collect();
  const existing = candidates.find((n) => n.orgId === auth.orgId);

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
}

export const upsert = mutation({
  args: upsertDailyNoteArgs,
  handler: async (ctx, args) => {
    return await upsertDailyNoteForAuth(ctx, await getAuthContext(ctx), args);
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
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", auth.orgId).eq("userId", userId)
      )
      .order("desc")
      .take(pageSize);

    return notes;
  },
});
