import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAdmin, validateStringLength } from "./lib/auth";
import { getOrgSettings, getProjectCurrency } from "./lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import {
  canEditInvoiceMessage,
  findResumableInvoice,
  assertRetainerInvoiceable,
  assertRolloverCycleEnd,
} from "./lib/invoiceCreation";
import {
  computeRetainerBalance,
  getRetainerRecalcCyclePosition,
  getRetainerCyclePosition,
  getRetainerCycleStartMonth,
} from "./lib/retainerBalance";
import {
  buildFixedReadyRow,
  buildRetainerCycleReadyRows,
  buildRetainerMonthlyReadyRows,
  buildTmReadyRows,
  enumerateRetainerCycleState,
  isCloseRow,
  shouldAppearInInbox,
  sortReadyRows,
  type ReadyRow,
} from "./lib/readyToInvoice";
import { getInvoiceAnchorMonthKey } from "./lib/invoiceAnchor";
import {
  settleInvoiceEntries,
  unsettleInvoiceEntries,
} from "./lib/settleEntries";
import {
  classifyMarkPaid,
  classifyUndo,
  type PriorState,
} from "./lib/markPaid";
import {
  buildRetainerUsageRows,
  monthRangeFrom,
  reconcileUsedMinutesToTotal,
  type YearMonth,
} from "./lib/retainerUsage";
import { resolveInvoiceByIdentifier } from "./lib/invoiceIdentifier";
import type { Doc, Id } from "./_generated/dataModel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Round minutes UP to the nearest `roundTo` block. 0 or 1 = no rounding. */
function roundMinutesUp(minutes: number, roundTo: number): number {
  if (roundTo <= 1) return minutes;
  return Math.ceil(minutes / roundTo) * roundTo;
}

/** Round a number to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format a month label from a YYYY-MM-DD date string. */
function monthLabel(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthShortLabel(dateStr: string): string {
  const [, month] = dateStr.split("-");
  const date = new Date(2000, Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short" });
}

function periodSubjectLabel(periodStart: string, periodEnd: string): string {
  if (periodStart.slice(0, 7) === periodEnd.slice(0, 7)) {
    return monthLabel(periodStart);
  }
  const startYear = periodStart.slice(0, 4);
  const endYear = periodEnd.slice(0, 4);
  const startMonth = monthShortLabel(periodStart);
  const endMonth = monthShortLabel(periodEnd);
  if (startYear === endYear) return `${startMonth}-${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}-${endMonth} ${endYear}`;
}

/** Inclusive month list from a YYYY-MM-DD periodStart to periodEnd. */
function invoiceMonthRange(
  periodStart: string | undefined,
  periodEnd: string | undefined,
): YearMonth[] {
  if (!periodStart || !periodEnd) return [];
  const [startYear, startMonth] = periodStart.split("-").map(Number);
  const [endYear, endMonth] = periodEnd.split("-").map(Number);
  const span = (endYear * 12 + (endMonth - 1)) - (startYear * 12 + (startMonth - 1)) + 1;
  return monthRangeFrom({ year: startYear, month: startMonth }, span);
}

/** Format an invoice number for display/search, matching lib/format.ts:formatInvoiceNumber. */
function formatInvoiceNumber(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(3, "0")}`;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List invoices, optionally filtered by projectId.
 * Returns denormalized client/project info for display.
 */
export const listInvoices = query({
  args: {
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    let invoices: Doc<"invoices">[];
    if (args.projectId) {
      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId!))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
    } else {
      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    // Sort newest first
    invoices.sort((a, b) => b.createdAt - a.createdAt);

    // Denormalize client and project info (tenancy-guarded)
    const result = await Promise.all(
      invoices.map(async (inv) => {
        const project = await ctx.db.get(inv.projectId);
        const client = await ctx.db.get(inv.clientId);
        const safeProject = project && project.orgId === orgId ? project : null;
        const safeClient = client && client.orgId === orgId ? client : null;
        return {
          ...inv,
          projectName: safeProject?.name ?? "Unknown",
          projectBillingType: safeProject?.billingType ?? "t_and_m",
          clientName: safeClient?.name ?? "Unknown",
        };
      }),
    );

    return result;
  },
});

/**
 * List ALL invoices for the org with optional filters.
 * Used by the global /invoices page. Shape is InvoiceRow-compatible.
 */
export const listAllInvoices = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("invoiced"),
        v.literal("paid"),
        v.literal("void"),
      ),
    ),
    // Multi-value filters with optional "is not" operator. Shape mirrors the
    // `Filter[]` wire format the UI uses so args build up from filters 1:1.
    clientIds: v.optional(v.array(v.id("clients"))),
    clientIdsOp: v.optional(v.union(v.literal("is"), v.literal("isNot"))),
    projectIds: v.optional(v.array(v.id("projects"))),
    projectIdsOp: v.optional(v.union(v.literal("is"), v.literal("isNot"))),
    // Inclusive YYYY-MM-DD ranges. Empty strings are ignored (the UI
    // materializes a date-range filter before the user picks both ends).
    issueDateFrom: v.optional(v.string()),
    issueDateTo: v.optional(v.string()),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    let invoices: Doc<"invoices">[];
    if (args.status) {
      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", orgId).eq("status", args.status!),
        )
        .collect();
    } else {
      invoices = await ctx.db
        .query("invoices")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    if (args.clientIds && args.clientIds.length > 0) {
      const set = new Set(args.clientIds);
      const isNot = args.clientIdsOp === "isNot";
      invoices = invoices.filter((inv) =>
        isNot ? !set.has(inv.clientId) : set.has(inv.clientId),
      );
    }
    if (args.projectIds && args.projectIds.length > 0) {
      const set = new Set(args.projectIds);
      const isNot = args.projectIdsOp === "isNot";
      invoices = invoices.filter((inv) =>
        isNot ? !set.has(inv.projectId) : set.has(inv.projectId),
      );
    }

    if (args.issueDateFrom) {
      invoices = invoices.filter((inv) => inv.issueDate >= args.issueDateFrom!);
    }
    if (args.issueDateTo) {
      invoices = invoices.filter((inv) => inv.issueDate <= args.issueDateTo!);
    }
    if (args.dueDateFrom) {
      invoices = invoices.filter(
        (inv) => inv.dueDate != null && inv.dueDate >= args.dueDateFrom!,
      );
    }
    if (args.dueDateTo) {
      invoices = invoices.filter(
        (inv) => inv.dueDate != null && inv.dueDate <= args.dueDateTo!,
      );
    }

    const searchTerm = args.search?.trim().toLowerCase();
    if (searchTerm) {
      invoices = invoices.filter((inv) => {
        // Unnumbered drafts match the literal term "draft" instead of a
        // formatted number.
        const formatted =
          inv.number != null
            ? formatInvoiceNumber(inv.prefix, inv.number).toLowerCase()
            : "draft";
        return (
          formatted.includes(searchTerm) ||
          (inv.subject?.toLowerCase().includes(searchTerm) ?? false)
        );
      });
    }

    invoices.sort((a, b) => b.createdAt - a.createdAt);

    const result = await Promise.all(
      invoices.map(async (inv) => {
        const project = await ctx.db.get(inv.projectId);
        const client = await ctx.db.get(inv.clientId);
        // Tenancy guard: never surface a related doc that doesn't belong to this org.
        const safeProject = project && project.orgId === orgId ? project : null;
        const safeClient = client && client.orgId === orgId ? client : null;
        return {
          ...inv,
          projectName: safeProject?.name ?? "Unknown",
          projectBillingType: safeProject?.billingType ?? "t_and_m",
          clientName: safeClient?.name ?? "Unknown",
        };
      }),
    );

    return result;
  },
});

/**
 * Returns `true` if at least one invoice exists for the org.
 * Used by Settings > Invoicing to lock the `nextInvoiceNumber` counter once
 * the sequence has started (see convex/orgSettings.ts:update).
 */
export const hasAnyInvoice = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);
    const first = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();
    return first !== null;
  },
});

/**
 * Aggregate metrics for the global /invoices page.
 * Returns per-currency sums + counts for Draft, Unpaid, Past due, Paid This Month.
 *
 *   Unpaid   = status "invoiced" AND (no dueDate OR dueDate >= today)
 *   Past due = status "invoiced" AND dueDate <  today
 *
 * "Past due" is derived, not stored — server recomputes it each call against
 * today in the org timezone so the counts stay consistent with the badge.
 *
 * Void invoices are historical and excluded from every bucket.
 */
export const getInvoiceMetrics = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    // Current month in org timezone, e.g. "2026-04"
    const currentYearMonth = todayStr.slice(0, 7);

    type Bucket = { count: number; currencySums: Record<string, number> };
    const empty = (): Bucket => ({ count: 0, currencySums: {} });
    const draft = empty();
    const unpaid = empty();
    const pastDue = empty();
    const paidThisMonth = empty();

    function accumulate(bucket: Bucket, inv: Doc<"invoices">) {
      bucket.count += 1;
      bucket.currencySums[inv.currency] =
        round2((bucket.currencySums[inv.currency] ?? 0) + inv.total);
    }

    for (const inv of invoices) {
      if (inv.status === "void") continue;

      if (inv.status === "draft") {
        accumulate(draft, inv);
      } else if (inv.status === "invoiced") {
        // Undefined dueDate has no overdue clock — stays in Unpaid.
        if (inv.dueDate == null || inv.dueDate >= todayStr) {
          accumulate(unpaid, inv);
        } else {
          accumulate(pastDue, inv);
        }
      } else if (inv.status === "paid") {
        if (inv.paidAt != null) {
          // Compare paid date in the org's timezone, not UTC, so early-morning
          // payments on the 1st of the month aren't dropped for +UTC orgs.
          const paidYearMonth = getDateInTimezone(inv.paidAt, timezone).slice(0, 7);
          if (paidYearMonth === currentYearMonth) {
            accumulate(paidThisMonth, inv);
          }
        }
      }
    }

    return { draft, unpaid, pastDue, paidThisMonth };
  },
});

/**
 * Inbox empty-state context — feeds the "All caught up" reward state.
 *
 * Returns the most recent finalized invoice (excluding drafts and voids) so
 * the screen can render "Last invoiced … · INV-… · {clientName}", plus the
 * day count to the next month-close (1-31). Both numbers are scoped to the
 * org timezone — same DST-safe rule that drives `formatLastInvoiced` so the
 * relative "X days ago" reads consistently across the app.
 *
 * Admin-only because the empty state lives on the admin Inbox page (members
 * never see this surface).
 */
export const getInboxEmptyStateContext = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    let last: Doc<"invoices"> | null = null;
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "void") continue;
      if (inv.number == null) continue; // finalized invoices are numbered; belt-and-suspenders
      if (last === null || inv.issueDate > last.issueDate) last = inv;
    }

    let lastInvoice: {
      id: Id<"invoices">;
      prefix: string;
      number: number;
      issueDate: string;
      issueDateTimestamp: number;
      clientName: string;
    } | null = null;
    if (last !== null && last.number != null) {
      const client = await ctx.db.get(last.clientId);
      const clientName =
        client && client.orgId === orgId ? client.name : "Unknown";
      lastInvoice = {
        id: last._id,
        prefix: last.prefix,
        number: last.number,
        issueDate: last.issueDate,
        issueDateTimestamp: Date.parse(last.issueDate + "T00:00:00Z"),
        clientName,
      };
    }

    // Days until the next month-close in org timezone. End-of-month is the
    // last calendar day of `todayStr`'s month — same loop math `getRetainerData`
    // uses, kept here to avoid a cross-file dep for one date calculation.
    const [yStr, mStr] = todayStr.split("-");
    const year = Number(yStr);
    const month = Number(mStr); // 1-12
    const lastDay = new Date(year, month, 0).getDate();
    const todayDay = Number(todayStr.slice(8, 10));
    const daysToNextMonthClose = Math.max(0, lastDay - todayDay);

    return { lastInvoice, daysToNextMonthClose };
  },
});

/**
 * Walk every billable project in the org and emit its ready-to-invoice rows.
 *
 * Single source of truth for both `getReadyToInvoiceUnified` (returns the
 * rows themselves) and `getInvoicingNavSignals` (returns just the length).
 * Pulling the iteration into one helper is what keeps the sidebar count and
 * the Inbox feed from drifting — adding a new row condition or a new project
 * filter only happens in one place.
 *
 * Row decision logic still lives in `convex/lib/readyToInvoice.ts` (pure,
 * unit-tested); this shim is responsible for fetching docs, computing
 * per-month retainer balances, and feeding the helpers.
 *
 * Output: rows already labelled `kind` ("retainer-monthly" | "retainer-cycle"
 * | "fixed" | "tm"), sorted oldest-first by period (Fixed/no-period rows
 * trail by client+project name). Multi-currency rows are NOT aggregated —
 * each row carries its own currency.
 */
async function enumerateReadyRows(
  ctx: QueryCtx,
  orgId: string,
  todayStr: string,
): Promise<ReadyRow[]> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  // Cache clients once — many projects may share one.
  const clientCache = new Map<string, Doc<"clients"> | null>();
  async function getClient(clientId: Id<"clients">) {
    const key = clientId.toString();
    if (clientCache.has(key)) return clientCache.get(key) ?? null;
    const c = await ctx.db.get(clientId);
    const safe = c && c.orgId === orgId ? c : null;
    clientCache.set(key, safe);
    return safe;
  }

  const allRows: ReadyRow[] = [];

  for (const project of projects) {
    // Skip non-billable, archived, or orphaned projects. The orphan guard
    // (deleted client) keeps the query crash-free per the test spec.
    if (project.billingType === "non_billable") continue;
    if (project.archivedAt) continue;
    const client = await getClient(project.clientId);
    if (!client) continue;

    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    // Map Convex doc shape → helper input shape (drops fields we don't need
    // for row decisions, lets the helper stay free of `Doc<>` coupling).
    const invoiceInputs = projectInvoices.map((inv) => ({
      _id: inv._id,
      status: inv.status,
      total: inv.total,
      issueDate: inv.issueDate,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
    }));

    const projectInput = {
      _id: project._id,
      name: project.name,
      billingType: project.billingType,
      archivedAt: project.archivedAt,
      clientId: project.clientId,
      startDate: project.startDate,
      fixedPrice: project.fixedPrice,
      monthlyFee: project.monthlyFee,
      includedMinutesPerMonth: project.includedMinutesPerMonth,
      overageRate: project.overageRate,
      rolloverEnabled: project.rolloverEnabled,
      cycleLength: project.cycleLength,
    };
    const clientInput = {
      _id: client._id,
      name: client.name,
      currency: client.currency,
    };

    if (project.billingType === "fixed") {
      // Sum lineType:"fixed" amounts on finalized (non-draft, non-void)
      // invoices. Same logic as `getProjectInvoiceMetrics` Fixed branch.
      let fixedBilledFinalized = 0;
      for (const inv of projectInvoices) {
        if (inv.status === "draft" || inv.status === "void") continue;
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of items) {
          if (item.lineType === "fixed") fixedBilledFinalized += item.amount;
        }
      }
      const row = buildFixedReadyRow({
        project: projectInput,
        client: clientInput,
        invoices: invoiceInputs,
        fixedBilledFinalized: round2(fixedBilledFinalized),
      });
      if (row) allRows.push(row);
      continue;
    }

    if (project.billingType === "t_and_m") {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", orgId).eq("projectId", project._id),
        )
        .collect();
      const entries = (
        await Promise.all(
          tasks.map((t) =>
            ctx.db
              .query("timeEntries")
              .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
              .filter((q) => q.eq(q.field("orgId"), orgId))
              .collect(),
          ),
        )
      ).flat();
      const entryInputs = entries.map((e) => ({
        _id: e._id,
        date: e.date,
        durationMinutes: e.durationMinutes,
        isBillable: e.isBillable,
        invoiceId: e.invoiceId,
        settledAt: e.settledAt ?? null,
        billableRate: e.billableRate,
      }));
      const rows = buildTmReadyRows({
        project: projectInput,
        client: clientInput,
        invoices: invoiceInputs,
        entries: entryInputs,
        todayStr,
      });
      allRows.push(...rows);
      continue;
    }

    if (project.billingType === "retainer") {
      // Compute per-month worked minutes for every closed month from project
      // start onward. Used by both rollover modes — only the chaining
      // differs, which we do here once.
      if (!project.startDate) continue;
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", orgId).eq("projectId", project._id),
        )
        .collect();
      const entries = (
        await Promise.all(
          tasks.map((t) =>
            ctx.db
              .query("timeEntries")
              .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
              .filter((q) => q.eq(q.field("orgId"), orgId))
              .collect(),
          ),
        )
      ).flat();
      const billableByMonth = new Map<string, number>(); // YYYY-MM → minutes
      for (const e of entries) {
        if (!e.isBillable) continue;
        const key = e.date.slice(0, 7);
        billableByMonth.set(key, (billableByMonth.get(key) ?? 0) + e.durationMinutes);
      }

      // Read-path defaults mirror `projects.create`: `cycleLength ?? 1` and
      // rollover only meaningful for multi-month cycles. (Previously `?? true`
      // / `?? 3` here silently treated a misconfigured retainer as a 3-month
      // rollover — inconsistent with what creation writes.)
      const { closedMonths, cycles } = enumerateRetainerCycleState({
        startDate: project.startDate,
        todayStr,
        includedMinutes: project.includedMinutesPerMonth ?? 0,
        cycleLength: project.cycleLength ?? 1,
        rolloverEnabled: project.rolloverEnabled ?? false,
        billableByMonth,
      });

      // Admin-settlement state — a month with a `closedAt`-stamped
      // `retainerPeriods` row no longer needs a "Close & report" inbox row.
      const periodRows = await ctx.db
        .query("retainerPeriods")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      const closedPeriodStarts = new Set(
        periodRows.filter((p) => p.closedAt !== undefined).map((p) => p.periodStart),
      );
      const monthStart = (y: number, m: number) =>
        `${y}-${String(m).padStart(2, "0")}-01`;

      if (project.rolloverEnabled ?? false) {
        allRows.push(
          ...buildRetainerCycleReadyRows({
            project: projectInput,
            client: clientInput,
            invoices: invoiceInputs,
            cycles: cycles.map((c) => ({
              ...c,
              // Cycle close stamps every month in the cycle, so the closing
              // month's period row is a sufficient "cycle settled" signal.
              isAdminClosed: closedPeriodStarts.has(
                monthStart(c.closingYear, c.closingMonth),
              ),
            })),
          }),
        );
      } else {
        allRows.push(
          ...buildRetainerMonthlyReadyRows({
            project: projectInput,
            client: clientInput,
            invoices: invoiceInputs,
            monthBalances: closedMonths.map((cm) => ({
              ...cm,
              isAdminClosed: closedPeriodStarts.has(
                monthStart(cm.year, cm.month),
              ),
            })),
          }),
        );
      }
    }
  }

  // Keep every row with a pending action: money-bearing Generate rows,
  // config-issue rows (over budget but no overage rate — must not vanish),
  // and within-budget Close rows. See `shouldAppearInInbox`.
  return sortReadyRows(allRows.filter(shouldAppearInInbox));
}

/**
 * Unified Inbox feed — one row per pending billing unit across all 4 project
 * types in the org. Admin-only.
 *
 * Iteration body is shared with `getInvoicingNavSignals` via
 * `enumerateReadyRows`. See that helper for the row decision logic.
 */
export const getReadyToInvoiceUnified = query({
  args: {},
  handler: async (ctx): Promise<ReadyRow[]> => {
    const { orgId } = await requireAdmin(ctx);
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    return enumerateReadyRows(ctx, orgId, todayStr);
  },
});

/**
 * Sidebar nav signals — feeds the `Invoices` row badge + calendar-clock icon.
 * Admin-only (the row itself is hidden for members).
 *
 * Two signals:
 *   - `toGenerateCount` — number of pending billing units across all project
 *     types. Composed from the same logic as `getReadyToInvoiceUnified` so
 *     the badge can never disagree with the Inbox.
 *   - `overdueCount` — number of `invoiced` rows whose `dueDate < today` in
 *     the org timezone. Same rule the Overdue section applies, kept here
 *     so the icon state and Inbox count never diverge.
 *
 * Spec text describes `hasOverdue: boolean`, but the user-facing tooltip
 * needs the count (`"3 ready to bill · 2 overdue"`). Returning the count
 * lets the UI derive `hasOverdue = overdueCount > 0` while still satisfying
 * the tooltip copy. One round-trip, both signals.
 */
export const getInvoicingNavSignals = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // Count overdue invoices via the org-status index — narrows the scan to
    // `invoiced` only, then filters dueDate. No need to inspect drafts/paid/void.
    const invoicedRows = await ctx.db
      .query("invoices")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "invoiced"),
      )
      .collect();
    let overdueCount = 0;
    for (const inv of invoicedRows) {
      if (inv.dueDate != null && inv.dueDate < todayStr) overdueCount += 1;
    }

    // Reuse the same iteration as `getReadyToInvoiceUnified` so the badge
    // count can never disagree with the Inbox feed. Convex caches identical
    // query bodies; both queries materialize from the same in-memory pass
    // when both are subscribed (the typical "open /invoices" flow).
    const rows = await enumerateReadyRows(ctx, orgId, todayStr);
    const toCloseCount = rows.filter((r) => isCloseRow(r.kind)).length;

    return {
      toGenerateCount: rows.length - toCloseCount,
      // Within-budget "Close & report" actions — part of the badge total so
      // the sidebar surfaces every month-end task, not just the invoiced ones.
      toCloseCount,
      overdueCount,
    };
  },
});

/**
 * Get invoice metrics for a project — feeds the project's Invoices tab.
 *
 * Three payment-health buckets (all single-currency — project has exactly one
 * currency via the D1 invariant):
 *
 *   unpaid       = status "invoiced" AND (no dueDate OR dueDate >= today)
 *   pastDue      = status "invoiced" AND dueDate <  today
 *   paidLifetime = status "paid" — sum shown as a muted summary line
 *
 * Plus billing-type-specific context:
 *   Fixed    → fixedBilled / fixedRemaining / fixedPercentInvoiced
 *   Retainer → uninvoicedMonths (full {year, month, label} objects so the
 *              callout bar can hand the next billable period to
 *              `useGenerateInvoice` and route directly to its draft)
 *
 * Void invoices are excluded everywhere.
 * "Today" resolved in org timezone so the past-due line matches the badge.
 */
export const getProjectInvoiceMetrics = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    // Void invoices are historical — excluded from totals and counts so the
    // metric cards reflect the live picture.
    const orgInvoices = invoices.filter((inv) => inv.status !== "void");

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    type Bucket = { count: number; amount: number };
    const empty = (): Bucket => ({ count: 0, amount: 0 });
    const unpaid = empty();
    const pastDue = empty();
    const paidLifetime = empty();

    let totalInvoiced = 0;
    // Track the most recent finalized issue date for the "Last invoiced" subline.
    // Drafts don't count — they aren't sent yet. Voids are already excluded.
    let lastInvoicedYMD: string | null = null;
    for (const inv of orgInvoices) {
      totalInvoiced += inv.total;

      if (inv.status === "invoiced") {
        const overdue = inv.dueDate != null && inv.dueDate < todayStr;
        const bucket = overdue ? pastDue : unpaid;
        bucket.count += 1;
        bucket.amount = round2(bucket.amount + inv.total);
      } else if (inv.status === "paid") {
        paidLifetime.count += 1;
        paidLifetime.amount = round2(paidLifetime.amount + inv.total);
      }
      if (inv.status !== "draft" && (lastInvoicedYMD === null || inv.issueDate > lastInvoicedYMD)) {
        lastInvoicedYMD = inv.issueDate;
      }
    }

    // Fixed Fee: compute billed amount from lineType:"fixed" items only
    // (excludes manual rows so remaining balance stays accurate).
    // Only finalized invoices count — drafts are provisional.
    let fixedBilled = 0;
    if (project.billingType === "fixed") {
      for (const inv of orgInvoices) {
        // Drafts are provisional; voids are historical. Neither counts as billed.
        if (inv.status === "draft" || inv.status === "void") continue;
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of items) {
          if (item.lineType === "fixed") fixedBilled += item.amount;
        }
      }
      fixedBilled = round2(fixedBilled);
    }

    const fixedPrice = project.fixedPrice ?? 0;

    // Retainer: compute uninvoiced closed months
    type UninvoicedMonth = { year: number; month: number; label: string };
    let uninvoicedMonths: UninvoicedMonth[] = [];
    let uninvoicedOverageTotal = 0;
    if (project.billingType === "retainer") {
      const closedUninvoiced = await getClosedUninvoicedMonths(
        ctx,
        orgId,
        args.projectId,
        project,
        timezone,
      );
      uninvoicedMonths = closedUninvoiced.map((m) => ({
        year: m.year,
        month: m.month,
        label: m.label,
      }));
      // Project-level overage total — the InvoiceBanner displays this so the
      // amount stays stable across cycle navigation. Reading the
      // currently-viewed cycle's overage instead (the pre-fix behavior)
      // produced lying "$0.00 within budget" labels whenever the user was
      // on a within-budget month while an over-budget month elsewhere
      // remained unbilled. See `lib/invoice-banner-view.ts:retainer-monthly`.
      uninvoicedOverageTotal = round2(
        closedUninvoiced.reduce((sum, m) => sum + m.overageAmount, 0),
      );
    }

    const currency = await getProjectCurrency(ctx, project);

    return {
      totalInvoiced,
      invoiceCount: orgInvoices.length,
      currency,
      // Payment-health buckets (single-currency per D1 invariant)
      unpaid,
      pastDue,
      paidLifetime,
      // Fixed Fee specific
      fixedPrice,
      fixedBilled,
      fixedRemaining: round2(fixedPrice - fixedBilled),
      fixedPercentInvoiced: fixedPrice > 0
        ? Math.round((fixedBilled / fixedPrice) * 100)
        : 0,
      // Retainer specific — full {year, month, label} so the callout bar
      // can hand the next billable period to `useGenerateInvoice` and
      // route directly to its draft.
      uninvoicedMonths,
      // Project-level overage total across `uninvoicedMonths` (rounded once,
      // currency = project currency by D1 invariant). The InvoiceBanner reads
      // this so the amount it shows matches the action it would take.
      uninvoicedOverageTotal,
      // Latest finalized issueDate as a UTC-midnight ms timestamp (or null).
      // Consumed by the InvoiceBanner subline via `formatLastInvoiced(..., { timezone })`.
      lastInvoicedAt: lastInvoicedYMD ? Date.parse(lastInvoicedYMD + "T00:00:00Z") : null,
    };
  },
});

/**
 * Live preview for invoice creation modal.
 * Returns computed totals reacting to date range and rounding changes.
 * Supports T&M (hours × rate) and Fixed (remaining balance).
 */
export const getInvoicePreview = query({
  args: {
    projectId: v.id("projects"),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    roundingMinutes: v.number(),
    // Selection mode (T&M only): preview aggregates totals over an explicit
    // id list instead of a date range. Mutually exclusive with startDate/endDate.
    timeEntryIds: v.optional(v.array(v.id("timeEntries"))),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;

    // Contract-mirror guard: `createInvoice` only accepts `timeEntryIds` for
    // T&M projects — preview must match so callers can't preview a state
    // that would fail to materialize.
    if (args.timeEntryIds !== undefined && project.billingType !== "t_and_m") {
      throw new ConvexError(
        "Selecting specific time entries is only supported for Time & Materials projects.",
      );
    }

    // Get all tasks for this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    // Fetch all billable entries that are NOT yet locked. Phase 8 — both
    // `invoiceId` (legacy) and `settledAt` (period-close) lock an entry;
    // either makes it ineligible for inclusion on a new invoice (a
    // retainer-included entry must not be re-billed as overage).
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries
            .filter(
              (e) =>
                e.isBillable &&
                e.invoiceId === undefined &&
                e.settledAt === undefined,
            )
            .map((e) => ({
              ...e,
              taskTitle: task.title,
              workCategoryId: e.snapshotCategoryId,
            }));
        }),
      )
    ).flat();

    // Build filtered set — either from explicit ids or date range.
    let filtered: typeof allEntries;
    if (args.timeEntryIds !== undefined) {
      const wanted = new Set(args.timeEntryIds.map((id) => id.toString()));
      filtered = allEntries.filter((e) => wanted.has(e._id.toString()));
    } else {
      filtered = allEntries.filter((e) => {
        if (args.startDate && e.date < args.startDate) return false;
        if (args.endDate && e.date > args.endDate) return false;
        return true;
      });
    }

    // Group entries — same grouping logic as createInvoice
    // T&M: by (workCategoryId, taskId, billableRate). Fixed: by (workCategoryId, taskId) only.
    const groups = new Map<string, { minutes: number; rate: number }>();
    for (const e of filtered) {
      const key = project.billingType === "fixed"
        ? `${e.workCategoryId ?? "none"}::${e.taskId}`
        : `${e.workCategoryId ?? "none"}::${e.taskId}::${e.billableRate}`;
      const existing = groups.get(key);
      if (existing) {
        existing.minutes += e.durationMinutes;
      } else {
        groups.set(key, { minutes: e.durationMinutes, rate: e.billableRate });
      }
    }

    // Apply per-task-total rounding and compute totals
    let totalMinutes = 0;
    let totalAmount = 0;
    for (const group of groups.values()) {
      const rounded = roundMinutesUp(group.minutes, args.roundingMinutes);
      totalMinutes += rounded;
      if (project.billingType === "t_and_m") {
        totalAmount += round2((rounded / 60) * group.rate);
      }
    }

    // Fixed Fee: billing amount = fixedPrice - alreadyInvoiced
    // Only finalized invoices count against the remaining balance.
    // Drafts are provisional; if we counted them, deleting a draft would leave
    // its sibling's snapshot plus a freshly-pre-filled remaining on the next
    // invoice, over-billing the project.
    let billingAmount: number | undefined;
    if (project.billingType === "fixed") {
      const fixedPrice = project.fixedPrice ?? 0;
      const existingInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();

      let alreadyInvoiced = 0;
      for (const inv of existingInvoices) {
        if (inv.status === "draft" || inv.status === "void") continue;
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of items) {
          if (item.lineType === "fixed") alreadyInvoiced += item.amount;
        }
      }
      billingAmount = round2(fixedPrice - alreadyInvoiced);
    }

    const currency = await getProjectCurrency(ctx, project);

    return {
      totalMinutes,
      totalAmount: round2(totalAmount),
      billingAmount,
      entryCount: filtered.length,
      currency,
      billingType: project.billingType,
    };
  },
});

// ─── Shared Retainer Math ─────────────────────────────────────────────────────
//
// `computeRetainerBalance`, `getRetainerCyclePosition`, and
// `getRetainerCycleStartMonth` live in `convex/lib/retainerBalance.ts` so they
// can be imported by unit tests without convex-test scaffolding. Imports above.

// Collapse a YYYY-MM-DD start date to its month boundary (YYYY-MM-01) so
// validation guards compare at month granularity. The rest of the retainer
// system (cycle position, sequential finalization) already ignores day-of-month.
function projectStartMonth(startDate: string | undefined): string | undefined {
  return startDate ? `${startDate.slice(0, 7)}-01` : undefined;
}

/**
 * Start-balance for a retainer invoice. Always 0 after the invoicing refactor.
 *
 *   - Rollover OFF  → each month independent.
 *   - Rollover ON   → cycle invoices cover the **entire** cycle in one row, so
 *     the cycle's effective start balance is 0 too. The previous per-month
 *     `retainerEndBalanceMinutes` chain (and its `cascadeRetainerChain`
 *     re-snapshot) was deleted with the refactor; mid-cycle months never
 *     produce an invoice anymore.
 *
 * Kept as a function (not inlined) so call sites stay legible and any future
 * change to the rule lands in one place.
 */
function getRetainerStartBalance(): number {
  return 0;
}

// ─── Retainer Helpers ─────────────────────────────────────────────────────────

/**
 * Recalculate retainer balance fields on a draft retainer invoice
 * when time line items are edited or removed.
 *
 * Updates: retainerUsedMinutes, retainerEndBalanceMinutes, overage line item, subtotal/total.
 * Frozen fields: retainerStartBalanceMinutes, retainerIncludedMinutes, retainerMonthlyFee, retainerOverageRate.
 */
async function recalcRetainerBalance(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  invoice: Doc<"invoices">,
  project: Doc<"projects">,
  excludeLineItemId?: Id<"invoiceLineItems">,
) {
  const items: Doc<"invoiceLineItems">[] = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q: any) => q.eq("invoiceId", invoiceId))
    .collect();

  // Build task minutes map from time line items. `quantityMinutes` is the
  // source of truth (stamped at creation from summed entry minutes, kept in
  // sync on manual hours edits). Fall back to `quantity × 60` for legacy rows
  // created before the field existed. Items are already rounded at creation,
  // so we pass roundingMinutes=0 to computeRetainerBalance.
  const taskMinutesMap = new Map<string, number>();
  for (const item of items) {
    if (item._id === excludeLineItemId) continue;
    if (item.lineType === "time") {
      const key = `${item.workCategoryId ?? "none"}::recalc-${item._id}`;
      const minutes = item.quantityMinutes ?? Math.round(item.quantity * 60);
      taskMinutesMap.set(key, minutes);
    }
  }

  // Read retainer config from the invoice snapshot so draft balances stay
  // stable if the admin toggles `rolloverEnabled` or changes `cycleLength`
  // mid-cycle. Legacy drafts without snapshots fall back to live project.
  const cycleLength =
    invoice.retainerCycleLength ?? project.cycleLength ?? 3;
  const rolloverEnabled =
    invoice.retainerRolloverEnabled ?? project.rolloverEnabled ?? true;

  const positionInCycle = getRetainerRecalcCyclePosition({
    rolloverEnabled,
    cycleLength,
  });

  const result = computeRetainerBalance({
    taskMinutesMap,
    roundingMinutes: 0, // Items are already rounded from creation
    startBalance: invoice.retainerStartBalanceMinutes ?? 0,
    includedMinutes: invoice.retainerIncludedMinutes ?? 0,
    monthlyFee: invoice.retainerMonthlyFee ?? 0,
    overageRate: invoice.retainerOverageRate ?? 0,
    rolloverEnabled,
    cycleLength,
    positionInCycle,
  });

  // Find existing overage line item
  const existingOverage = items.find(
    (li) => li.lineType === "overage" && li._id !== excludeLineItemId,
  );

  const now = Date.now();
  const overageRate = invoice.retainerOverageRate ?? 0;

  if (result.isOverageDue) {
    if (existingOverage) {
      await ctx.db.patch(existingOverage._id, {
        description: `Overage (${result.overageHours}h × ${overageRate}/h)`,
        quantity: result.overageHours,
        unitPrice: overageRate,
        amount: result.overageAmount,
        updatedAt: now,
      });
    } else {
      const maxSort = items.reduce((max: number, li: Doc<"invoiceLineItems">) => Math.max(max, li.sortOrder), -1);
      await ctx.db.insert("invoiceLineItems", {
        orgId: invoice.orgId,
        invoiceId,
        sortOrder: maxSort + 1,
        lineType: "overage" as const,
        description: `Overage (${result.overageHours}h × ${overageRate}/h)`,
        quantity: result.overageHours,
        unitPrice: overageRate,
        amount: result.overageAmount,
        createdAt: now,
        updatedAt: now,
      });
    }
  } else if (existingOverage) {
    await ctx.db.delete(existingOverage._id);
  }

  // Recalculate subtotal/total from all billing items
  const updatedItems: Doc<"invoiceLineItems">[] = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q: any) => q.eq("invoiceId", invoiceId))
    .collect();
  let subtotal = 0;
  for (const item of updatedItems) {
    if (item._id === excludeLineItemId) continue;
    if (item.lineType !== "time") subtotal += item.amount;
  }
  subtotal = round2(subtotal);

  await ctx.db.patch(invoiceId, {
    retainerUsedMinutes: result.usedMinutes,
    retainerEndBalanceMinutes: result.endBalance,
    subtotal,
    total: subtotal,
    updatedAt: now,
  });
}

/**
 * Enumerate all closed months from project start to today that don't have an invoice.
 * Used by both the retainer preview query and the metrics query.
 */
/**
 * Closed retainer periods that still need an invoice. Same model the Ready
 * feed uses (`buildRetainerMonthlyReadyRows` / `buildRetainerCycleReadyRows`):
 *
 *   - Rollover OFF → one entry per closed over-budget month.
 *   - Rollover ON  → one entry per closed cycle whose `cycleBalance < 0`,
 *                     anchored to the cycle's closing month (the row
 *                     `createInvoice` keys on).
 *
 * Dedup is keyed on `getInvoiceAnchorMonthKey` so a cycle invoice (which
 * spans multiple months) correctly hides every month it covers — same
 * convention the Ready feed and Monthly Breakdown card use.
 */
async function getClosedUninvoicedMonths(
  ctx: QueryCtx,
  orgId: string,
  projectId: Id<"projects">,
  project: Doc<"projects">,
  timezone: string,
) {
  const startDate = project.startDate;
  if (!startDate) return [];

  const overageRate = project.overageRate ?? 0;
  if (overageRate === 0) return [];

  const todayStr = getDateInTimezone(Date.now(), timezone);

  // Walk the project once: gather billable minutes per YYYY-MM, then run the
  // same cycle-state enumerator the Ready feed uses.
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", orgId).eq("projectId", projectId),
    )
    .collect();
  const entries = (
    await Promise.all(
      tasks.map((t) =>
        ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
          .filter((q) => q.eq(q.field("orgId"), orgId))
          .collect(),
      ),
    )
  ).flat();
  const billableByMonth = new Map<string, number>();
  for (const e of entries) {
    if (!e.isBillable) continue;
    const key = e.date.slice(0, 7);
    billableByMonth.set(key, (billableByMonth.get(key) ?? 0) + e.durationMinutes);
  }

  // Defaults mirror `projects.create` (cycleLength 1 → monthly, no rollover).
  const rolloverEnabled = project.rolloverEnabled ?? false;
  const cycleLength = project.cycleLength ?? 1;
  const { closedMonths, cycles } = enumerateRetainerCycleState({
    startDate,
    todayStr,
    includedMinutes: project.includedMinutesPerMonth ?? 0,
    cycleLength,
    rolloverEnabled,
    billableByMonth,
  });

  // Anchor-keyed dedup: rollover cycle invoices span multiple months but
  // anchor on `periodEnd`'s YYYY-MM (the cycle-end). Mirrors the Ready feed.
  const projectInvoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();
  const invoicedKeys = new Set<string>();
  for (const inv of projectInvoices) {
    if (inv.status === "void") continue;
    const key = getInvoiceAnchorMonthKey(inv);
    if (key) invoicedKeys.add(key);
  }

  // Build invoiceable periods, anchored to the row `createInvoice` keys on.
  // Rollover ON: one entry per closed over-budget cycle (cycle-end row).
  // Rollover OFF: one entry per closed over-budget month.
  //
  // Each period carries `overageAmount` (= |balance|/60 × overageRate). This
  // is critical for the InvoiceBanner: the banner displays a project-level
  // "ready to bill" total, which must NOT vary with the currently-viewed
  // cycle. Before this field existed, the banner pulled `overageDue` from
  // `getRetainerData` (cycle-view-scoped) and produced lying "$0.00 within
  // budget" labels whenever the user navigated to a within-budget cycle.
  type Period = { year: number; month: number; overageAmount: number };
  const invoiceablePeriods: Period[] = rolloverEnabled
    ? cycles
        .filter((c) => c.isCycleClosed && c.cycleBalance < 0)
        .map((c) => ({
          year: c.closingYear,
          month: c.closingMonth,
          overageAmount: round2((Math.abs(c.cycleBalance) / 60) * overageRate),
        }))
    : closedMonths
        .filter((cm) => cm.endBalance < 0)
        .map((cm) => ({
          year: cm.year,
          month: cm.month,
          overageAmount: round2((Math.abs(cm.endBalance) / 60) * overageRate),
        }));

  return invoiceablePeriods
    .filter((p) => !invoicedKeys.has(`${p.year}-${String(p.month).padStart(2, "0")}`))
    .map((p) => ({
      year: p.year,
      month: p.month,
      label: monthLabel(`${p.year}-${String(p.month).padStart(2, "0")}-01`),
      startDate: `${p.year}-${String(p.month).padStart(2, "0")}-01`,
      endDate: `${p.year}-${String(p.month).padStart(2, "0")}-${String(new Date(p.year, p.month, 0).getDate()).padStart(2, "0")}`,
      overageAmount: p.overageAmount,
    }));
}

/**
 * Get closed uninvoiced months for a retainer project.
 */
export const getRetainerUninvoicedMonths = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId || project.billingType !== "retainer") return [];
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    return getClosedUninvoicedMonths(ctx, orgId, args.projectId, project, timezone);
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create an invoice from a date range.
 * Supports T&M and Fixed billing types.
 *
 * T&M: line items = hours × rate per task (billable)
 * Fixed: one lineType:"fixed" item (remaining balance) + lineType:"time" items (hours only, no billing)
 */
export const createInvoice = mutation({
  args: {
    projectId: v.id("projects"),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    roundingMinutes: v.number(),
    // Retainer-specific: month to invoice
    retainerYear: v.optional(v.number()),
    retainerMonth: v.optional(v.number()), // 1-12
    // Path B (T&M only): invoice from explicitly selected time entries.
    // When provided, startDate/endDate/retainer args are ignored.
    timeEntryIds: v.optional(v.array(v.id("timeEntries"))),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) {
      throw new ConvexError("Project not found.");
    }

    const billingType = project.billingType;
    if (billingType !== "t_and_m" && billingType !== "fixed" && billingType !== "retainer") {
      throw new ConvexError("This project type does not support invoicing.");
    }

    // Path B guard: explicit timeEntryIds only supported for T&M.
    if (args.timeEntryIds !== undefined && billingType !== "t_and_m") {
      throw new ConvexError(
        "Selecting specific time entries is only supported for Time & Materials projects.",
      );
    }

    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) {
      throw new ConvexError("Client not found for project.");
    }

    // Pre-fetch invoices on this project once. Used by:
    //   (a) the resume-existing-draft check (all billing types)
    //   (b) the retainer sequential-month / start-month guards (later)
    //   (c) the Fixed `alreadyInvoiced` accumulator (later)
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    // Resume-existing-draft: Fixed has no period; T&M Path A keys on the
    // requested date range. Both must run BEFORE the "no uninvoiced entries"
    // guard for T&M, because already-stamped entries on the existing draft
    // would otherwise short-circuit the call with a misleading error.
    // Retainer is checked after its month boundaries are derived.
    // Path B (timeEntryIds) can't collide with a draft because already-invoiced
    // entries are rejected during entry resolution.
    if (billingType === "fixed") {
      const resume = findResumableInvoice(projectInvoices, {
        orgId,
        billingType: "fixed",
      });
      if (resume.kind === "resume-draft") {
        return {
          invoiceId: resume.invoice._id,
          resumed: true,
          prefix: resume.invoice.prefix,
          number: resume.invoice.number ?? null,
        };
      }
    } else if (billingType === "t_and_m" && args.timeEntryIds === undefined) {
      const resume = findResumableInvoice(projectInvoices, {
        orgId,
        billingType: "t_and_m",
        requestedPeriodStart: args.startDate,
        requestedPeriodEnd: args.endDate,
      });
      if (resume.kind === "resume-draft") {
        return {
          invoiceId: resume.invoice._id,
          resumed: true,
          prefix: resume.invoice.prefix,
          number: resume.invoice.number ?? null,
        };
      }
    }

    // 1. Get all tasks for this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    const taskMap = new Map<string, Doc<"tasks">>();
    for (const t of tasks) taskMap.set(t._id, t);

    // 2. Fetch all billable, uninvoiced entries
    // Tenancy: `by_taskId` doesn't narrow by orgId; filter explicitly (CLAUDE.md).
    // Phase 8 — `settledAt` joins `invoiceId` as a lock signal (same
    // reasoning as the recalc path above — a period-closed entry must not
    // get pulled onto a fresh draft).
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries
            .filter(
              (e) =>
                e.isBillable &&
                e.invoiceId === undefined &&
                e.settledAt === undefined,
            )
            .map((e) => ({
              ...e,
              workCategoryId: e.snapshotCategoryId,
            }));
        }),
      )
    ).flat();

    // 3. Apply date range filter
    // Retainer: derive period from `retainerYear` / `retainerMonth`. After the
    // invoicing refactor (`docs/invoicing-refactor.md`):
    //   - Rollover OFF → period = the requested month's boundaries.
    //   - Rollover ON  → period = the **entire cycle range** ending in the
    //     requested month. Caller MUST pass the cycle-end month; mid-cycle
    //     months are rejected.
    let effectiveStart = args.startDate;
    let effectiveEnd = args.endDate;
    if (billingType === "retainer") {
      if (!args.retainerYear || !args.retainerMonth) {
        throw new ConvexError("Retainer invoices require a month selection.");
      }
      const y = args.retainerYear;
      const m = args.retainerMonth;
      const rolloverEnabled = project.rolloverEnabled ?? true;
      const cycleLength = project.cycleLength ?? 3;

      if (rolloverEnabled) {
        // Cycle invoice — must be cycle-end. Positions 0…cycleLength-1; only
        // the closing position produces an invoice.
        const position = getRetainerCyclePosition(project.startDate, y, m, cycleLength);
        assertRolloverCycleEnd({
          rolloverEnabled,
          cyclePosition: position,
          cycleLength,
        });
        const cycleStart = getRetainerCycleStartMonth(project.startDate, y, m, cycleLength);
        if (!cycleStart) {
          throw new ConvexError("Retainer project is missing a start date.");
        }
        effectiveStart = `${cycleStart.year}-${String(cycleStart.month).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        effectiveEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      } else {
        effectiveStart = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        effectiveEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      }

      // Resume-or-block: one live invoice per period (month for rollover-OFF,
      // cycle range for rollover-ON).
      //  - Existing draft → return its id (caller resumes editing).
      //  - Existing invoiced/paid → throw (re-invoicing requires void first).
      //  - Voided → historical only, the period is re-invoiceable.
      const resumeRetainer = findResumableInvoice(projectInvoices, {
        orgId,
        billingType: "retainer",
        requestedPeriodStart: effectiveStart,
        requestedPeriodEnd: effectiveEnd,
      });
      if (resumeRetainer.kind === "resume-draft") {
        return {
          invoiceId: resumeRetainer.invoice._id,
          resumed: true,
          prefix: resumeRetainer.invoice.prefix,
          number: resumeRetainer.invoice.number ?? null,
        };
      }
      if (resumeRetainer.kind === "blocked-duplicate") {
        const label = monthLabel(effectiveStart);
        throw new ConvexError(`An invoice for ${label} already exists.`);
      }

      // Validate window: effectiveStart must not precede project start month;
      // effectiveEnd (cycle-end or month-end) must be in the past.
      const orgSettingsForValidation = await getOrgSettings(ctx, orgId);
      const validationTimezone = orgSettingsForValidation?.timezone ?? ORG_TIMEZONE_FALLBACK;
      const todayStr = getDateInTimezone(Date.now(), validationTimezone);

      const projectStart = projectStartMonth(project.startDate);
      if (projectStart && effectiveStart < projectStart) {
        throw new ConvexError("Cannot create an invoice for a month before the retainer start date.");
      }

      if (effectiveEnd >= todayStr) {
        throw new ConvexError(
          rolloverEnabled
            ? "Cannot create a cycle invoice before the cycle's closing month has ended."
            : "Cannot create an invoice for a month that hasn't ended yet.",
        );
      }
    }

    // Build `filtered` set — either from explicit IDs (Path B) or date range.
    let filtered: typeof allEntries;
    if (args.timeEntryIds !== undefined) {
      if (args.timeEntryIds.length === 0) {
        throw new ConvexError("No entries selected.");
      }
      // Dedupe defensively: a duplicate ID would double-count minutes/amount.
      const dedupedIds = [...new Set(args.timeEntryIds.map((id) => id.toString()))];
      const entryMap = new Map(allEntries.map((e) => [e._id.toString(), e]));
      filtered = [];
      for (const idStr of dedupedIds) {
        const entry = entryMap.get(idStr);
        if (!entry) {
          // Either not on this project, not billable, already invoiced, or cross-tenant.
          // Load directly to produce a precise error.
          const stray = await ctx.db.get(idStr as Id<"timeEntries">);
          if (!stray || stray.orgId !== orgId) {
            throw new ConvexError("One or more selected entries are not available.");
          }
          if (stray.invoiceId) {
            throw new ConvexError("One or more selected entries are already invoiced.");
          }
          if (!stray.isBillable) {
            throw new ConvexError("Only billable entries can be invoiced.");
          }
          // Not on this project (task belongs elsewhere)
          throw new ConvexError("Selected entries must belong to this project.");
        }
        filtered.push(entry);
      }
      // Derive period from selected entries' min/max dates.
      effectiveStart = filtered.reduce((min, e) => (e.date < min ? e.date : min), filtered[0].date);
      effectiveEnd = filtered.reduce((max, e) => (e.date > max ? e.date : max), filtered[0].date);
    } else {
      filtered = allEntries.filter((e) => {
        if (effectiveStart && e.date < effectiveStart) return false;
        if (effectiveEnd && e.date > effectiveEnd) return false;
        return true;
      });
    }

    // T&M requires entries; Fixed/Retainer allow zero entries
    if (billingType === "t_and_m" && filtered.length === 0) {
      throw new ConvexError("No uninvoiced time entries found for this period.");
    }

    // 4. Group entries for time line items
    // T&M: group by (workCategoryId, taskId, billableRate) — separate rows per rate
    // Fixed: group by (workCategoryId, taskId) only — rate is irrelevant for work report
    type LineGroup = {
      taskId: Id<"tasks">;
      workCategoryId: Id<"workCategories"> | undefined;
      rate: number;
      minutes: number;
      entryIds: Id<"timeEntries">[];
      taskTitle: string;
    };

    const groupMap = new Map<string, LineGroup>();
    for (const e of filtered) {
      const key = billingType === "t_and_m"
        ? `${e.workCategoryId ?? "none"}::${e.taskId}::${e.billableRate}`
        : `${e.workCategoryId ?? "none"}::${e.taskId}`; // Fixed + Retainer: no rate key
      const existing = groupMap.get(key);
      if (existing) {
        existing.minutes += e.durationMinutes;
        existing.entryIds.push(e._id);
      } else {
        const task = taskMap.get(e.taskId);
        groupMap.set(key, {
          taskId: e.taskId,
          workCategoryId: e.workCategoryId,
          rate: e.billableRate,
          minutes: e.durationMinutes,
          entryIds: [e._id],
          taskTitle: task?.title ?? "Unknown task",
        });
      }
    }

    // 5. Compute period
    let periodStart: string | undefined;
    let periodEnd: string | undefined;
    if (billingType === "retainer") {
      // Retainer: period = exact month boundaries
      periodStart = effectiveStart;
      periodEnd = effectiveEnd;
    } else if (filtered.length > 0) {
      // T&M/Fixed: period from min/max entry dates
      periodStart = filtered[0].date;
      periodEnd = filtered[0].date;
      for (const e of filtered) {
        if (e.date < periodStart!) periodStart = e.date;
        if (e.date > periodEnd!) periodEnd = e.date;
      }
    }

    // 6. Read org settings for prefix + payment terms. The invoice NUMBER is
    // NOT allocated here — drafts are unnumbered; the sequence number is
    // claimed at finalization (draft → invoiced, see `applyStatusTransition`)
    // so deleted/abandoned drafts never leave gaps in the issued series.
    const orgSettings = await getOrgSettings(ctx, orgId);
    const prefix = orgSettings?.invoicePrefix ?? "INV-";
    const paymentTermsDays = orgSettings?.defaultPaymentTermsDays ?? 30;

    // 7. Compute issue date and due date
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const issueDate = getDateInTimezone(Date.now(), timezone);
    const issueDateObj = new Date(issueDate + "T00:00:00Z");
    issueDateObj.setUTCDate(issueDateObj.getUTCDate() + paymentTermsDays);
    const dueDate = issueDateObj.toISOString().slice(0, 10);

    // 8. Auto-prefill subject. Keep this as the billing unit only; Client and
    // Project are separate columns on the invoice list, so repeating them here
    // makes the table slower to scan.
    const subject =
      billingType === "fixed"
        ? "Fixed fee"
        : billingType === "retainer" && periodStart && periodEnd
          ? `${periodSubjectLabel(periodStart, periodEnd)} overage`
          : periodStart
            ? monthLabel(periodStart)
            : project.name;

    // 9. Build line items
    const now = Date.now();
    let subtotal = 0;

    type LineItem = {
      lineType: "time" | "fixed" | "overage";
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      /** Source-of-truth minutes on time rows; omitted on derived rows. */
      quantityMinutes?: number;
      workCategoryId: Id<"workCategories"> | undefined;
      entryIds: Id<"timeEntries">[];
    };

    const lineItems: LineItem[] = [];

    // Time line items (work breakdown). Retainer balance is derived from the
    // stamped `quantityMinutes` field on each line item (read back by
    // `recalcRetainerBalance`); no running total needs to be tracked here.
    for (const group of groupMap.values()) {
      const roundedMinutes = roundMinutesUp(group.minutes, args.roundingMinutes);
      const hours = round2(roundedMinutes / 60);

      if (billingType === "t_and_m") {
        // T&M: hours × rate = billable amount
        const amount = round2(hours * group.rate);
        subtotal += amount;
        lineItems.push({
          lineType: "time",
          description: group.taskTitle,
          quantity: hours,
          unitPrice: group.rate,
          amount,
          quantityMinutes: roundedMinutes,
          workCategoryId: group.workCategoryId,
          entryIds: group.entryIds,
        });
      } else {
        // Fixed + Retainer: hours only — no billing on time items
        lineItems.push({
          lineType: "time",
          description: group.taskTitle,
          quantity: hours,
          unitPrice: 0,
          amount: 0,
          quantityMinutes: roundedMinutes,
          workCategoryId: group.workCategoryId,
          entryIds: group.entryIds,
        });
      }
    }

    // Retainer balance & billing line items — uses shared computeRetainerBalance
    let retainerStartBalance = 0;
    let retainerIncluded = 0;
    let retainerUsed = 0;
    let retainerEndBalance = 0;
    let retainerFee = 0;
    let retainerOverageRate = 0;

    if (billingType === "retainer") {
      const rolloverEnabled = project.rolloverEnabled ?? true;
      const cycleLength = project.cycleLength ?? 3;

      retainerFee = project.monthlyFee ?? 0;
      retainerOverageRate = project.overageRate ?? 0;
      // Cycle invoice covers the full cycle, so the included bucket scales
      // with `cycleLength`. Monthly (rollover-OFF) keeps the per-month bucket.
      const monthlyIncluded = project.includedMinutesPerMonth ?? 0;
      retainerIncluded = rolloverEnabled
        ? monthlyIncluded * cycleLength
        : monthlyIncluded;

      // Build task minutes map from grouped entries (same grouping as line items above)
      const taskMinutesMap = new Map<string, number>();
      for (const group of groupMap.values()) {
        const key = `${group.workCategoryId ?? "none"}::${group.taskId}`;
        taskMinutesMap.set(key, (taskMinutesMap.get(key) ?? 0) + group.minutes);
      }

      // Refactor: cycle invoices start at 0, monthly invoices start at 0 too —
      // the per-month chain is gone. See `getRetainerStartBalance` docstring.
      retainerStartBalance = getRetainerStartBalance();

      // For rollover ON, the closing-month position triggers `isOverageDue`.
      // For rollover OFF, position is irrelevant — overage settles per-month.
      const positionInCycle = rolloverEnabled
        ? cycleLength - 1
        : -1;

      const retainerResult = computeRetainerBalance({
        taskMinutesMap,
        roundingMinutes: args.roundingMinutes,
        startBalance: retainerStartBalance,
        includedMinutes: retainerIncluded,
        monthlyFee: retainerFee,
        overageRate: retainerOverageRate,
        rolloverEnabled,
        cycleLength,
        positionInCycle,
      });

      retainerUsed = retainerResult.usedMinutes;
      retainerEndBalance = retainerResult.endBalance;

      // Within-budget guard — D3 in `docs/invoicing-refactor.md`. The bouncer
      // is at the door of *creation*: a within-budget period produces no
      // invoice. The owner downloads the Monthly Report instead.
      assertRetainerInvoiceable({
        isOverageDue: retainerResult.isOverageDue,
      });

      // Single Overage line item — the monthly retainer fee is collected via
      // Stripe and surfaces only as disclaimer text on the doc, never as a
      // chargeable line.
      subtotal += retainerResult.overageAmount;
      lineItems.push({
        lineType: "overage",
        description: `Overage (${retainerResult.overageHours}h × ${retainerOverageRate}/h)`,
        quantity: retainerResult.overageHours,
        unitPrice: retainerOverageRate,
        amount: retainerResult.overageAmount,
        workCategoryId: undefined,
        entryIds: [],
      });
    }

    // Fixed: add the fixed fee line item
    if (billingType === "fixed") {
      const fixedPrice = project.fixedPrice ?? 0;

      // Calculate already invoiced: sum of lineType:"fixed" amounts across
      // finalized project invoices only. Drafts are provisional — counting
      // them would let a delete-then-recreate cycle over-bill the project.
      const projectInvoiceIds = projectInvoices
        .filter(
          (inv) =>
            inv.orgId === orgId &&
            inv.status !== "draft" &&
            inv.status !== "void",
        )
        .map((inv) => inv._id);

      let alreadyInvoiced = 0;
      for (const invId of projectInvoiceIds) {
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invId))
          .collect();
        for (const item of items) {
          if (item.lineType === "fixed") {
            alreadyInvoiced += item.amount;
          }
        }
      }

      const remaining = round2(fixedPrice - alreadyInvoiced);
      subtotal = remaining;
      lineItems.push({
        lineType: "fixed",
        description: project.name,
        quantity: 1,
        unitPrice: remaining,
        amount: remaining,
        workCategoryId: undefined,
        entryIds: [],
      });
    }

    subtotal = round2(subtotal);
    const total = subtotal; // no tax in v1

    // Within-budget retainer periods are rejected at the bouncer (see
    // `assertRetainerInvoiceable` in the retainer branch above) — by the time
    // we reach this point, retainer invoices always have overage > 0.

    // 10. Create the invoice
    const messageToClient = orgSettings?.invoiceMessageTemplate || undefined;
    const invoiceData: Record<string, unknown> = {
      orgId,
      projectId: args.projectId,
      clientId: project.clientId,
      prefix,
      subject,
      status: "draft",
      currency: client.currency,
      subtotal,
      total,
      issueDate,
      dueDate,
      periodStart,
      periodEnd,
      roundingMinutes: args.roundingMinutes,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };
    if (messageToClient !== undefined) invoiceData.messageToClient = messageToClient;

    // Retainer: snapshot balance, rate, AND cycle config. Recalc reads these
    // snapshots instead of live project fields so the draft's balance meaning
    // stays stable if the admin toggles rollover / changes cycleLength later.
    if (billingType === "retainer") {
      invoiceData.retainerStartBalanceMinutes = retainerStartBalance;
      invoiceData.retainerIncludedMinutes = retainerIncluded;
      invoiceData.retainerUsedMinutes = retainerUsed;
      invoiceData.retainerEndBalanceMinutes = retainerEndBalance;
      invoiceData.retainerMonthlyFee = retainerFee;
      invoiceData.retainerOverageRate = retainerOverageRate;
      invoiceData.retainerRolloverEnabled = project.rolloverEnabled ?? true;
      invoiceData.retainerCycleLength = project.cycleLength ?? 3;
    }

    const invoiceId = await ctx.db.insert("invoices", invoiceData as never);

    // 11. Create line items
    let sortOrder = 0;
    for (const item of lineItems) {
      await ctx.db.insert("invoiceLineItems", {
        orgId,
        invoiceId,
        sortOrder,
        lineType: item.lineType,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        quantityMinutes: item.quantityMinutes,
        workCategoryId: item.workCategoryId,
        timeEntryIds: item.entryIds.length > 0 ? item.entryIds : undefined,
        createdAt: now,
        updatedAt: now,
      });
      sortOrder++;
    }

    // 12. Stamp all included time entries with invoiceId
    for (const e of filtered) {
      await ctx.db.patch(e._id, { invoiceId, updatedAt: now });
    }

    // `number: null` — drafts are unnumbered; callers build the draft URL
    // from `invoiceId` (getInvoice accepts a doc ID as identifier).
    return { invoiceId, resumed: false, prefix, number: null };
  },
});

// ─── Editor Queries ───────────────────────────────────────────────────────────

/**
 * Get a single invoice with all data needed for the editor:
 * line items grouped by category, project info, client info, org brand settings.
 */
export const getInvoice = query({
  // `identifier` is the URL segment. Two accepted forms (decision 2026-05-03):
  //   1. Friendly form, e.g. "INV-035" — primary path; produced by every
  //      internal link via `formatInvoiceNumber(prefix, number)`.
  //   2. Convex doc ID — backwards-compat fallback for bookmarks / pasted
  //      links saved before the URL refactor.
  // The page never has to know which form it received.
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await resolveInvoiceByIdentifier(ctx, orgId, args.identifier);
    if (!invoice) return null;

    // Fetch line items
    const lineItems = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
      .collect();
    lineItems.sort((a, b) => a.sortOrder - b.sortOrder);

    // Group line items by workCategoryId for category headers
    const categoryIds = new Set<string>();
    for (const li of lineItems) {
      if (li.workCategoryId) categoryIds.add(li.workCategoryId);
    }

    // Fetch category names (tenancy-guarded — never cross-tenant even if a
    // rogue line item ever references a foreign categoryId).
    const categoryMap = new Map<string, { name: string; color: string }>();
    for (const catId of categoryIds) {
      const cat = await ctx.db.get(catId as Id<"workCategories">);
      if (cat && cat.orgId === orgId) {
        categoryMap.set(catId, { name: cat.name, color: cat.color });
      }
    }

    // Build grouped structure: categories with their line items
    type CategoryGroup = {
      categoryId: string | null;
      categoryName: string;
      categoryColor: string;
      lineItems: typeof lineItems;
      subtotalHours: number;
    };

    const grouped: CategoryGroup[] = [];
    const catGroupMap = new Map<string, CategoryGroup>();

    for (const li of lineItems) {
      const catKey = li.workCategoryId?.toString() ?? "uncategorized";
      let group = catGroupMap.get(catKey);
      if (!group) {
        const catInfo = li.workCategoryId
          ? categoryMap.get(li.workCategoryId) ?? { name: "Unknown", color: "gray" }
          : { name: "Other", color: "gray" };
        group = {
          categoryId: li.workCategoryId ?? null,
          categoryName: catInfo.name,
          categoryColor: catInfo.color,
          lineItems: [],
          subtotalHours: 0,
        };
        catGroupMap.set(catKey, group);
        grouped.push(group);
      }
      group.lineItems.push(li);
      // Only time lines have hour quantities; fixed/overage/manual
      // store amounts or unit counts that must not inflate the hours subtotal.
      if (li.lineType === "time") group.subtotalHours += li.quantity;
    }

    // Round subtotal hours
    for (const g of grouped) {
      g.subtotalHours = round2(g.subtotalHours);
    }

    // Fetch related data (tenancy-guarded — a doc ID collision or data-drift
    // bug must not leak a foreign project/client through this query).
    const projectRaw = await ctx.db.get(invoice.projectId);
    const project =
      projectRaw && projectRaw.orgId === orgId ? projectRaw : null;
    const clientRaw = await ctx.db.get(invoice.clientId);
    const client =
      clientRaw && clientRaw.orgId === orgId ? clientRaw : null;
    const orgSettings = await getOrgSettings(ctx, orgId);

    // Count org invoices for first-time brand info nudge (only need to know if <= 1)
    const orgInvoiceSample = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(2);

    // Fixed Fee: compute total billed from lineType:"fixed" items across
    // finalized project invoices only. Drafts are provisional (see createInvoice).
    let fixedBilled = 0;
    if (project && project.billingType === "fixed") {
      const projectInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", invoice.projectId))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      for (const inv of projectInvoices) {
        if (inv.status === "draft" || inv.status === "void") continue;
        const invItems = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of invItems) {
          if (item.lineType === "fixed") fixedBilled += item.amount;
        }
      }
      fixedBilled = round2(fixedBilled);
    }

    // Same shape as `convex/statements.ts` returns; frontend
    // (`lib/retainerLabels.ts`) renders both via the same component.
    let retainerUsage: {
      kind: "month" | "cycle";
      closed: boolean;
      monthlyIncludedMinutes: number;
      rows: Array<{
        label: string;
        availableMinutes: number;
        usedMinutes: number;
        balanceMinutes: number;
      }>;
      total: {
        availableMinutes: number;
        usedMinutes: number;
        balanceMinutes: number;
        amountDue: number;
      };
    } | null = null;
    if (
      project &&
      project.billingType === "retainer" &&
      invoice.retainerIncludedMinutes != null &&
      invoice.retainerUsedMinutes != null &&
      invoice.retainerEndBalanceMinutes != null
    ) {
      const rolloverEnabled =
        invoice.retainerRolloverEnabled ?? project.rolloverEnabled ?? true;
      const cycleLength =
        invoice.retainerCycleLength ?? project.cycleLength ?? 3;
      const months = invoiceMonthRange(invoice.periodStart, invoice.periodEnd);
      const effectiveMonths: YearMonth[] =
        months.length > 0
          ? months
          : [{ year: Number(invoice.issueDate.slice(0, 4)), month: Number(invoice.issueDate.slice(5, 7)) }];
      // For rollover invoices the snapshot stores the cycle total
      // (monthly × cycleLength). Reverse-divide to get the per-month budget.
      // Assumes integer monthly minutes — every supported retainer size
      // (5h/8h/10h/15h/20h/30h/40h/50h) is divisible, and the project form
      // doesn't allow fractional input.
      const monthlyIncluded = rolloverEnabled
        ? Math.round(invoice.retainerIncludedMinutes / cycleLength)
        : invoice.retainerIncludedMinutes;

      // Raw per-month usage from the time entries this invoice line items
      // reference. May not sum exactly to `invoice.retainerUsedMinutes`
      // (snapshot is rounded at invoice generation per
      // `feedback_no_rounding_on_reporting.md`).
      const entryIds = new Set<Id<"timeEntries">>();
      for (const item of lineItems) {
        if (item.lineType !== "time") continue;
        for (const entryId of item.timeEntryIds ?? []) entryIds.add(entryId);
      }
      const rawByMonth = new Map<string, number>();
      const entryDocs = await Promise.all(
        Array.from(entryIds).map((entryId) => ctx.db.get(entryId)),
      );
      for (const entry of entryDocs) {
        if (!entry || entry.orgId !== orgId || !entry.isBillable) continue;
        const key = entry.date.slice(0, 7);
        rawByMonth.set(key, (rawByMonth.get(key) ?? 0) + entry.durationMinutes);
      }

      // Round per row so the per-month rows reconcile to the billed snapshot
      // total exactly (decision 2026-05-03 Q1). The previous implementation
      // dumped the rounding delta silently on the last month.
      const usedByMonth = reconcileUsedMinutesToTotal({
        months: effectiveMonths,
        rawByMonth,
        totalUsedMinutes: invoice.retainerUsedMinutes,
      });

      const rows = buildRetainerUsageRows({
        months: effectiveMonths,
        monthlyIncludedMinutes: monthlyIncluded,
        usedMinutesByMonth: usedByMonth,
      });

      retainerUsage = {
        kind: rolloverEnabled ? "cycle" : "month",
        closed: true, // an invoice doc only renders for an issued invoice
        monthlyIncludedMinutes: monthlyIncluded,
        rows,
        total: {
          // Footer values come from the frozen snapshot — never recomputed —
          // so the document always matches what the client was billed.
          availableMinutes: invoice.retainerIncludedMinutes,
          usedMinutes: invoice.retainerUsedMinutes,
          balanceMinutes: invoice.retainerEndBalanceMinutes,
          amountDue: invoice.total,
        },
      };
    }

    return {
      invoice,
      lineItems,
      categoryGroups: grouped,
      orgInvoiceCount: orgInvoiceSample.length,
      fixedBilled,
      retainerUsage,
      project: project
        ? { name: project.name, billingType: project.billingType, fixedPrice: project.fixedPrice }
        : null,
      client: client
        ? {
            name: client.name,
            billingName: client.billingName,
            billingEmail: client.billingEmail,
            billingCountry: client.billingCountry,
            billingCity: client.billingCity,
            billingZip: client.billingZip,
            billingStreet: client.billingStreet,
            billingStreet2: client.billingStreet2,
            taxId: client.taxId,
          }
        : null,
      brand: orgSettings
        ? {
            brandName: orgSettings.brandName,
            brandAddress: orgSettings.brandAddress,
            brandTaxId: orgSettings.brandTaxId,
            brandEmail: orgSettings.brandEmail,
            brandPhone: orgSettings.brandPhone,
          }
        : null,
      timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
      // Org-level template surfaces rendered on the invoice document.
      // Bundled with `getInvoice` so the editor doesn't need a second
      // `orgSettings.get` round-trip — same trip-saving as `brand`.
      org: {
        paymentInstructions: orgSettings?.paymentInstructions,
        invoiceMessageTemplate: orgSettings?.invoiceMessageTemplate,
      },
    };
  },
});

// ─── Editor Mutations ─────────────────────────────────────────────────────────

/**
 * Update draft invoice metadata: subject, issueDate, dueDate, note.
 */
export const updateInvoice = mutation({
  args: {
    id: v.id("invoices"),
    subject: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    // `null` clears the due date; `undefined` leaves it unchanged.
    dueDate: v.optional(v.union(v.string(), v.null())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new ConvexError("Only draft invoices can be edited.");
    }

    // Validate YYYY-MM-DD format + parseability; invalid strings would break
    // downstream lexicographic comparisons in getInvoiceMetrics / isOverdue.
    const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;
    const validateDate = (value: string, field: string) => {
      if (!ymdPattern.test(value) || Number.isNaN(new Date(value).getTime())) {
        throw new ConvexError(`Invalid ${field} — expected YYYY-MM-DD.`);
      }
    };
    if (args.issueDate !== undefined) validateDate(args.issueDate, "issue date");
    if (args.dueDate !== undefined && args.dueDate !== null) {
      validateDate(args.dueDate, "due date");
    }

    // dueDate cannot be before issueDate. Compare against the post-patch values.
    const nextIssueDate = args.issueDate ?? invoice.issueDate;
    const nextDueDate =
      args.dueDate === undefined
        ? invoice.dueDate
        : args.dueDate ?? undefined;
    if (nextDueDate && nextDueDate < nextIssueDate) {
      throw new ConvexError("Due date cannot be before the issue date.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.subject !== undefined) patch.subject = args.subject;
    if (args.issueDate !== undefined) patch.issueDate = args.issueDate;
    if (args.dueDate !== undefined) patch.dueDate = args.dueDate ?? undefined;
    if (args.note !== undefined) patch.note = args.note || undefined;

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Update the editable `messageToClient` block on an invoice. Editable on
 * drafts only (`canEditInvoiceMessage`); finalized, paid, and voided
 * invoices are locked. Trims input; empty (after trim) clears the field.
 */
export const updateInvoiceMessage = mutation({
  args: {
    id: v.id("invoices"),
    messageToClient: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    // Trim first, then validate — a 5001-char input with trailing whitespace
    // that trims to <5000 should be accepted, not rejected.
    const trimmed = args.messageToClient.trim();
    validateStringLength(trimmed, 5000, "Message to client");

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }

    if (!canEditInvoiceMessage(invoice)) {
      throw new ConvexError("This invoice's message is locked.");
    }

    await ctx.db.patch(args.id, {
      messageToClient: trimmed === "" ? undefined : trimmed,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a single line item on a draft invoice.
 * Auto-computes amount = quantity × unitPrice unless explicit amount is provided.
 * Recalculates invoice totals.
 */
export const updateInvoiceLineItem = mutation({
  args: {
    id: v.id("invoiceLineItems"),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const lineItem = await ctx.db.get(args.id);
    if (!lineItem || lineItem.orgId !== orgId) {
      throw new ConvexError("Line item not found.");
    }

    const invoice = await ctx.db.get(lineItem.invoiceId);
    if (!invoice || invoice.orgId !== orgId || invoice.status !== "draft") {
      throw new ConvexError("Only draft invoices can be edited.");
    }

    // Derived line types (`fixed`, `overage`) are anchored to project/invoice
    // snapshots (fixedPrice, retainerOverageRate, etc.). Editing their numeric
    // fields would silently desync the total from the snapshot.
    // Discounts/adjustments must be expressed as a manual line.
    // Description stays editable so admins can relabel.
    if (lineItem.lineType !== "time" && lineItem.lineType !== "manual") {
      if (
        args.quantity !== undefined ||
        args.unitPrice !== undefined ||
        args.amount !== undefined
      ) {
        throw new ConvexError(
          "This line is derived from the project and its amount cannot be edited. Add a manual adjustment line instead.",
        );
      }
    }

    // Non-negative guard: prevents negative hours/rates/amounts from corrupting
    // retainer balance math and invoice totals.
    if (args.quantity !== undefined && args.quantity < 0) {
      throw new ConvexError("Quantity cannot be negative.");
    }
    if (args.unitPrice !== undefined && args.unitPrice < 0) {
      throw new ConvexError("Rate cannot be negative.");
    }
    if (args.amount !== undefined && args.amount < 0) {
      throw new ConvexError("Amount cannot be negative.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.description !== undefined) patch.description = args.description;
    if (args.quantity !== undefined) patch.quantity = args.quantity;
    if (args.unitPrice !== undefined) patch.unitPrice = args.unitPrice;

    // Keep `quantityMinutes` (Harvest/Bonsai-style source of truth) in lockstep
    // with `quantity`. A manual hours edit decouples the row from its source
    // time entries; re-derive minutes from the new hours so retainer recalc
    // sees the right value without hours→minutes reconstruction drift.
    if (args.quantity !== undefined && lineItem.lineType === "time") {
      patch.quantityMinutes = Math.max(0, Math.round(args.quantity * 60));
    }

    // Amount computation rules:
    //   - Explicit `amount` arg: apply it. Flag as overridden ONLY if the value
    //     diverges from `quantity × unitPrice`; passing the computed value back
    //     (e.g. after a correction round-trip) clears the override so future
    //     qty/rate edits resume auto-compute.
    //   - Qty/price changed without an amount arg: auto-compute as long as the
    //     row isn't locked by a prior override.
    if (args.amount !== undefined) {
      const qty = args.quantity ?? lineItem.quantity;
      const price = args.unitPrice ?? lineItem.unitPrice;
      const computed = round2(qty * price);
      const nextAmount = round2(args.amount);
      patch.amount = nextAmount;
      patch.amountOverridden = nextAmount !== computed;
    } else if (args.quantity !== undefined || args.unitPrice !== undefined) {
      if (!lineItem.amountOverridden) {
        const qty = args.quantity ?? lineItem.quantity;
        const price = args.unitPrice ?? lineItem.unitPrice;
        patch.amount = round2(qty * price);
      }
    }

    await ctx.db.patch(args.id, patch);

    // Recalculate invoice totals. Project is tenancy-guarded so recalc never
    // reads snapshot config from a foreign project (defense-in-depth).
    const projectRaw = await ctx.db.get(invoice.projectId);
    const project =
      projectRaw && projectRaw.orgId === orgId ? projectRaw : null;

    if (project?.billingType === "retainer" && lineItem.lineType === "time") {
      // Retainer: full balance recalculation when time rows change
      await recalcRetainerBalance(ctx, lineItem.invoiceId, invoice, project);
    } else {
      // T&M / Fixed / non-time rows: simple subtotal recalc
      const items = await ctx.db
        .query("invoiceLineItems")
        .withIndex("by_invoiceId", (q) => q.eq("invoiceId", lineItem.invoiceId))
        .collect();
      let subtotal = 0;
      for (const item of items) {
        subtotal += item._id === args.id ? (patch.amount as number ?? item.amount) : item.amount;
      }
      subtotal = round2(subtotal);
      await ctx.db.patch(lineItem.invoiceId, { subtotal, total: subtotal, updatedAt: Date.now() });
    }
  },
});

/**
 * Add a manual line item to a draft invoice.
 */
export const addInvoiceLineItem = mutation({
  args: {
    invoiceId: v.id("invoices"),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new ConvexError("Only draft invoices can be edited.");
    }

    // Get max sortOrder
    const existing = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();
    const maxSort = existing.reduce((max, li) => Math.max(max, li.sortOrder), -1);

    const now = Date.now();
    await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId: args.invoiceId,
      sortOrder: maxSort + 1,
      lineType: "manual",
      description: args.description ?? "New line item",
      quantity: 0,
      unitPrice: 0,
      amount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Totals unchanged (amount = 0)
  },
});

/**
 * Remove a line item from a draft invoice. Recalculates totals.
 */
export const removeInvoiceLineItem = mutation({
  args: {
    id: v.id("invoiceLineItems"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const lineItem = await ctx.db.get(args.id);
    if (!lineItem || lineItem.orgId !== orgId) {
      throw new ConvexError("Line item not found.");
    }

    const invoice = await ctx.db.get(lineItem.invoiceId);
    if (!invoice || invoice.orgId !== orgId || invoice.status !== "draft") {
      throw new ConvexError("Only draft invoices can be edited.");
    }

    // Guard core billing rows: `fixed` is derived from the project and anchors
    // the invoice total — removing it leaves the invoice in an incoherent
    // state. `overage` is auto-managed by `recalcRetainerBalance`. Only `time`
    // and `manual` rows can be removed by the user.
    if (lineItem.lineType === "fixed" || lineItem.lineType === "overage") {
      throw new ConvexError(
        "This line item is derived from the project and cannot be removed.",
      );
    }

    // Clear invoiceId on linked time entries so they become available for future invoicing
    if (lineItem.timeEntryIds && lineItem.timeEntryIds.length > 0) {
      const now = Date.now();
      for (const entryId of lineItem.timeEntryIds) {
        const entry = await ctx.db.get(entryId);
        // Explicit tenancy gate on the linked entry (defense-in-depth — the
        // lineItem is already org-scoped, so this should always hold).
        if (
          entry &&
          entry.orgId === orgId &&
          entry.invoiceId === lineItem.invoiceId
        ) {
          await ctx.db.patch(entryId, { invoiceId: undefined, updatedAt: now });
        }
      }
    }

    await ctx.db.delete(args.id);

    // Recalculate invoice totals (tenancy-guarded project lookup).
    const projectRaw = await ctx.db.get(invoice.projectId);
    const project =
      projectRaw && projectRaw.orgId === orgId ? projectRaw : null;

    if (project?.billingType === "retainer" && lineItem.lineType === "time") {
      // Retainer: full balance recalculation (pass excludeLineItemId since item is deleted)
      await recalcRetainerBalance(ctx, lineItem.invoiceId, invoice, project, args.id);
    } else {
      const remaining = await ctx.db
        .query("invoiceLineItems")
        .withIndex("by_invoiceId", (q) => q.eq("invoiceId", lineItem.invoiceId))
        .collect();
      let subtotal = 0;
      for (const item of remaining) {
        if (item._id !== args.id) subtotal += item.amount;
      }
      subtotal = round2(subtotal);
      await ctx.db.patch(lineItem.invoiceId, { subtotal, total: subtotal, updatedAt: Date.now() });
    }
  },
});

// ─── Lifecycle Mutations ───────────────────────────────────────────────────────

/** Valid status transitions for the invoice state machine.
 *
 *   draft    → invoiced | void
 *   invoiced → paid | draft | void
 *   paid     → invoiced                 (undo mark-paid only)
 *   void     → —                        (terminal; retainer chain already re-opened)
 *
 * `paid → void` is intentionally disallowed: a settled invoice is reconciled
 * with an external payment. Reversing it is "refund / credit note" territory,
 * not a plain void, and should flow through a correction state if ever needed.
 *
 * `paid → draft` is likewise disallowed (lifecycle-tightening, 2026-07-04):
 * a paid invoice re-entering the editable draft state breaks the audit
 * trail. Correction path: paid → invoiced (undo the payment mark) → void →
 * re-bill.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["invoiced", "void"],
  invoiced: ["paid", "draft", "void"],
  paid: ["invoiced"],
  void: [],
};

/**
 * Change invoice status following the state machine:
 *   draft → invoiced → paid
 *   invoiced → draft (revert)
 *   paid → invoiced (undo mark-paid)
 */
type InvoiceStatus = "draft" | "invoiced" | "paid" | "void";
type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * Apply a status transition to a single invoice. Factored out of
 * `changeInvoiceStatus` so `bulkChangeInvoiceStatus` can accumulate per-row
 * failures without aborting the whole mutation.
 *
 * Returns a result object rather than throwing — the single-row mutation
 * still throws on failure to preserve its existing contract.
 */
/**
 * Exported for tests in `convex/__tests__/invoiceTransitions.test.ts` —
 * production callers go through `changeInvoiceStatus` / `bulkChangeInvoiceStatus`
 * / `markInvoicesPaid` / `undoMarkInvoicesPaid` which add auth + per-row
 * skip handling on top.
 */
export async function applyStatusTransition(
  ctx: MutationCtx,
  orgId: string,
  invoice: Doc<"invoices">,
  newStatus: InvoiceStatus,
): Promise<TransitionResult> {
  const allowed = VALID_TRANSITIONS[invoice.status];
  if (!allowed || !allowed.includes(newStatus)) {
    return {
      ok: false,
      reason: `Cannot transition from "${invoice.status}" to "${newStatus}".`,
    };
  }

  // No LIFO retainer-chain guard after the invoicing refactor
  // (`docs/invoicing-refactor.md` D5): every retainer invoice now starts
  // from a 0 balance (`getRetainerStartBalance()`), so voiding or reverting
  // an earlier invoice does not strand any later invoice's snapshot. The
  // period frees up and can be re-billed — exactly user story 12.
  const now = Date.now();
  const patch: Record<string, unknown> = { status: newStatus, updatedAt: now };
  if (newStatus === "paid") patch.paidAt = now;
  if (invoice.status === "paid" && newStatus !== "paid") patch.paidAt = undefined;

  if (invoice.status === "draft" && newStatus === "invoiced") {
    const orgSettings = await getOrgSettings(ctx, orgId);

    // Seller-identity gate: an issued invoice must name its seller. Stripe
    // applies the same rule (no finalize without account details). The
    // company name is set in Settings → General → Company details; address
    // and tax ID are nudged in the UI but don't block.
    if (!orgSettings?.brandName?.trim()) {
      return {
        ok: false,
        reason:
          "Add your company details (Settings → General → Company details) " +
          "before issuing — an invoice needs a seller name.",
      };
    }

    // Allocate the sequence number at FINALIZATION. Drafts are unnumbered
    // (see `createInvoice`), so the issued series is gapless: only invoices
    // that actually reach `invoiced` consume a number. Idempotent — an
    // invoice that was reverted to draft keeps its number, so re-finalizing
    // does not claim a second one. The prefix is also refreshed here so the
    // issued document reflects the org's prefix at issue time, not at draft
    // time. Bulk transitions are safe: Convex mutations read their own
    // writes, so sequential allocations inside one mutation see the bumped
    // counter.
    if (invoice.number == null) {
      const nextNumber = orgSettings.nextInvoiceNumber ?? 1;
      patch.number = nextNumber;
      patch.prefix = orgSettings.invoicePrefix ?? invoice.prefix;
      await ctx.db.patch(orgSettings._id, {
        nextInvoiceNumber: nextNumber + 1,
        updatedAt: now,
      });
    }
  }

  await ctx.db.patch(invoice._id, patch);

  // ─── Phase 8 — settlement side-effects ────────────────────────────────
  //
  // Patch the invoice doc first, then settle/unsettle the entries it owns.
  // Rules per the transition table in `docs/phase-8-time-entry-settlement.md`:
  //
  //   draft → invoiced       settle (Fixed → "fixed_included", else "invoiced")
  //   draft → void           unsettle + clear invoiceId
  //   invoiced → draft       unsettle, keep invoiceId  → entries become "draft"
  //   invoiced → paid        no settlement change       (already settled)
  //   invoiced → void        unsettle + clear invoiceId
  //   paid → invoiced        no settlement change
  //   (paid → draft removed from VALID_TRANSITIONS — 2026-07-04)
  //
  // `paid → void` is in `VALID_TRANSITIONS[invoice.status]` only when
  // `invoice.status === "void"` (terminal) — never reached here.
  const wentToVoid = newStatus === "void";
  const wentToDraft = newStatus === "draft";
  const wasFinalized =
    invoice.status === "invoiced" || invoice.status === "paid";
  const draftBecameInvoiced =
    invoice.status === "draft" && newStatus === "invoiced";

  if (draftBecameInvoiced) {
    // Resolve project.billingType to pick the right reason for Fixed.
    // `invoice.projectId` is `v.id("projects")` in the schema (non-
    // optional), so the only way `ctx.db.get` returns `null` is if the
    // project was deleted between read and write — treat as "non-Fixed"
    // and let the entries settle with the default reason rather than
    // throwing mid-transition.
    const project = await ctx.db.get(invoice.projectId);
    const reason = project?.billingType === "fixed"
      ? "fixed_included"
      : "invoiced";
    await settleInvoiceEntries(
      ctx,
      invoice._id,
      orgId,
      invoice.periodStart,
      invoice.periodEnd,
      reason,
    );
  } else if (wentToVoid) {
    // Free the period — entries become eligible for a fresh invoice run.
    await unsettleInvoiceEntries(ctx, invoice._id, orgId, {
      clearInvoiceId: true,
    });
  } else if (wentToDraft && wasFinalized) {
    // Demote: entries display as "draft" (still owned by the invoice).
    await unsettleInvoiceEntries(ctx, invoice._id, orgId, {
      clearInvoiceId: false,
    });
  }
  // invoiced ↔ paid: no settlement change (entries stay closed either way).

  return { ok: true };
}

export const changeInvoiceStatus = mutation({
  args: {
    id: v.id("invoices"),
    newStatus: v.union(
      v.literal("draft"),
      v.literal("invoiced"),
      v.literal("paid"),
      v.literal("void"),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }

    const result = await applyStatusTransition(ctx, orgId, invoice, args.newStatus);
    if (!result.ok) throw new ConvexError(result.reason);
  },
});

/**
 * Apply a status transition to multiple invoices in one call. Commits
 * succeeded rows even when some fail — matches how the Time-tab bulk
 * billable-toggle surfaces partial success.
 *
 * Returns both lists so the UI can toast "N updated, M failed" with reasons.
 */
export const bulkChangeInvoiceStatus = mutation({
  args: {
    ids: v.array(v.id("invoices")),
    newStatus: v.union(
      v.literal("draft"),
      v.literal("invoiced"),
      v.literal("paid"),
      v.literal("void"),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const succeeded: Id<"invoices">[] = [];
    const failed: { id: Id<"invoices">; reason: string }[] = [];

    for (const id of args.ids) {
      const invoice = await ctx.db.get(id);
      if (!invoice || invoice.orgId !== orgId) {
        failed.push({ id, reason: "Invoice not found." });
        continue;
      }
      const result = await applyStatusTransition(ctx, orgId, invoice, args.newStatus);
      if (result.ok) {
        succeeded.push(id);
      } else {
        failed.push({ id, reason: result.reason });
      }
    }

    return { succeeded, failed };
  },
});

/**
 * Inbox bulk mark-paid — admin-only, idempotent, returns a `priorStates`
 * snapshot the UI hands to `undoMarkInvoicesPaid` within the 5s undo window.
 *
 * Decision logic (per-row classify + patch outcome) lives in
 * `convex/lib/markPaid.ts` so it can be unit-tested without convex-test.
 *
 * Behavior recap (PRD § Concurrency rules · US 7, 48):
 *   - Already `paid`        → no-op (counted as `updated`, snapshot included).
 *   - `invoiced`            → patch `{status: "paid", paidAt: now}`.
 *   - `draft` / `void`      → skipped with reason (defensive — Inbox only
 *                             surfaces overdue rows, but stale UI state on a
 *                             second tab could include other statuses).
 *   - Cross-tenant / missing → skipped with reason.
 *
 * Last-write wins: no version check on the mark side. The snapshot allows
 * the undo path to detect a race and skip without overwriting.
 */
export const markInvoicesPaid = mutation({
  args: {
    invoiceIds: v.array(v.id("invoices")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const now = Date.now();

    let updated = 0;
    const priorStates: PriorState[] = [];
    const skipped: { id: Id<"invoices">; reason: string }[] = [];

    for (const id of args.invoiceIds) {
      const invoice = await ctx.db.get(id);
      if (!invoice || invoice.orgId !== orgId) {
        skipped.push({ id, reason: "Invoice not found." });
        continue;
      }
      const outcome = classifyMarkPaid(
        { status: invoice.status, paidAt: invoice.paidAt },
        now,
      );
      if (outcome.kind === "skip") {
        skipped.push({ id, reason: outcome.reason });
        continue;
      }
      priorStates.push({
        id,
        status: outcome.prior.status,
        paidAt: outcome.prior.paidAt,
      });
      updated += 1;
      if (outcome.kind === "patch") {
        // Route through applyStatusTransition so the Phase 8 settlement
        // contract (invoiced → paid: no settlement change) is enforced by
        // the same code path as `changeInvoiceStatus`. Today this is
        // equivalent to a direct patch, but routing centrally means a
        // future widening of classifyMarkPaid can't silently bypass
        // settle/unsettle. `setPaidAt` is unused — applyStatusTransition
        // computes `paidAt = now` from its own `now` (identical here).
        const result = await applyStatusTransition(ctx, orgId, invoice, "paid");
        if (!result.ok) {
          // Should be unreachable — classifyMarkPaid only patches when
          // current=invoiced, and invoiced → paid is in VALID_TRANSITIONS.
          // Treat as skip rather than throw so the rest of the batch ships.
          skipped.push({ id, reason: result.reason });
          updated -= 1;
          priorStates.pop();
        }
      }
      // `noop`: counted in `updated`, no DB write.
    }

    return { updated, skipped, priorStates };
  },
});

/**
 * Inbox undo — reverts a prior `markInvoicesPaid` batch within the 5s window.
 *
 * Skip rule: if an invoice's current status is no longer "paid", another
 * admin (or another tab) transitioned it during our window. Per the PRD we
 * NEVER overwrite their edit — that row is added to `skipped` with a reason
 * the UI surfaces in the toast.
 */
export const undoMarkInvoicesPaid = mutation({
  args: {
    priorStates: v.array(
      v.object({
        id: v.id("invoices"),
        status: v.union(
          v.literal("draft"),
          v.literal("invoiced"),
          v.literal("paid"),
          v.literal("void"),
        ),
        paidAt: v.union(v.number(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const now = Date.now();

    let reverted = 0;
    const skipped: { id: Id<"invoices">; reason: string }[] = [];

    for (const snapshot of args.priorStates) {
      const invoice = await ctx.db.get(snapshot.id);
      if (!invoice || invoice.orgId !== orgId) {
        skipped.push({ id: snapshot.id, reason: "Invoice not found." });
        continue;
      }
      const outcome = classifyUndo(
        { status: invoice.status, paidAt: invoice.paidAt },
        { status: snapshot.status, paidAt: snapshot.paidAt },
      );
      if (outcome.kind === "skip") {
        skipped.push({ id: snapshot.id, reason: outcome.reason });
        continue;
      }
      // Route through applyStatusTransition so the Phase 8 settlement
      // contract is enforced centrally. In practice undo only reverts
      // paid → invoiced (snapshot.status is always "invoiced" given how
      // classifyMarkPaid gates the mark side); applyStatusTransition's
      // `paid → invoiced` branch clears paidAt to `undefined`, which
      // matches snapshot.paidAt === null for that case. For the rare
      // snapshot.status === "paid" case (idempotent mark — current and
      // snapshot agree) the transition is paid → paid (not in
      // VALID_TRANSITIONS) so we fall back to a direct paidAt restoration
      // without changing status.
      if (outcome.setStatus === invoice.status) {
        // No status change — just restore paidAt from snapshot (covers
        // the idempotent-mark noop revert case).
        await ctx.db.patch(snapshot.id, {
          paidAt: outcome.setPaidAt ?? undefined,
          updatedAt: now,
        });
        reverted += 1;
        continue;
      }
      const result = await applyStatusTransition(
        ctx,
        orgId,
        invoice,
        outcome.setStatus,
      );
      if (!result.ok) {
        skipped.push({ id: snapshot.id, reason: result.reason });
        continue;
      }
      reverted += 1;
    }

    return { reverted, skipped };
  },
});

/**
 * Delete a DRAFT invoice:
 * 1. Unlink time entries (clear invoiceId) — must happen BEFORE deleting line items
 * 2. Delete all line items
 * 3. Delete the invoice
 *
 * Drafts only (lifecycle-tightening, 2026-07-04). A finalized invoice has a
 * sequence number and represents an issued document — hard-deleting one
 * destroys the audit trail and punches a hole in the gapless series. The
 * correction path for issued invoices is: (paid →) invoiced → void, which
 * keeps the numbered record and frees the period for re-billing.
 *
 * No LIFO retainer-chain guard after the invoicing refactor
 * (`docs/invoicing-refactor.md` D5): every retainer invoice starts from a 0
 * balance, so deleting an earlier one does not strand a later invoice's
 * snapshot. The period frees up and can be re-billed.
 */
export const deleteInvoice = mutation({
  args: {
    id: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new ConvexError(
        "Only draft invoices can be deleted. Void a finalized invoice instead — " +
          "that keeps the numbered record and frees the period for re-billing.",
      );
    }

    // 1. Unlink + unsettle time entries via the shared helper. Same
    //    tenancy + canonical-set guarantees as the inline loop this
    //    replaced, plus it clears the four Phase 8 settlement fields so
    //    a previously-settled entry doesn't drag stale snapshot data
    //    into its next invoice run.
    await unsettleInvoiceEntries(ctx, args.id, orgId, {
      clearInvoiceId: true,
    });

    // 2. Delete all line items (now read separately — settle helper
    //    consumed them but didn't delete them).
    const lineItems = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.id))
      .collect();
    for (const li of lineItems) {
      await ctx.db.delete(li._id);
    }

    // 3. Delete the invoice
    await ctx.db.delete(args.id);
  },
});
