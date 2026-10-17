import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

/**
 * Every time entry of a project, via the org-scoped
 * `by_orgId_projectId_closeId` index (prefix match) — one indexed read instead of a query per task
 * (docs/prd-billing-refactor.md §5.2). Equivalent to walking the project's
 * tasks because an entry's `projectId` is stamped from its task and a task
 * with entries can never change project.
 *
 * Callers must still verify the project belongs to `orgId` before using the
 * result; the index only guarantees the entries do.
 */
export async function getProjectEntries(
  ctx: { db: GenericDatabaseReader<DataModel> },
  orgId: string,
  projectId: Id<"projects">,
): Promise<Doc<"timeEntries">[]> {
  return ctx.db
    .query("timeEntries")
    .withIndex("by_orgId_projectId_closeId", (q) =>
      q.eq("orgId", orgId).eq("projectId", projectId),
    )
    .collect();
}
