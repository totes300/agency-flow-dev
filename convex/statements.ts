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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type EntryRow = {
  _id: Id<"timeEntries">;
  taskId: Id<"tasks">;
  workCategoryId?: Id<"workCategories">;
  durationMinutes: number;
  date: string;
};

/**
 * Group a month's billable entries by category → task. Mirrors the shape of
 * `buildRetainerCategoryGroups` in `convex/projects.ts` so the statement
 * document and the monthly breakdown row never disagree on what work was
 * logged. We re-derive (rather than calling getRetainerData) because that
 * query is cycle-scoped and would force this to compute the right
 * cycleOffset just to read one month.
 */
function groupByCategory(
  entries: EntryRow[],
  taskMap: Map<string, Doc<"tasks">>,
  catMap: Map<string, { name: string; color: string }>,
) {
  type Task = {
    taskId: string;
    taskTitle: string;
    totalMinutes: number;
  };
  type CategoryGroup = {
    categoryName: string;
    categoryColor: string;
    totalMinutes: number;
    tasks: Task[];
  };

  const byCat = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const key = e.workCategoryId?.toString() ?? "uncategorized";
    const bucket = byCat.get(key);
    if (bucket) bucket.push(e);
    else byCat.set(key, [e]);
  }

  const out: CategoryGroup[] = [];
  for (const [catKey, catEntries] of byCat) {
    const cat = catKey === "uncategorized" ? null : catMap.get(catKey);
    const categoryName = cat?.name ?? "No category";
    const categoryColor = cat?.color ?? "gray";

    const byTask = new Map<string, EntryRow[]>();
    for (const e of catEntries) {
      const tid = e.taskId.toString();
      const bucket = byTask.get(tid);
      if (bucket) bucket.push(e);
      else byTask.set(tid, [e]);
    }

    const tasks: Task[] = [];
    for (const [taskId, taskEntries] of byTask) {
      const task = taskMap.get(taskId);
      tasks.push({
        taskId,
        taskTitle: task?.title ?? "Unknown task",
        totalMinutes: taskEntries.reduce((s, e) => s + e.durationMinutes, 0),
      });
    }
    tasks.sort((a, b) => b.totalMinutes - a.totalMinutes);

    out.push({
      categoryName,
      categoryColor,
      totalMinutes: catEntries.reduce((s, e) => s + e.durationMinutes, 0),
      tasks,
    });
  }
  out.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  return out;
}

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

    const allTaskEntries = (
      await Promise.all(
        tasks.map((task) =>
          ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect(),
        ),
      )
    ).flat();

    // Statement reflects all logged work in the period regardless of invoice
    // status — voided invoice entries count too (they were really worked).
    const allEntries = allTaskEntries.filter(
      (e) => e.date >= periodStart && e.date <= periodEnd,
    );
    const billableEntries = allEntries.filter((e) => e.isBillable);
    const nonBillableEntries = allEntries.filter((e) => !e.isBillable);

    // Categories for the project, used by both groupings.
    const catIds = new Set<string>();
    for (const e of allEntries) {
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

    const billableEntryRows: EntryRow[] = billableEntries.map((e) => ({
      _id: e._id,
      taskId: e.taskId,
      workCategoryId: e.snapshotCategoryId ?? undefined,
      durationMinutes: e.durationMinutes,
      date: e.date,
    }));
    const nonBillableEntryRows: EntryRow[] = nonBillableEntries.map((e) => ({
      _id: e._id,
      taskId: e.taskId,
      workCategoryId: e.snapshotCategoryId ?? undefined,
      durationMinutes: e.durationMinutes,
      date: e.date,
    }));

    const billableCategoryGroups = groupByCategory(
      billableEntryRows,
      taskMap,
      catMap,
    );
    const nonBillableCategoryGroups = groupByCategory(
      nonBillableEntryRows,
      taskMap,
      catMap,
    );

    // Find any non-void invoice covering this month so the report can show
    // a "Billed via INV-X" pointer. `invoiceCoversMonth` handles both
    // monthly (single-month period) and rollover (cycle-spanning period)
    // invoices uniformly — see `convex/lib/invoiceAnchor.ts`.
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const linkedInvoice =
      projectInvoices.find(
        (inv) =>
          inv.status !== "void" &&
          invoiceCoversMonth(inv, args.year, args.month),
      ) ?? null;

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
    const usedMinutes = billableEntries.reduce(
      (s, e) => s + e.durationMinutes,
      0,
    );
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

    const currentMonthKey = `${args.year}-${String(args.month).padStart(2, "0")}`;
    const usedMinutesByMonth = new Map<string, number>();
    for (const entry of allTaskEntries) {
      if (!entry.isBillable) continue;
      const key = entry.date.slice(0, 7);
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
          availableMinutes: usageRows.reduce((sum, row) => sum + row.availableMinutes, 0),
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
