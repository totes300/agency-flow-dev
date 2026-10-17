/**
 * Retainer Monthly Reports — period summaries for retainer months.
 *
 * Why this file exists: a retainer month with no billable amount (within
 * budget, no overage) doesn't produce an invoice — see
 * `convex/lib/readyToInvoice.ts:isInvoiceable` and the createInvoice guard in
 * `convex/invoices.ts`. The "what happened in this period" record still
 * matters (audit, client share-out), so we render it on demand from the same
 * data that drives the project's MonthlyBreakdownCard. No new persisted
 * entity — the report IS a render of `getRetainerStatement`.
 *
 * Design rules (locked with the user, 2026-05-02; see
 * `docs/invoicing-refactor.md`):
 *  - Reports are NOT entities — they're computed every read from time
 *    entries + project config. Backdated edits are reflected on the next
 *    render (D7 — no period locking in MVP).
 *  - The PDF document header is "Monthly Report" (D8), not invoice-shaped —
 *    no invoice number, no AMOUNT DUE, no due date. The client must not
 *    mistake the report for a bill.
 *  - Available for every past month, the current in-progress month
 *    (rendered with an "In progress — partial data" badge per D6), and for
 *    rollover projects includes cycle-to-date totals.
 *  - Future-month requests return `null` so the page can `notFound()`.
 *  - Future auto-send cron will call this same query — the single source of
 *    truth keeps emailed reports identical to manually downloaded ones.
 *
 * Server symbol name kept as `getRetainerStatement` to minimize churn (per
 * Open Question 1). The visible component and document title are the only
 * places "Monthly Report" appears in user-facing copy.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { classifyReportPeriod } from "./lib/reportPeriod";
import { invoiceCoversMonth } from "./lib/invoiceAnchor";
import { computeReportMonths } from "./lib/reportMembership";
import { toScopeProjectInput, toScopeEntryInput } from "./lib/commitScope";
import {
  getRetainerCyclePosition,
  getRetainerCycleStartMonth,
} from "./lib/retainerBalance";
import {
  buildCycleRangeLabel,
  buildRetainerUsageRows,
  monthRangeFrom,
  type RetainerUsageRow,
} from "./lib/retainerUsage";
import type { Doc, Id } from "./_generated/dataModel";
import { round2 } from "./lib/billing/money";
import { getProjectEntries } from "./lib/projectEntries";
import { groupByCategory, type EntryRow } from "./lib/billing/reportGroups";

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * All data needed to render a statement document for a retainer project's
 * closed month. Returns null if the project / month / period is invalid so
 * the page can `notFound()` cleanly.
 *
 * Balance numbers on the report are RAW (no rounding) per
 * `feedback_no_rounding_on_reporting.md`. Rounding lives at invoice
 * generation only, so reports and invoices may differ by the rounding
 * bucket. `computeRetainerBalance` (in `convex/lib/retainerBalance.ts`)
 * handles the rounding side; this query stays raw.
 *
 * If a billable invoice exists for the month, the statement still renders
 * (the client may want a share-out copy even after billing), and
 * `linkedInvoice` is set so the UI can link out.
 */
export const getRetainerStatement = query({
  args: {
    projectId: v.id("projects"),
    year: v.number(),
    month: v.number(), // 1-12
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    if (!Number.isInteger(args.year) || args.year < 2000) return null;
    if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12)
      return null;

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;
    if (project.billingType !== "retainer") return null;

    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) return null;

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // D6 — future months never render. Past months render closed; the current
    // month renders with an "In progress" badge so partial data isn't sent.
    const periodKind = classifyReportPeriod(args.year, args.month, todayStr);
    if (periodKind === "future") return null;
    const inProgress = periodKind === "current";

    // Period boundaries in YYYY-MM-DD.
    const periodStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const lastDay = new Date(args.year, args.month, 0).getDate();
    const periodEnd = `${args.year}-${String(args.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Pull every project entry once; filter in JS for the period (and for
    // cycle-to-date below). The previous implementation re-ran the per-task
    // collect for the cycle-range filter, doubling read amplification on
    // every Monthly Report render for rollover projects.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();
    const taskMap = new Map<string, Doc<"tasks">>();
    for (const t of tasks) taskMap.set(t._id, t);

    const allTaskEntries = await getProjectEntries(ctx, orgId, args.projectId);

    // Month-Close (slice 07) — membership by REPORT MONTH, not raw date:
    // closed months read from settlement stamps (I4 — stable), open months
    // from `billingScope`, and skipped / logged-late entries land on the
    // RECEIVING month. This makes each entry appear on exactly one client
    // document, and keeps a delivered (closed) report immutable.
    const closedPeriodRows = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    const reportMonths = computeReportMonths({
      project: toScopeProjectInput(project),
      entries: allTaskEntries.map(toScopeEntryInput),
      closedPeriods: closedPeriodRows.map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        closedAt: p.closedAt ?? null,
      })),
      invoices: projectInvoices.map((inv) => ({
        status: inv.status,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
      })),
      todayStr,
    });
    const currentMonthKey = `${args.year}-${String(args.month).padStart(2, "0")}`;

    // Members of THIS report month. Split into in-period (dated in the month)
    // and carried-in (dated earlier, deferred/late into this month).
    const memberEntries = allTaskEntries.filter(
      (e) => reportMonths.get(e._id.toString()) === currentMonthKey,
    );
    const inPeriodEntries = memberEntries.filter((e) => e.date >= periodStart);
    const carriedEntries = memberEntries.filter((e) => e.date < periodStart);
    const billableEntries = inPeriodEntries.filter((e) => e.isBillable);
    const nonBillableEntries = inPeriodEntries.filter((e) => !e.isBillable);

    // Categories for every member (in-period + carried), used by all groupings.
    const catIds = new Set<string>();
    for (const e of memberEntries) {
      const cid = e.snapshotCategoryId;
      if (cid) catIds.add(cid.toString());
    }
    const catMap = new Map<string, { name: string; color: string }>();
    for (const cid of catIds) {
      const cat = await ctx.db.get(cid as Id<"workCategories">);
      if (cat && cat.orgId === orgId) {
        catMap.set(cid, { name: cat.name, color: cat.color });
      }
    }

    const toRow = (e: Doc<"timeEntries">): EntryRow => ({
      _id: e._id,
      taskId: e.taskId,
      workCategoryId: e.snapshotCategoryId ?? undefined,
      durationMinutes: e.durationMinutes,
      date: e.date,
    });

    const billableCategoryGroups = groupByCategory(
      billableEntries.map(toRow),
      taskMap,
      catMap,
    );
    const nonBillableCategoryGroups = groupByCategory(
      nonBillableEntries.map(toRow),
      taskMap,
      catMap,
    );

    // "Carried over from <month>" groups — one per origin month, with the
    // entries' TRUE dates (PRD story 31). v1 copy: a single label per origin
    // month regardless of skipped-vs-logged-late (open question — copy-only).
    const carriedByMonth = new Map<string, Doc<"timeEntries">[]>();
    for (const e of carriedEntries) {
      const k = e.date.slice(0, 7);
      const bucket = carriedByMonth.get(k);
      if (bucket) bucket.push(e);
      else carriedByMonth.set(k, [e]);
    }
    const carriedGroups = [...carriedByMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([monthKey, entries]) => {
        const [cy, cm] = monthKey.split("-").map(Number);
        return {
          monthKey,
          monthLabel: new Date(cy, cm - 1, 1).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
          totalMinutes: entries.reduce((s, e) => s + e.durationMinutes, 0),
          billableCategoryGroups: groupByCategory(
            entries.filter((e) => e.isBillable).map(toRow),
            taskMap,
            catMap,
          ),
          nonBillableCategoryGroups: groupByCategory(
            entries.filter((e) => !e.isBillable).map(toRow),
            taskMap,
            catMap,
          ),
        };
      });

    // Find any non-void invoice covering this month so the report can show
    // a "Billed via INV-X" pointer. `invoiceCoversMonth` handles both
    // monthly (single-month period) and rollover (cycle-spanning period)
    // invoices uniformly — see `convex/lib/invoiceAnchor.ts`.
    const linkedInvoice =
      projectInvoices.find(
        (inv) =>
          inv.status !== "void" &&
          invoiceCoversMonth(inv, args.year, args.month),
      ) ?? null;

    // Whether this month's ledger is FINAL — settled by a month/cycle close
    // (closed retainerPeriods row; cycle closes write one per month) or by a
    // FINALIZED invoice covering it. Drives the report's two modes: a final
    // statement is the immutable client deliverable (worksheet export
    // available — stamps exist); anything else renders as an explicitly-live
    // progress view. One ceremony per cycle: an elapsed mid-cycle month of an
    // open rollover cycle stays non-final until the whole cycle closes. A
    // draft invoice does NOT finalize — it's still editable.
    const isFinal =
      !inProgress &&
      (closedPeriodRows.some(
        (p) =>
          p.periodStart === periodStart && (p.closedAt ?? null) !== null,
      ) ||
        projectInvoices.some(
          (inv) =>
            inv.status !== "void" &&
            inv.status !== "draft" &&
            invoiceCoversMonth(inv, args.year, args.month),
        ));

    const includedMinutes = project.includedMinutesPerMonth ?? 0;
    const monthlyFee = project.monthlyFee ?? 0;
    const overageRate = project.overageRate ?? 0;
    // Defaults mirror `projects.create` (cycleLength 1 → monthly, no rollover).
    const rolloverEnabled = project.rolloverEnabled ?? false;
    const cycleLength = project.cycleLength ?? 1;

    // Balance numbers are computed RAW from time entries — no rounding, no
    // reading from the invoice's frozen snapshot. Per
    // `feedback_no_rounding_on_reporting.md`: rounding lives at invoice
    // generation; reporting/overview surfaces are always raw ledger. Reports
    // and invoices may differ by the rounding bucket, by design.
    // Usage = billable minutes of every member of this month (in-period AND
    // carried-in), so the balance reflects the receiving-period rule and stays
    // stable from settlement stamps once closed.
    const usedMinutes = memberEntries
      .filter((e) => e.isBillable)
      .reduce((s, e) => s + e.durationMinutes, 0);
    // Every retainer invoice now starts from a 0 balance per refactor D1
    // (`getRetainerStartBalance()`); reports mirror that.
    const startBalanceMinutes = 0;
    const endBalanceMinutes = startBalanceMinutes + includedMinutes - usedMinutes;
    const overageMinutes = endBalanceMinutes < 0 ? Math.abs(endBalanceMinutes) : 0;
    const overageHours = round2(overageMinutes / 60);

    // Cycle-to-date — rollover projects only. Sums every billable entry from
    // cycleStart through periodEnd so a mid-cycle report shows both this
    // month's usage AND where the cycle stands overall (user story 17).
    let cycleToDate: {
      cycleStart: string;
      cycleEnd: string;
      cycleLabel?: string;
      cycleNumber: number;
      positionInCycle: number; // 1-indexed for display
      includedMinutes: number;
      usedMinutes: number;
      balanceMinutes: number;
    } | null = null;
    let usageRows: RetainerUsageRow[] = [];
    // `kind` and `closed` are state primitives that the frontend uses to
    // derive labels (`lib/retainerLabels.ts`) — no copy strings ship from
    // the backend (decision 2026-05-03 Q3).
    let usageKind: "month" | "cycle" = "month";
    let usageClosed = false;
    let paymentOverageMinutes = 0;
    let paymentAmountDue = 0;

    // Cycle usage per month buckets by REPORT month (stamps/scope), not raw
    // date — so a carried-in entry counts toward its receiving month here too.
    const usedMinutesByMonth = new Map<string, number>();
    for (const entry of allTaskEntries) {
      if (!entry.isBillable) continue;
      const key = reportMonths.get(entry._id.toString()) ?? entry.date.slice(0, 7);
      usedMinutesByMonth.set(
        key,
        (usedMinutesByMonth.get(key) ?? 0) + entry.durationMinutes,
      );
    }

    if (rolloverEnabled && project.startDate) {
      const cycleStartMonth = getRetainerCycleStartMonth(
        project.startDate,
        args.year,
        args.month,
        cycleLength,
      );
      const positionInCycle = getRetainerCyclePosition(
        project.startDate,
        args.year,
        args.month,
        cycleLength,
      );
      if (cycleStartMonth && positionInCycle >= 0) {
        const cycleStart = `${cycleStartMonth.year}-${String(cycleStartMonth.month).padStart(2, "0")}-01`;
        const cycleEndMonthIndex0 = cycleStartMonth.month - 1 + (cycleLength - 1);
        const cycleEndYear =
          cycleStartMonth.year + Math.floor(cycleEndMonthIndex0 / 12);
        const cycleEndMonth = (cycleEndMonthIndex0 % 12) + 1;
        const cycleEndLastDay = new Date(cycleEndYear, cycleEndMonth, 0).getDate();
        const cycleEnd = `${cycleEndYear}-${String(cycleEndMonth).padStart(2, "0")}-${String(cycleEndLastDay).padStart(2, "0")}`;
        const cycleMonths = monthRangeFrom(cycleStartMonth, positionInCycle + 1);
        const cycleRangeMonths = monthRangeFrom(cycleStartMonth, cycleLength);

        // Filter the already-fetched project entries to the cycle range
        // (cycleStart → periodEnd, current month inclusive even if mid-month —
        // user wants live cycle-to-date).
        const cycleUsedMinutes = allTaskEntries
          .filter(
            (e) =>
              e.isBillable && e.date >= cycleStart && e.date <= periodEnd,
          )
          .reduce((s, e) => s + e.durationMinutes, 0);

        const cycleIncludedMinutes = includedMinutes * cycleLength;
        cycleToDate = {
          cycleStart,
          cycleEnd,
          // cycleNumber is human-friendly (1-indexed since project start).
          cycleNumber:
            Math.floor(
              ((args.year - Number(project.startDate.split("-")[0])) * 12 +
                (args.month - Number(project.startDate.split("-")[1]))) /
                cycleLength,
            ) + 1,
          positionInCycle: positionInCycle + 1,
          includedMinutes: cycleIncludedMinutes,
          usedMinutes: cycleUsedMinutes,
          balanceMinutes: cycleIncludedMinutes - cycleUsedMinutes,
        };

        usageRows = buildRetainerUsageRows({
          months: cycleMonths,
          monthlyIncludedMinutes: includedMinutes,
          usedMinutesByMonth,
        });
        const finalBalance = usageRows[usageRows.length - 1]?.balanceMinutes ?? 0;
        usageKind = "cycle";
        usageClosed = positionInCycle === cycleLength - 1 && !inProgress;
        if (usageClosed && finalBalance < 0) {
          paymentOverageMinutes = Math.abs(finalBalance);
          paymentAmountDue = round2((paymentOverageMinutes / 60) * overageRate);
        }
        cycleToDate.cycleLabel = buildCycleRangeLabel(cycleRangeMonths);
      }
    }
    if (!rolloverEnabled || usageRows.length === 0) {
      usageRows = buildRetainerUsageRows({
        months: [{ year: args.year, month: args.month }],
        monthlyIncludedMinutes: includedMinutes,
        usedMinutesByMonth: new Map([[currentMonthKey, usedMinutes]]),
      });
      const finalBalance = usageRows[0]?.balanceMinutes ?? endBalanceMinutes;
      usageKind = "month";
      usageClosed = !inProgress;
      if (usageClosed && finalBalance < 0) {
        paymentOverageMinutes = Math.abs(finalBalance);
        paymentAmountDue = round2((paymentOverageMinutes / 60) * overageRate);
      }
    }

    // Period label — "March 2026"
    const periodLabel = new Date(args.year, args.month - 1, 1).toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" },
    );

    return {
      inProgress,
      isFinal,
      period: {
        year: args.year,
        month: args.month,
        start: periodStart,
        end: periodEnd,
        label: periodLabel,
      },
      balance: {
        startBalanceMinutes,
        includedMinutes,
        usedMinutes,
        endBalanceMinutes,
        overageMinutes,
        overageHours,
      },
      cycleToDate,
      billing: {
        monthlyFee,
        overageRate,
        overageAmount: paymentAmountDue,
        currency: client.currency,
      },
      retainerUsage: {
        // Frontend (`lib/retainerLabels.ts`) derives display strings from
        // `kind` / `closed` / `monthlyIncludedMinutes`.
        kind: usageKind,
        closed: usageClosed,
        monthlyIncludedMinutes: includedMinutes,
        rows: usageRows,
        total: {
          // Contractual allocation for the months shown (monthly included ×
          // month count) — NOT the sum of the per-row "available" column,
          // whose rows each re-count the rollover carryover. Matches the
          // invoice footer's frozen `retainerIncludedMinutes` at cycle end,
          // and keeps the footer identity available − used = balance.
          availableMinutes: includedMinutes * usageRows.length,
          usedMinutes: usageRows.reduce((sum, row) => sum + row.usedMinutes, 0),
          balanceMinutes: usageRows[usageRows.length - 1]?.balanceMinutes ?? 0,
          overageMinutes: paymentOverageMinutes,
          amountDue: paymentAmountDue,
        },
      },
      project: {
        id: project._id,
        name: project.name,
        rolloverEnabled,
        cycleLength,
      },
      client: {
        name: client.name,
        billingName: client.billingName,
        billingEmail: client.billingEmail,
        billingStreet: client.billingStreet,
        billingStreet2: client.billingStreet2,
        billingCity: client.billingCity,
        billingZip: client.billingZip,
        billingCountry: client.billingCountry,
        taxId: client.taxId,
      },
      brand: orgSettings
        ? {
            brandName: orgSettings.brandName,
            brandAddress: orgSettings.brandAddress,
            brandTaxId: orgSettings.brandTaxId,
            brandEmail: orgSettings.brandEmail,
            brandPhone: orgSettings.brandPhone,
          }
        : null,
      billableCategoryGroups,
      nonBillableCategoryGroups,
      carriedGroups,
      linkedInvoice: linkedInvoice
        ? {
            id: linkedInvoice._id,
            number: linkedInvoice.number,
            prefix: linkedInvoice.prefix,
            status: linkedInvoice.status,
          }
        : null,
      timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
    };
  },
});
