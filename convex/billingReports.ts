/**
 * Monthly report on the close model (docs/prd-billing-refactor.md N8).
 *
 * Membership and money come from `lib/billing/periodView`:
 *   - a month inside a live close reads the close's frozen snapshot — a
 *     delivered report can never change, whatever is logged later;
 *   - any other month reads the scope rule live — what the next close will
 *     commit, nothing more.
 * Every entry is reported in the month its close buckets it into (carried-in
 * work in the receiving period's first month), so it appears on exactly one
 * client document, and the amount due is the close's price — the same number
 * the queue promised and the invoice bills (N11).
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { classifyReportPeriod } from "./lib/reportPeriod";
import { loadCloseContext } from "./lib/billing/closeData";
import { monthLabel, periodSubjectLabel } from "./lib/billing/labels";
import { fromMinor, round2 } from "./lib/billing/money";
import { absMonthOf, monthBucket, monthKeyOf, monthPeriodOf } from "./lib/billing/periods";
import { monthBalances, type PeriodMember } from "./lib/billing/periodView";
import { usageRows, usageTotal } from "./lib/billing/usageBlock";
import { groupByCategory, type EntryRow } from "./lib/billing/reportGroups";

export const getMonthlyReport = query({
  args: { projectId: v.id("projects"), year: v.number(), month: v.number() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    if (!Number.isInteger(args.year) || args.year < 2000) return null;
    if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12) return null;

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId || project.billingType !== "retainer") return null;
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    const periodKind = classifyReportPeriod(args.year, args.month, todayStr);
    if (periodKind === "future") return null;
    const inProgress = periodKind === "current";

    const monthKey = `${args.year}-${String(args.month).padStart(2, "0")}`;
    const monthStart = `${monthKey}-01`;
    const c = await loadCloseContext(ctx, orgId, project._id);
    const balance = (
      await monthBalances(ctx, c, [monthKey], {
        todayStr,
        roundingMinutes: orgSettings?.roundingMinutes ?? 1,
      })
    ).get(monthKey);
    // A cycle month before the retainer's first cycle has nothing to report.
    if (!balance) return null;
    const { view, row } = balance;
    const { period, liveClose, price } = view;
    const monthEnd = monthPeriodOf(monthStart).end;

    // Members by report month (the close's bucket rule, §8.3).
    const bucketOf = (m: PeriodMember) => m.monthKey ?? monthBucket(m.entry.date, period);
    const monthMembers = view.members.filter((m) => bucketOf(m) === monthKey);

    // Groupings — in-period vs carried-in (dated before this month).
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", project._id))
      .collect();
    const taskMap = new Map<string, Doc<"tasks">>(tasks.map((t) => [t._id, t]));
    const catMap = new Map<string, { name: string; color: string }>();
    for (const m of monthMembers) {
      const cid = m.entry.categoryId;
      if (!cid || catMap.has(cid)) continue;
      const cat = await ctx.db.get(cid as Id<"workCategories">);
      if (cat && cat.orgId === orgId) catMap.set(cid, { name: cat.name, color: cat.color });
    }
    const toRow = (m: PeriodMember): EntryRow => ({
      _id: m.entry._id,
      taskId: m.entry.taskId as Id<"tasks">,
      workCategoryId: (m.entry.categoryId ?? undefined) as Id<"workCategories"> | undefined,
      durationMinutes: m.entry.minutes,
      date: m.entry.date,
    });
    const inPeriod = monthMembers.filter((m) => m.entry.date >= monthStart);
    const carriedIn = monthMembers.filter((m) => m.entry.date < monthStart);
    const carriedByMonth = new Map<string, PeriodMember[]>();
    for (const m of carriedIn) {
      const k = monthKeyOf(m.entry.date);
      carriedByMonth.set(k, [...(carriedByMonth.get(k) ?? []), m]);
    }
    const carriedGroups = [...carriedByMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, members]) => ({
        monthKey: key,
        monthLabel: monthLabel(key),
        totalMinutes: members.reduce((s, m) => s + m.entry.minutes, 0),
        billableCategoryGroups: groupByCategory(
          members.filter((m) => m.entry.isBillable).map(toRow),
          taskMap,
          catMap,
        ),
        nonBillableCategoryGroups: groupByCategory(
          members.filter((m) => !m.entry.isBillable).map(toRow),
          taskMap,
          catMap,
        ),
      }));

    // Budget numbers: frozen by the close when there is one. The balance is
    // this month's ladder row; the usage block shows the ladder up to it.
    const overageRate = liveClose
      ? fromMinor(liveClose.overageRateMinor, c.currency)
      : project.overageRate ?? 0;
    const ladder = price.monthlyBalances;
    const periodMonthCount = ladder.length;
    const isCycle = periodMonthCount > 1;
    const position = ladder.indexOf(row); // 0-based
    const shownRows = ladder.slice(0, position + 1);
    // The amount due is the close's price, shown once the whole period is in.
    const usageClosed = !inProgress && row.isLast;
    const amountDue = usageClosed ? fromMinor(price.amountMinor, c.currency) : 0;
    const paymentOverageMinutes = usageClosed ? price.overageMinutes : 0;

    const cycleToDate = isCycle
      ? {
          cycleStart: period.start,
          cycleEnd: period.end,
          cycleLabel: periodSubjectLabel(period.start, period.end),
          cycleNumber:
            project.startDate !== undefined
              ? Math.floor((absMonthOf(period.start) - absMonthOf(project.startDate)) / periodMonthCount) + 1
              : 1,
          positionInCycle: position + 1,
          includedMinutes: price.includedMinutes,
          usedMinutes: row.usedToDateMinutes,
          balanceMinutes: row.remainingMinutes,
        }
      : null;

    const linkedInvoice = liveClose?.invoiceId ? await ctx.db.get(liveClose.invoiceId) : null;
    const client = c.client;

    return {
      inProgress,
      isFinal: !inProgress && liveClose?.status === "final",
      /** The live close covering the month — what its worksheet exports. */
      closeId: liveClose?._id ?? null,
      period: {
        year: args.year,
        month: args.month,
        start: monthStart,
        end: monthEnd,
        label: monthLabel(monthKey),
      },
      balance: {
        startBalanceMinutes: row.startBalanceMinutes,
        includedMinutes: row.includedMinutes,
        usedMinutes: row.usedMinutes,
        endBalanceMinutes: row.balanceMinutes,
        overageMinutes: row.overageMinutes,
        overageHours: round2(row.overageMinutes / 60),
      },
      cycleToDate,
      billing: {
        monthlyFee: project.monthlyFee ?? 0,
        overageRate,
        overageAmount: amountDue,
        currency: client.currency,
      },
      retainerUsage: {
        kind: isCycle ? ("cycle" as const) : ("month" as const),
        closed: usageClosed,
        monthlyIncludedMinutes: row.includedMinutes,
        rows: usageRows(shownRows),
        total: {
          ...usageTotal(shownRows),
          overageMinutes: paymentOverageMinutes,
          amountDue,
        },
      },
      project: {
        id: project._id,
        name: project.name,
        rolloverEnabled: project.rolloverEnabled ?? false,
        cycleLength: project.cycleLength ?? 1,
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
      billableCategoryGroups: groupByCategory(
        inPeriod.filter((m) => m.entry.isBillable).map(toRow),
        taskMap,
        catMap,
      ),
      nonBillableCategoryGroups: groupByCategory(
        inPeriod.filter((m) => !m.entry.isBillable).map(toRow),
        taskMap,
        catMap,
      ),
      carriedGroups,
      linkedInvoice:
        linkedInvoice && linkedInvoice.orgId === orgId && linkedInvoice.status !== "void"
          ? {
              id: linkedInvoice._id,
              number: linkedInvoice.number,
              prefix: linkedInvoice.prefix,
              status: linkedInvoice.status,
            }
          : null,
      timezone,
    };
  },
});
