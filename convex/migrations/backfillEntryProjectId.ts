/**
 * One-shot backfill: stamp `timeEntries.projectId` from the entry's task
 * (docs/prd-billing-refactor.md §5.2, slice 1).
 *
 * Widen → backfill → narrow: the schema first accepted `projectId` as
 * optional, every writer now sets it, and this fills the rows written before.
 * Once it reports `remaining: 0` the schema narrows the field to required, so
 * Convex itself guarantees no entry can miss it.
 *
 * Paginated and idempotent — re-run until `isDone` is true:
 *   npx convex run migrations/backfillEntryProjectId:run '{"cursor": null}'
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const run = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("timeEntries")
      .paginate({ cursor: args.cursor, numItems: 500 });

    let stamped = 0;
    const orphans: string[] = [];
    for (const entry of page.page) {
      if (entry.projectId !== undefined) continue;
      const task = await ctx.db.get(entry.taskId);
      if (!task || task.orgId !== entry.orgId || task.projectId === undefined) {
        orphans.push(entry._id);
        continue;
      }
      await ctx.db.patch(entry._id, { projectId: task.projectId });
      stamped++;
    }

    return {
      stamped,
      // Entries whose task is gone or has no project. They must be resolved
      // (or deleted) by hand before the field can be required.
      orphans,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
