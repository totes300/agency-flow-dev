/**
 * Client-level timesheet collector for the Timesheet agent (PRD slice 03).
 *
 * `collectTimesheetData` loops the client's projects over the EXISTING
 * per-project worksheet collector helpers (resolveScopeEntries +
 * buildTaskRows — the same code every worksheet export runs) and adds
 * the category→columns pivot. It never re-computes a minute: every cell
 * is a sum of collector rows, spot-checkable against the project
 * overview.
 *
 * Admin-gated like the underlying worksheet collector — `assertAdmin` runs
 * on the run's ACTING USER, whose AuthContext the actor path
 * (`agentActorTools.collectTimesheetData`) re-derives from the DB on every
 * call (D6). The registry additionally hides the tool from member runs;
 * this check is the hard gate.
 */

import { v, ConvexError, type ObjectType } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, type AuthContext } from "./lib/auth";
import {
  resolveScopeEntries,
  buildTaskRows,
  type WorksheetTaskRow,
} from "./worksheetsHelpers";
import {
  formatTimesheetPeriodLabel,
  type TimesheetPivotRow,
} from "./lib/timesheetPivot";

/** Full row: pivot fields + the Phase 9 AI input (slice 05 summarizes it). */
export type TimesheetRow = TimesheetPivotRow & {
  projectId: Id<"projects">;
  billableMinutes: number;
  nonBillableMinutes: number;
  entryCount: number;
  aiInput: WorksheetTaskRow["aiInput"];
};

export type TimesheetData = {
  client: { name: string; currency: string };
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  rows: TimesheetRow[];
  /**
   * Org category names in display order (workCategories.sortOrder). The tool
   * builds the pivot table from this + `rows` after the summarize step, so
   * the AI prose columns and deterministic columns land in one table.
   */
  categoryOrder: string[];
};

export const collectTimesheetDataArgs = {
  // Plain strings — they arrive from the model via the tool schema.
  clientId: v.string(),
  periodStart: v.string(), // YYYY-MM-DD
  periodEnd: v.string(),
  periodLabel: v.optional(v.string()),
  projectIds: v.optional(v.array(v.string())),
  categoryNames: v.optional(v.array(v.string())),
  billable: v.optional(
    v.union(
      v.literal("all"),
      v.literal("billable"),
      v.literal("nonBillable"),
    ),
  ),
};

export async function collectTimesheetDataForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: ObjectType<typeof collectTimesheetDataArgs>,
): Promise<TimesheetData> {
  const authCtx = assertAdmin(auth);

  const clientId = ctx.db.normalizeId("clients", args.clientId);
  const client = clientId ? await ctx.db.get(clientId) : null;
  if (!client || client.orgId !== authCtx.orgId) {
    throw new ConvexError(
      "Client not found. Use the listClients tool to get valid client ids.",
    );
  }

  // Resolve category-name filters against the org's categories. Unknown
  // names error with the valid list so the agent can self-correct
  // instead of silently returning an empty (wrong) timesheet.
  const categories = await ctx.db
    .query("workCategories")
    .withIndex("by_orgId", (q) => q.eq("orgId", authCtx.orgId))
    .collect();
  const categoryOrder = [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => c.name);
  let categoryIds: Id<"workCategories">[] | undefined;
  if (args.categoryNames && args.categoryNames.length > 0) {
    categoryIds = [];
    for (const name of args.categoryNames) {
      const match = categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (!match) {
        throw new ConvexError(
          `Unknown work category "${name}". Valid categories: ${categories
            .map((c) => c.name)
            .join(", ")}.`,
        );
      }
      categoryIds.push(match._id);
    }
  }

  // The client's projects (org-checked), optionally narrowed by id.
  let projects = (
    await ctx.db
      .query("projects")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .collect()
  ).filter((p) => p.orgId === authCtx.orgId);
  if (args.projectIds && args.projectIds.length > 0) {
    const wanted = new Set(args.projectIds);
    projects = projects.filter((p) => wanted.has(p._id as string));
    if (projects.length === 0) {
      throw new ConvexError(
        "None of the given project ids belong to this client. Use the listProjects tool to get valid project ids.",
      );
    }
  }

  // Loop the per-project collector — identical logic to every
  // worksheet export, one transaction for the whole client.
  const rows: TimesheetRow[] = [];
  for (const project of projects) {
    const { entries } = await resolveScopeEntries(
      ctx,
      {
        kind: "period",
        projectId: project._id,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        filters: { categoryIds, billable: args.billable ?? "all" },
      },
      authCtx.orgId,
    );
    const projectRows = await buildTaskRows(
      ctx,
      project,
      entries,
      authCtx.orgId,
    );
    for (const r of projectRows) {
      rows.push({
        taskId: r.taskId as string,
        title: r.title,
        projectId: project._id,
        projectName: project.name,
        categoryName: r.categoryName,
        firstWorked: r.firstWorked,
        lastWorked: r.lastWorked,
        totalMinutes: r.totalMinutes,
        billableMinutes: r.billableMinutes,
        nonBillableMinutes: r.nonBillableMinutes,
        entryCount: r.entryCount,
        aiInput: r.aiInput,
      });
    }
  }

  const periodLabel =
    args.periodLabel ??
    formatTimesheetPeriodLabel({
      startDate: args.periodStart,
      endDate: args.periodEnd,
    });

  return {
    client: { name: client.name, currency: client.currency },
    periodLabel,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    rows,
    categoryOrder,
  };
}
