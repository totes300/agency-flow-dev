import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { commentSearchText } from "./lib/searchText";
import { backfillTaskSearchText } from "./tasks/write";

/** Documents read per run; each run schedules the next (docs/prd-agent-first-backlog.md S5). */
const BACKFILL_BATCH = 200;

/**
 * One-off backfill of `searchText` on tasks, then comments, so records
 * written before full-text search are findable. Paged by creation order with
 * a scheduler continuation; idempotent — a document that already has
 * `searchText` is skipped. Start once per deployment:
 * `npx convex run search:backfillSearchText` (production only with the
 * owner's yes, docs/runbooks/mcp-deployment.md).
 */
export const backfillSearchText = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("tasks"), v.literal("comments"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    filled: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const table = args.table ?? "tasks";
    const cursor = args.cursor ?? null;
    let filled = args.filled ?? 0;
    let page;
    if (table === "tasks") {
      // Task rows are written only by tasks/write.ts (T2).
      page = await ctx.db.query("tasks").paginate({ numItems: BACKFILL_BATCH, cursor });
      for (const task of page.page) if (await backfillTaskSearchText(ctx, task)) filled += 1;
    } else {
      page = await ctx.db.query("comments").paginate({ numItems: BACKFILL_BATCH, cursor });
      for (const comment of page.page) {
        if (comment.searchText !== undefined) continue;
        await ctx.db.patch(comment._id, { searchText: commentSearchText(comment.content) });
        filled += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.search.backfillSearchText, { table, cursor: page.continueCursor, filled });
    } else if (table === "tasks") {
      await ctx.scheduler.runAfter(0, internal.search.backfillSearchText, { table: "comments", cursor: null, filled });
    } else {
      console.log(`[search] backfillSearchText done: ${filled} documents filled`);
    }
    return null;
  },
});
