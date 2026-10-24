/**
 * A project's billing periods as ONE read model — the project page (period
 * header, trend, period card, Billing tab, tab count), the Billing hub and the
 * sidebar badge all read this, so they cannot disagree
 * (docs/prd-project-billing-redesign.md §6.1, §6.2).
 *
 *   - Closed periods read the close's frozen fields; their minutes come from
 *     the entries locked to the close (N2: the same set as the snapshot), so
 *     no snapshot table is read per close.
 *   - Open periods are priced live with `scopeOf` + `priceScope` — the call
 *     `commitClose` makes.
 *   - State, action and undo come from `periodState.ts` only.
 *
 * Callers authorize (admin) and pass an org-verified project.
 */

import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import {
  isClosableProject,
  loadCloseContext,
  toPricingProject,
  toScopeProject,
  type BillingEntry,
} from "./closeData";
import { formatInvoiceNumber, monthLabel } from "./labels";
import { toMinor } from "./money";
import {
  absMonthOf,
  monthBucket,
  monthKeyFromAbs,
  nextPeriod,
  periodOfDate,
  type Period,
} from "./periods";
import {
  countPeriods,
  derivePeriodState,
  invoiceDisplayStatus,
  isNeedsAction,
  periodPrimaryAction,
  periodUndoActions,
  type InvoiceDisplayStatus,
  type PeriodRef,
  type PeriodState,
  type PrimaryAction,
  type UndoAction,
} from "./periodState";
import { priceScope } from "./pricing";
import { committablePeriod, effectivePeriod, scopeOf } from "./scope";

type Reader = { db: GenericDatabaseReader<DataModel> };

// ─── Response types (the UI's contract) ──────────────────────────────────────

export type PeriodInvoice = {
  id: Id<"invoices">;
  /** "INV-042"; null while the invoice has never been numbered. */
  number: string | null;
  status: InvoiceDisplayStatus;
  issueDate: string;
  dueDate: string | null;
  paidAt: number | null;
  totalMinor: number;
};

export type PeriodRow = {
  /** YYYY-MM of the period start — the `?period=` and workspace token. */
  key: string;
  start: string;
  end: string;
  /** "August 2026" | "Aug – Oct 2026". */
  label: string;
  /** Calendar months of the period with their billable minutes (trend, rollover breakdown). */
  months: { key: string; label: string; workedMinutes: number }[];
  /** Billable minutes that count toward money (raw). */
  usageMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  /** Retainer allowance of the period; null for T&M. */
  includedMinutes: number | null;
  overageMinutes: number;
  /** Live price (open) or the close's frozen amount (closed). */
  amountMinor: number;
  /** Over budget with no overage rate (open periods only). */
  missingRate: boolean;
  state: PeriodState;
  isCommittable: boolean;
  blockedBy: PeriodRef | null;
  /** §5.3 — the one button; null when the state has none. */
  action: PrimaryAction | null;
  /** §5.4 — the ⋯ menu's undo items. */
  undo: UndoAction[];
  closeId: Id<"billingCloses"> | null;
  closeStatus: "draft" | "final" | null;
  /** When the close was committed (epoch ms) — "Closed Oct 2". */
  closedAt: number | null;
  invoice: PeriodInvoice | null;
  documents: { monthlyReport: "final" | "preview" | null; worksheet: "close" | "range" };
};

export type FixedBilling = {
  priceMinor: number;
  /** Σ fixed lines on finalized (invoiced, paid) invoices. */
  invoicedMinor: number;
  /** Σ fixed lines on drafts. */
  draftMinor: number;
  remainingMinor: number;
  draft: { id: Id<"invoices"> } | null;
  status: "not_invoiced" | "partly_invoiced" | "draft" | "fully_invoiced";
};

export type ProjectBillingPeriods = {
  projectId: Id<"projects">;
  billingType: Doc<"projects">["billingType"];
  currency: string;
  /** Today in the org timezone (YYYY-MM-DD). */
  timezoneToday: string;
  terms: {
    includedMinutesPerMonth: number | null;
    monthlyFeeMinor: number | null;
    overageRateMinor: number | null;
    rolloverEnabled: boolean;
    cycleLength: number;
    fixedPriceMinor: number | null;
    roundingMinutes: number;
  };
  /** Newest first, from the first period to the current one. */
  periods: PeriodRow[];
  /** Key of the period containing today, when the project has one. */
  currentKey: string | null;
  needsActionCount: number;
  pastDueCount: number;
  latestInvoice: PeriodInvoice | null;
  totals: { unbilledMinor: number; outstandingMinor: number };
  /** The project's invoices, newest first (void included). */
  invoices: PeriodInvoice[];
  fixed: FixedBilling | null;
};

// ─── Labels ──────────────────────────────────────────────────────────────────

const shortMonth = (key: string) =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });

/** "August 2026", "Aug – Oct 2026" or "Nov 2025 – Jan 2026". */
export function periodRangeLabel(start: string, end: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return monthLabel(start);
  const sy = start.slice(0, 4);
  const ey = end.slice(0, 4);
  return sy === ey
    ? `${shortMonth(start)} – ${shortMonth(end)} ${ey}`
    : `${shortMonth(start)} ${sy} – ${shortMonth(end)} ${ey}`;
}

export function periodRef(p: Period): PeriodRef {
  return { key: p.start.slice(0, 7), label: periodRangeLabel(p.start, p.end) };
}

function toPeriodInvoice(inv: Doc<"invoices">, todayStr: string): PeriodInvoice {
  return {
    id: inv._id,
    number: inv.number != null ? formatInvoiceNumber(inv.prefix, inv.number) : null,
    status: invoiceDisplayStatus(inv.status, inv.dueDate, todayStr),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate ?? null,
    paidAt: inv.paidAt ?? null,
    totalMinor: inv.totalMinor,
  };
}

function monthsOf(period: Period, entries: { date: string; minutes: number; isBillable: boolean }[]) {
  const first = absMonthOf(period.start);
  const count = absMonthOf(period.end) - first + 1;
  const keys = Array.from({ length: count }, (_, i) => monthKeyFromAbs(first + i));
  const worked = new Map(keys.map((k) => [k, 0]));
  for (const e of entries) {
    if (!e.isBillable) continue;
    const key = monthBucket(e.date, period);
    worked.set(key, (worked.get(key) ?? 0) + e.minutes);
  }
  return keys.map((key) => ({ key, label: monthLabel(key), workedMinutes: worked.get(key) ?? 0 }));
}

function splitMinutes(entries: { minutes: number; isBillable: boolean }[]) {
  let billable = 0;
  let nonBillable = 0;
  for (const e of entries) {
    if (e.isBillable) billable += e.minutes;
    else nonBillable += e.minutes;
  }
  return { billable, nonBillable };
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export type BillingSettings = { todayStr: string; roundingMinutes: number };

/** Every invoice of the project, newest first. */
async function projectInvoices(ctx: Reader, orgId: string, projectId: Id<"projects">) {
  const docs = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();
  return docs.filter((inv) => inv.orgId === orgId);
}

/**
 * The read model for one project. The project must already be verified to
 * belong to `orgId`; its client is re-checked by `loadCloseContext`.
 */
export async function buildProjectBillingPeriods(
  ctx: Reader,
  orgId: string,
  project: Doc<"projects">,
  currency: string,
  settings: BillingSettings,
): Promise<ProjectBillingPeriods> {
  const { todayStr } = settings;
  const invoiceDocs = await projectInvoices(ctx, orgId, project._id);
  const invoices = invoiceDocs.map((inv) => toPeriodInvoice(inv, todayStr));
  const live = invoices.filter((inv) => inv.status !== "void");
  const pastDueCount = live.filter((inv) => inv.status === "past_due").length;
  const outstandingMinor = live
    .filter((inv) => inv.status === "invoiced" || inv.status === "past_due")
    .reduce((sum, inv) => sum + inv.totalMinor, 0);
  const draftTotalMinor = live.filter((inv) => inv.status === "draft").reduce((sum, inv) => sum + inv.totalMinor, 0);

  const base: ProjectBillingPeriods = {
    projectId: project._id,
    billingType: project.billingType,
    currency,
    timezoneToday: todayStr,
    terms: {
      includedMinutesPerMonth: project.includedMinutesPerMonth ?? null,
      monthlyFeeMinor: project.monthlyFee !== undefined ? toMinor(project.monthlyFee, currency) : null,
      overageRateMinor: project.overageRate !== undefined ? toMinor(project.overageRate, currency) : null,
      rolloverEnabled: project.rolloverEnabled ?? false,
      cycleLength: project.cycleLength ?? 1,
      fixedPriceMinor: project.fixedPrice !== undefined ? toMinor(project.fixedPrice, currency) : null,
      roundingMinutes: settings.roundingMinutes,
    },
    periods: [],
    currentKey: null,
    needsActionCount: 0,
    pastDueCount,
    latestInvoice: live[0] ?? null,
    totals: { unbilledMinor: draftTotalMinor, outstandingMinor },
    invoices,
    fixed: null,
  };

  if (project.billingType === "fixed") {
    const fixed = await fixedBilling(ctx, orgId, project, currency, invoiceDocs);
    return { ...base, fixed, needsActionCount: live.filter((inv) => inv.status === "draft").length };
  }
  if (!isClosableProject(project)) return base;

  const c = await loadCloseContext(ctx, orgId, project._id);
  const grid = toScopeProject(c.project);
  const pricing = toPricingProject(c.project, currency);
  const roundingMinutes = project.billingType === "retainer" ? 1 : settings.roundingMinutes;
  const invoiceById = new Map(invoiceDocs.map((inv) => [inv._id, inv]));
  const lockedByClose = new Map<Id<"billingCloses">, BillingEntry[]>();
  for (const e of c.entries) {
    if (!e.doc.closeId) continue;
    const list = lockedByClose.get(e.doc.closeId) ?? [];
    list.push(e);
    lockedByClose.set(e.doc.closeId, list);
  }
  const closeOf = (p: Period) =>
    c.liveCloses.find((cl) => cl.periodStart <= p.end && cl.periodEnd >= p.start) ?? null;
  const committable = committablePeriod({
    project: grid,
    entries: c.entries,
    liveCloses: c.livePeriods,
    todayStr,
  }).period;
  const current = grid.billingType === "retainer" && !c.project.startDate ? null : periodOfDate(grid, todayStr);

  const spans = periodSpans(c, current, todayStr);
  const rows: PeriodRow[] = spans.map((span) => {
    const close = closeOf(span);
    const ended = span.end < todayStr;
    const invoiceDoc = close?.invoiceId ? invoiceById.get(close.invoiceId) ?? null : null;

    let usageMinutes: number;
    let minutes: { billable: number; nonBillable: number };
    let months: PeriodRow["months"];
    let includedMinutes: number | null;
    let overageMinutes: number;
    let amountMinor: number;
    let missingRate = false;
    if (close) {
      const locked = lockedByClose.get(close._id) ?? [];
      minutes = splitMinutes(locked);
      months = monthsOf(span, locked);
      usageMinutes = close.usageMinutes;
      includedMinutes = close.kind === "retainer" ? close.includedMinutes : null;
      overageMinutes = close.overageMinutes;
      amountMinor = close.amountMinor;
    } else {
      const members = scopeOf<BillingEntry>({ project: grid, entries: c.entries, liveCloses: c.livePeriods, period: span });
      const price = priceScope({ project: pricing, period: span, members, roundingMinutes, todayStr });
      const entries = members.map((m) => m.entry);
      minutes = splitMinutes(entries);
      months = monthsOf(span, entries);
      usageMinutes = price.usageMinutes;
      includedMinutes = project.billingType === "retainer" ? price.includedMinutes : null;
      overageMinutes = price.overageMinutes;
      amountMinor = price.amountMinor;
      missingRate = price.issues.includes("missing-overage-rate");
    }

    const state = derivePeriodState({
      periodEnded: ended,
      liveClose: close ? { status: close.status === "draft" ? "draft" : "final" } : null,
      invoice: invoiceDoc ? { status: invoiceDoc.status, dueDate: invoiceDoc.dueDate } : null,
      amountMinor,
      missingRate,
      todayOrgTz: todayStr,
    });
    const open = !close && ended;
    const isCommittable = open && committable?.start === span.start;
    const blockedBy = open && committable && committable.start < span.start ? periodRef(committable) : null;
    const laterClose = close
      ? c.liveCloses
          .filter((cl) => cl.periodStart > close.periodStart)
          .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))[0]
      : undefined;

    return {
      key: span.start.slice(0, 7),
      start: span.start,
      end: span.end,
      label: periodRangeLabel(span.start, span.end),
      months,
      usageMinutes,
      billableMinutes: minutes.billable,
      nonBillableMinutes: minutes.nonBillable,
      includedMinutes,
      overageMinutes,
      amountMinor,
      missingRate,
      state,
      isCommittable,
      blockedBy,
      action: periodPrimaryAction(state, { isCommittable, ...(blockedBy ? { blockedBy } : {}) }),
      undo: periodUndoActions(state, {
        draftNumbered: invoiceDoc?.number != null,
        ...(laterClose ? { laterLiveClose: periodRef({ start: laterClose.periodStart, end: laterClose.periodEnd }) } : {}),
      }),
      closeId: close?._id ?? null,
      closeStatus: close ? (close.status === "draft" ? "draft" : "final") : null,
      closedAt: close?.committedAt ?? null,
      invoice: invoiceDoc ? toPeriodInvoice(invoiceDoc, todayStr) : null,
      documents: {
        monthlyReport: project.billingType === "retainer" ? (close?.status === "final" ? "final" : "preview") : null,
        worksheet: close ? "close" : "range",
      },
    };
  });

  const periods = rows.reverse();
  const counts = countPeriods(periods.map((p) => p.state));
  const readyMinor = periods
    .filter((p) => p.state === "ready_to_invoice")
    .reduce((sum, p) => sum + p.amountMinor, 0);
  // Drafts not tied to a period row (none today) still count, once.
  const periodDrafts = new Set(periods.filter((p) => p.state === "draft").map((p) => p.invoice?.id));
  const strayDrafts = live.filter((inv) => inv.status === "draft" && !periodDrafts.has(inv.id)).length;
  return {
    ...base,
    periods,
    currentKey: current ? current.start.slice(0, 7) : null,
    needsActionCount: counts.needsActionCount + strayDrafts,
    totals: { unbilledMinor: readyMinor + draftTotalMinor, outstandingMinor },
  };
}

/**
 * The periods a project shows, oldest first:
 *   - retainer: every period of the grid from the start date to the current
 *     one (empty ones too — they must be closed, oldest-first);
 *   - T&M: the current month, every live close, and every ended month with
 *     open billable scope (§5.1: an empty ended T&M month is not a period).
 * A live close keeps its own span even if the grid has since moved.
 */
function periodSpans(
  c: Awaited<ReturnType<typeof loadCloseContext>>,
  current: Period | null,
  todayStr: string,
): Period[] {
  const grid = toScopeProject(c.project);
  const byStart = new Map<string, Period>();
  const add = (p: Period) => {
    const close = c.liveCloses.find((cl) => cl.periodStart <= p.end && cl.periodEnd >= p.start);
    const span = close ? { start: close.periodStart, end: close.periodEnd } : p;
    byStart.set(span.start, span);
    return span;
  };

  if (grid.billingType === "retainer") {
    if (!grid.startDate || !current) return [];
    for (let p = periodOfDate(grid, grid.startDate); p.start <= current.start; ) {
      const span = add(p);
      p = nextPeriod(grid, periodOfDate(grid, span.end));
    }
  } else {
    if (current) add(current);
    for (const cl of c.liveCloses) add({ start: cl.periodStart, end: cl.periodEnd });
    for (const e of c.entries) {
      if (e.locked || !e.isBillable) continue;
      const p = effectivePeriod(grid, e, c.livePeriods);
      if (p.end < todayStr) add(p);
    }
  }
  return [...byStart.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
}

async function fixedBilling(
  ctx: Reader,
  orgId: string,
  project: Doc<"projects">,
  currency: string,
  invoices: Doc<"invoices">[],
): Promise<FixedBilling> {
  let invoicedMinor = 0;
  let draftMinor = 0;
  let draft: FixedBilling["draft"] = null;
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const lines = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
      .collect();
    const fixedMinor = lines
      .filter((li) => li.orgId === orgId && li.lineType === "fixed")
      .reduce((sum, li) => sum + li.amountMinor, 0);
    if (inv.status === "draft") {
      draftMinor += fixedMinor;
      draft ??= { id: inv._id };
    } else {
      invoicedMinor += fixedMinor;
    }
  }
  const priceMinor = toMinor(project.fixedPrice ?? 0, currency);
  const remainingMinor = priceMinor - invoicedMinor - draftMinor;
  return {
    priceMinor,
    invoicedMinor,
    draftMinor,
    remainingMinor,
    draft,
    status: draft
      ? "draft"
      : invoicedMinor === 0
        ? "not_invoiced"
        : invoicedMinor >= priceMinor
          ? "fully_invoiced"
          : "partly_invoiced",
  };
}

/** Needs-action period rows of a project (§5.5), oldest first — the hub's rows. */
export function needsActionPeriods(model: ProjectBillingPeriods): PeriodRow[] {
  return model.periods.filter((p) => isNeedsAction(p.state)).reverse();
}
