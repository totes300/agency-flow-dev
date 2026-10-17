/**
 * Loads a project's billing state into the shapes the pure modules take
 * (`scope.ts`, `pricing.ts`). The only place that maps Convex docs to the
 * close model — every close-model query and mutation goes through here.
 */

import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import { getProjectEntries } from "../projectEntries";
import { toMinor } from "./money";
import { absMonthOf } from "./periods";
import { buildRetainerUsageRows } from "../retainerUsage";
import type { PricedEntry, PricingProject } from "./pricing";
import type { ScopeEntry, ScopeProject } from "./scope";

type Reader = { db: GenericDatabaseReader<DataModel> };

/** A time entry as both the scope rule and the pricing function see it. */
export type BillingEntry = ScopeEntry &
  PricedEntry & {
    _id: Id<"timeEntries">;
    doc: Doc<"timeEntries">;
  };

export type ClosableProject = Doc<"projects"> & { billingType: "retainer" | "t_and_m" };

export function isClosableProject(project: Doc<"projects">): project is ClosableProject {
  return project.billingType === "retainer" || project.billingType === "t_and_m";
}

/**
 * Locked = settled by a live close (N1). `closeId` is cleared when a close is
 * released, so its presence alone means live.
 */
export function isEntryLocked(e: Doc<"timeEntries">): boolean {
  return e.closeId !== undefined;
}

export function toBillingEntry(e: Doc<"timeEntries">, currency: string): BillingEntry {
  return {
    _id: e._id,
    doc: e,
    date: e.date,
    isBillable: e.isBillable,
    skippedThrough: e.skippedThrough,
    locked: isEntryLocked(e),
    minutes: e.durationMinutes,
    taskId: e.taskId,
    categoryId: e.snapshotCategoryId ?? null,
    billableRateMinor: toMinor(e.billableRate, currency),
  };
}

export function toScopeProject(project: ClosableProject): ScopeProject {
  return {
    billingType: project.billingType,
    startDate: project.startDate,
    rolloverEnabled: project.rolloverEnabled,
    cycleLength: project.cycleLength,
  };
}

export function toPricingProject(project: ClosableProject, currency: string): PricingProject {
  return {
    ...toScopeProject(project),
    includedMinutesPerMonth: project.includedMinutesPerMonth,
    overageRateMinor: toMinor(project.overageRate ?? 0, currency),
  };
}

/** Live (draft or final) closes of a project, oldest first. */
export async function getLiveCloses(
  ctx: Reader,
  orgId: string,
  projectId: Id<"projects">,
): Promise<Doc<"billingCloses">[]> {
  const closes = await ctx.db
    .query("billingCloses")
    .withIndex("by_orgId_projectId_periodStart", (q) =>
      q.eq("orgId", orgId).eq("projectId", projectId),
    )
    .collect();
  return closes.filter((c) => c.status !== "released");
}

export type CloseContext = {
  project: ClosableProject;
  client: Doc<"clients">;
  currency: string;
  entries: BillingEntry[];
  liveCloses: Doc<"billingCloses">[];
  livePeriods: { start: string; end: string }[];
};

/**
 * Everything the scope rule and pricing need for one project. Verifies the
 * project and its client belong to `orgId` (tenant boundary).
 */
export async function loadCloseContext(
  ctx: Reader,
  orgId: string,
  projectId: Id<"projects">,
): Promise<CloseContext> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== orgId) throw new ConvexError("Project not found.");
  if (!isClosableProject(project)) {
    throw new ConvexError("Only retainer and Time & Materials projects are closed by period.");
  }
  const client = await ctx.db.get(project.clientId);
  if (!client || client.orgId !== orgId) throw new ConvexError("Client not found for project.");
  const currency = client.currency;
  const docs = await getProjectEntries(ctx, orgId, projectId);
  const liveCloses = await getLiveCloses(ctx, orgId, projectId);
  return {
    project,
    client,
    currency,
    entries: docs.map((d) => toBillingEntry(d, currency)),
    liveCloses,
    livePeriods: liveCloses.map((c) => ({ start: c.periodStart, end: c.periodEnd })),
  };
}

/**
 * The pricing inputs a close froze at commit, so a closed period re-prices to
 * exactly its stored numbers even after the project's settings change. The
 * grid is the close's own span (a cycle close stays a cycle).
 */
export function frozenPricingProject(close: Doc<"billingCloses">): PricingProject {
  const months = absMonthOf(close.periodEnd) - absMonthOf(close.periodStart) + 1;
  return {
    billingType: close.kind,
    startDate: close.periodStart,
    rolloverEnabled: months > 1,
    cycleLength: months,
    includedMinutesPerMonth: close.includedMinutes / months,
    overageRateMinor: close.overageRateMinor,
  };
}

/** A close's snapshot rows as pricing members. */
export function snapshotMembers(
  rows: Doc<"billingCloseEntries">[],
): { entry: PricedEntry & { _id: Id<"timeEntries"> }; carried?: Doc<"billingCloseEntries">["carried"] }[] {
  return rows.map((r) => ({
    entry: {
      _id: r.entryId,
      date: r.date,
      minutes: r.minutes,
      isBillable: r.isBillable,
      taskId: r.taskId,
      categoryId: r.categoryId ?? null,
      billableRateMinor: r.billableRateMinor,
    },
    ...(r.carried ? { carried: r.carried } : {}),
  }));
}

/**
 * The retainer usage block an invoice document shows, from the close that
 * produced it — its frozen totals plus the per-month split of its snapshot.
 * Same shape as `billingReports.getMonthlyReport`'s usage block.
 */
export async function closeRetainerUsage(
  ctx: Reader,
  close: Doc<"billingCloses">,
  amountDue: number,
) {
  const rows = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
    .collect();
  const firstAbs = absMonthOf(close.periodStart);
  const monthCount = absMonthOf(close.periodEnd) - firstAbs + 1;
  const months = Array.from({ length: monthCount }, (_, i) => {
    const abs = firstAbs + i;
    return { year: Math.floor(abs / 12), month: (abs % 12) + 1 };
  });
  const usedMinutesByMonth = new Map<string, number>();
  for (const r of rows) {
    if (!r.isBillable) continue;
    usedMinutesByMonth.set(r.monthKey, (usedMinutesByMonth.get(r.monthKey) ?? 0) + r.minutes);
  }
  const monthlyIncludedMinutes = close.includedMinutes / monthCount;
  return {
    kind: monthCount > 1 ? ("cycle" as const) : ("month" as const),
    closed: true,
    monthlyIncludedMinutes,
    rows: buildRetainerUsageRows({ months, monthlyIncludedMinutes, usedMinutesByMonth }),
    total: {
      availableMinutes: close.includedMinutes,
      usedMinutes: close.usageMinutes,
      balanceMinutes: close.includedMinutes - close.usageMinutes,
      amountDue,
    },
  };
}

/** The entry documents of a close's snapshot, optionally one report month only. */
export async function closeSnapshotEntries(
  ctx: Reader,
  orgId: string,
  closeId: Id<"billingCloses">,
  monthKey?: string,
): Promise<Doc<"timeEntries">[]> {
  const close = await ctx.db.get(closeId);
  if (!close || close.orgId !== orgId) return [];
  const rows = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
    .collect();
  const out: Doc<"timeEntries">[] = [];
  for (const r of rows) {
    if (monthKey !== undefined && r.monthKey !== monthKey) continue;
    const e = await ctx.db.get(r.entryId);
    if (e && e.orgId === orgId) out.push(e);
  }
  return out;
}
