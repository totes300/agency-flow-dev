/**
 * Server-side commit-scope helper — the single bridge between the money
 * mutations (`createInvoice`, `closePeriodInternal`, `closeRetainerCycle`) and
 * the pure `billingScope` module (Month-Close slice 06).
 *
 * At commit time, entry SELECTION is re-derived here from `billingScope`, never
 * trusted from the client (PRD invariant). This is what makes skip stamps and
 * carried-in entries flow correctly into invoices and period closes: a skipped
 * entry (dated in the period) is excluded; a carried-in entry (skipped/logged
 * late from another month) is included. With no skips and no late entries the
 * selection is identical to the old date-range filter (slice-01 baseline).
 */

import type { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { getProjectEntries } from "./projectEntries";
import {
  computeBillingScope,
  type ScopeEntryInput,
  type ScopeProjectInput,
  type BillingScopeReport,
} from "./billingScope";

type AnyCtx =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>;

/** Map a project doc to the pure `billingScope` input shape. */
export function toScopeProjectInput(
  project: Doc<"projects">,
): ScopeProjectInput {
  return {
    _id: project._id,
    billingType: project.billingType,
    startDate: project.startDate,
    rolloverEnabled: project.rolloverEnabled,
    cycleLength: project.cycleLength,
    includedMinutesPerMonth: project.includedMinutesPerMonth,
    overageRate: project.overageRate,
    monthlyFee: project.monthlyFee,
    fixedPrice: project.fixedPrice,
  };
}

/** Map a time-entry doc to the pure `billingScope` input shape. */
export function toScopeEntryInput(e: Doc<"timeEntries">): ScopeEntryInput {
  return {
    _id: e._id,
    date: e.date,
    durationMinutes: e.durationMinutes,
    isBillable: e.isBillable,
    note: e.note,
    billableRate: e.billableRate,
    taskId: e.taskId.toString(),
    workCategoryId: e.snapshotCategoryId?.toString() ?? null,
    invoiceId: e.invoiceId,
    settledAt: e.settledAt ?? null,
    settledReason: e.settledReason ?? null,
    settledPeriodStart: e.settledPeriodStart ?? null,
    settledPeriodEnd: e.settledPeriodEnd ?? null,
    skippedThrough: e.skippedThrough ?? null,
  };
}

export type CommitScope = {
  scope: BillingScopeReport;
  /** All entry docs on the project, keyed by id string — for stamping. */
  entryById: Map<string, Doc<"timeEntries">>;
};

/**
 * Fetch the project's entries + close state and compute the `billingScope`
 * report for a target period. `targetPeriodStart` is YYYY-MM-01 (a month for
 * retainer-monthly / T&M; any month in the cycle for retainer-cycle; ignored
 * for fixed).
 */
export async function computeCommitScope(
  ctx: AnyCtx,
  opts: {
    orgId: string;
    project: Doc<"projects">;
    targetPeriodStart: string;
    todayStr: string;
    roundingMinutes: number;
    fixedBilledFinalized?: number;
  },
): Promise<CommitScope> {
  const { orgId, project } = opts;

  const entries = await getProjectEntries(ctx, orgId, project._id);

  const closedPeriodRows = await ctx.db
    .query("retainerPeriods")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();
  const invoiceRows = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();

  const scope = computeBillingScope({
    project: toScopeProjectInput(project),
    entries: entries.map(toScopeEntryInput),
    closedPeriods: closedPeriodRows.map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      closedAt: p.closedAt ?? null,
    })),
    invoices: invoiceRows.map((inv) => ({
      status: inv.status,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
    })),
    todayStr: opts.todayStr,
    targetPeriodStart: opts.targetPeriodStart,
    roundingMinutes: opts.roundingMinutes,
    fixedBilledFinalized: opts.fixedBilledFinalized,
  });

  return {
    scope,
    entryById: new Map(entries.map((e) => [e._id.toString(), e])),
  };
}

// ─── Pure selection ───────────────────────────────────────────────────────────

export type CommitSelection = {
  /** Entry ids that become invoice line items (billable in-scope). */
  invoiceEntryIds: Set<string>;
  /** Entry ids settled by a period close (all in-scope — incl. non-billable). */
  settleEntryIds: Set<string>;
};

/**
 * Split a scope report into the two commit id-sets. Pure + trivially testable;
 * the hard membership logic (skip / carried / late) already lives — and is
 * exhaustively tested — in `billingScope`.
 *
 *   - invoiceEntryIds: billable in-scope entries → invoice line items + the
 *     `invoiceId` stamp (skipped entries are never in scope, so never stamped).
 *   - settleEntryIds: every in-scope entry (billable AND non-billable per I2)
 *     → the period-close `settledAt` stamp.
 */
export function selectCommitEntries(
  scope: BillingScopeReport,
): CommitSelection {
  const invoiceEntryIds = new Set<string>();
  const settleEntryIds = new Set<string>();
  for (const e of scope.entries) {
    settleEntryIds.add(e.entryId.toString());
    if (e.isBillable) invoiceEntryIds.add(e.entryId.toString());
  }
  return { invoiceEntryIds, settleEntryIds };
}

/** True when a YYYY-MM-DD start/end pair spans exactly one whole calendar month. */
export function isWholeCalendarMonth(
  start: string | undefined,
  end: string | undefined,
): boolean {
  if (!start || !end) return false;
  const m = /^(\d{4})-(\d{2})-01$/.exec(start);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const expectedEnd = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
  return end === expectedEnd;
}

export type { Id };
