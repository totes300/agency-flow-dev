/**
 * Close-model read views (docs/prd-billing-refactor.md slice 3b): the Billing
 * → Close queue, the sidebar badge and the Close workspace, built on
 * `lib/billing/periodView`. Response shapes match the legacy `close.ts`
 * queries so the cutover (3c) is a reference swap in the UI. Admin-only.
 *
 * Differences from the legacy views, by design:
 *   - The queue has ONE row per project — its committable period — with the
 *     number of periods waiting behind it (`pendingPeriods`), instead of
 *     rendering blocked rows (PRD §10).
 *   - Fixed-fee projects have no periods (D5) and never appear here.
 *   - A drafted period shows its frozen snapshot plus the draft link, not an
 *     empty ledger.
 */

import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { computeCloseFlags, type CloseFlag, type RunningTimerInfo } from "./lib/closeFlags";
import { compareCloseRows } from "./lib/closeGroups";
import { groupQueueByMonth, summarizeQueueScope } from "./lib/closeQueue";
import { isClosableProject, loadCloseContext, toScopeProject, type CloseContext } from "./lib/billing/closeData";
import { monthLabel, periodSubjectLabel } from "./lib/billing/labels";
import { fromMinor, round2 } from "./lib/billing/money";
import { nextPeriod, periodOfDate } from "./lib/billing/periods";
import { buildPeriodView, type PeriodMember, type PeriodView } from "./lib/billing/periodView";
import { committablePeriod, effectivePeriod, skippedOutOf } from "./lib/billing/scope";
import { loadActiveTimers, type ActiveTimer } from "./lib/billing/timers";
import type {
  CloseQueueData,
  CloseQueueMonth,
  CloseQueueRow,
  CloseWorkspaceData,
  CloseWorkspaceRow,
} from "./close";

type ViewSettings = { timezone: string; todayStr: string; roundingMinutes: number };

async function viewSettings(ctx: QueryCtx, orgId: string): Promise<ViewSettings> {
  const s = await getOrgSettings(ctx, orgId);
  const timezone = s?.timezone ?? ORG_TIMEZONE_FALLBACK;
  return {
    timezone,
    todayStr: getDateInTimezone(Date.now(), timezone),
    roundingMinutes: s?.roundingMinutes ?? 1,
  };
}

/** Review flags of an OPEN period (a closed ledger has nothing left to review). */
function flagsFor(view: PeriodView, runningTimers: RunningTimerInfo[]): CloseFlag[] {
  if (view.liveClose) return [];
  return computeCloseFlags({
    scope: {
      issues: view.price.issues,
      entries: view.members.map((m) => ({
        entryId: m.entry._id,
        note: m.doc?.note,
        durationMinutes: m.entry.minutes,
        carried: m.carried !== undefined,
        carriedReason: m.carried,
        originMonthKey: m.entry.date.slice(0, 7),
      })),
    },
    runningTimers,
  });
}

function timersIn(
  timers: ActiveTimer[],
  taskIds: Set<string>,
  period: { start: string; end: string },
): RunningTimerInfo[] {
  return timers
    .filter((t) => taskIds.has(t.taskIdStr) && t.dateStr >= period.start && t.dateStr <= period.end)
    .map((t) => ({ userId: t.userId }));
}

async function projectTaskIds(ctx: QueryCtx, orgId: string, projectId: Id<"projects">) {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .collect();
  return new Map(tasks.map((t) => [t._id.toString(), t.title]));
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export type CloseQueueRowV2 = CloseQueueRow & {
  /** Elapsed periods of this project waiting behind this one. */
  pendingPeriods: number;
};

export type CloseQueueDataV2 = Omit<CloseQueueData, "months"> & {
  months: (Omit<CloseQueueMonth, "rows"> & { rows: CloseQueueRowV2[] })[];
};

async function buildQueue(ctx: QueryCtx, orgId: string): Promise<CloseQueueDataV2> {
  const settings = await viewSettings(ctx, orgId);
  const timers = await loadActiveTimers(ctx, orgId, settings.timezone);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  const rows: CloseQueueRowV2[] = [];
  const committedByMonth = new Map<string, number>();
  for (const project of projects) {
    if (project.archivedAt || !isClosableProject(project)) continue;
    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) continue;
    const c = await loadCloseContext(ctx, orgId, project._id);
    for (const close of c.liveCloses) {
      const key = close.periodEnd.slice(0, 7);
      committedByMonth.set(key, (committedByMonth.get(key) ?? 0) + 1);
    }
    const { period } = committablePeriod({
      project: toScopeProject(c.project),
      entries: c.entries,
      liveCloses: c.livePeriods,
      todayStr: settings.todayStr,
    });
    if (!period) continue;
    const view = await buildPeriodView(ctx, c, period, settings);
    const taskIds = new Set((await projectTaskIds(ctx, orgId, project._id)).keys());
    const flags = flagsFor(view, timersIn(timers, taskIds, period));
    const summary = summarizeQueueScope(
      { entries: view.members, usageMinutes: view.price.usageMinutes },
      flags,
    );
    const isRetainer = project.billingType === "retainer";
    rows.push({
      key: `close:${project._id}:${period.start}`,
      projectId: project._id,
      projectName: project.name,
      clientId: client._id,
      clientName: client.name,
      billingType: project.billingType,
      periodToken: period.start.slice(0, 7),
      periodLabel: periodSubjectLabel(period.start, period.end),
      monthKey: period.end.slice(0, 7),
      amount: fromMinor(view.price.amountMinor, c.currency),
      currency: c.currency,
      badgeKind: isRetainer ? (view.price.withinBudget ? "within-budget" : "over-budget") : null,
      isCloseRow: isRetainer && view.price.withinBudget,
      overageHours: view.price.overageMinutes > 0 ? view.price.overageMinutes / 60 : null,
      loggedMinutes: summary.loggedMinutes,
      includedMinutes: view.price.includedMinutes,
      entryCount: summary.entryCount,
      flagCount: summary.flagCount,
      committable: true,
      disabledReason: null,
      configIssue: view.price.issues.includes("missing-overage-rate") ? "missing-overage-rate" : null,
      pendingPeriods: view.pendingAfter,
    });
  }

  const months = groupQueueByMonth(rows, committedByMonth).map((g) => ({
    monthKey: g.monthKey,
    label: monthLabel(g.monthKey),
    rows: g.rows,
    openCount: g.openCount,
    closedCount: g.closedCount,
    totalCount: g.totalCount,
    totalsByCurrency: g.totalsByCurrency,
  }));
  return { months, actionableCount: rows.length };
}

/** Billing → Close: one row per project that has a period due. */
export const getCloseQueue = query({
  args: {},
  handler: async (ctx): Promise<CloseQueueDataV2> => {
    const { orgId } = await requireAdmin(ctx);
    return buildQueue(ctx, orgId);
  },
});

/** Sidebar badge — same shape as `invoices.getInvoicingNavSignals`, counted from the queue. */
export const getNavSignals = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);
    const { todayStr } = await viewSettings(ctx, orgId);
    const invoiced = await ctx.db
      .query("invoices")
      .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", "invoiced"))
      .collect();
    const overdueCount = invoiced.filter((inv) => inv.dueDate != null && inv.dueDate < todayStr).length;
    const rows = (await buildQueue(ctx, orgId)).months.flatMap((m) => m.rows);
    const toCloseCount = rows.filter((r) => r.isCloseRow).length;
    return { toGenerateCount: rows.length - toCloseCount, toCloseCount, overdueCount };
  },
});

// ─── Workspace ───────────────────────────────────────────────────────────────

/** The Close workspace for one project period ("YYYY-MM", snapped to the grid). */
export const getCloseWorkspace = query({
  args: { projectId: v.id("projects"), period: v.string() },
  handler: async (ctx, args): Promise<CloseWorkspaceData | null> => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId || !isClosableProject(project)) return null;
    const m = args.period.match(/^(\d{4})-(\d{2})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;

    const settings = await viewSettings(ctx, orgId);
    const c = await loadCloseContext(ctx, orgId, project._id);
    const period = periodOfDate(toScopeProject(c.project), `${args.period}-01`);
    const view = await buildPeriodView(ctx, c, period, settings);
    const taskName = await projectTaskIds(ctx, orgId, project._id);
    const timers = await loadActiveTimers(ctx, orgId, settings.timezone);
    const flags = flagsFor(view, timersIn(timers, new Set(taskName.keys()), view.period));

    const rows = await workspaceRows(ctx, orgId, c, view, taskName);
    const closed = view.liveClose !== null;
    const draftInvoice =
      view.liveClose?.status === "draft" && view.liveClose.invoiceId
        ? await ctx.db.get(view.liveClose.invoiceId)
        : null;
    const earlierOpen = view.committable !== null && view.committable.start < view.period.start;
    const next = nextPeriod(toScopeProject(c.project), view.period);
    const price = view.price;

    return {
      project: {
        id: project._id,
        name: project.name,
        code: project.code,
        billingType: project.billingType,
        rolloverEnabled: project.rolloverEnabled ?? false,
        cycleLength: project.cycleLength ?? null,
        overageRate: project.overageRate ?? null,
        includedMinutesPerMonth: project.includedMinutesPerMonth ?? null,
        monthlyFee: project.monthlyFee ?? null,
        fixedPrice: project.fixedPrice ?? null,
        teamMembers: project.teamMembers ?? [],
      },
      client: { id: c.client._id, name: c.client.name },
      currency: c.currency,
      period: {
        start: view.period.start,
        end: view.period.end,
        label: periodSubjectLabel(view.period.start, view.period.end),
        isCalendar: true,
      },
      nextPeriodLabel: closed ? null : periodSubjectLabel(next.start, next.end),
      billingType: project.billingType,
      usageMinutes: price.usageMinutes,
      includedMinutes: price.includedMinutes,
      balanceMinutes: price.includedMinutes - price.usageMinutes,
      carriedInMinutes: price.carriedInMinutes,
      monthlyBalances: price.monthlyBalances,
      balanceToDateMinutes: price.balanceToDateMinutes,
      periodElapsed: view.period.end < settings.todayStr,
      overageMinutes: price.overageMinutes,
      overageRate: project.overageRate ?? null,
      overageAmount: fromMinor(price.overage?.amountMinor ?? 0, c.currency),
      amount: fromMinor(price.amountMinor, c.currency),
      withinBudget: price.withinBudget,
      committable: !closed && view.committable?.start === view.period.start,
      fromSettlementStamps: closed,
      coveringDraft: draftInvoice
        ? { id: draftInvoice._id, prefix: draftInvoice.prefix, number: draftInvoice.number ?? null }
        : null,
      issues: [
        ...(earlierOpen && !closed ? (["not-earliest-open"] as const) : []),
        ...(closed ? [] : price.issues),
      ],
      totalLoggedMinutes: view.members.reduce((sum, m) => sum + m.entry.minutes, 0),
      timezone: settings.timezone,
      entries: rows,
      flags,
    };
  },
});

/** Ledger rows: the period's members, plus (open periods) entries skipped out of it. */
async function workspaceRows(
  ctx: QueryCtx,
  orgId: string,
  c: CloseContext,
  view: PeriodView,
  taskName: Map<string, string>,
): Promise<CloseWorkspaceRow[]> {
  const users = new Map<string, { name: string; imageUrl: string | undefined }>();
  const categories = new Map<string, Doc<"workCategories"> | null>();
  const invoices = new Map<string, Doc<"invoices"> | null>();
  const isTm = c.project.billingType === "t_and_m";

  async function row(
    doc: Doc<"timeEntries">,
    m: { minutes: number; isBillable: boolean; carried?: PeriodMember["carried"] },
    skippedTo: string | null,
  ): Promise<CloseWorkspaceRow> {
    const userKey = doc.userId.toString();
    if (!users.has(userKey)) {
      const u = await ctx.db.get(doc.userId);
      users.set(userKey, { name: u?.name ?? "Unknown", imageUrl: u?.imageUrl });
    }
    const catKey = doc.snapshotCategoryId?.toString();
    if (catKey && !categories.has(catKey)) {
      const cat = await ctx.db.get(doc.snapshotCategoryId!);
      categories.set(catKey, cat && cat.orgId === orgId ? cat : null);
    }
    const category = catKey ? categories.get(catKey) ?? null : null;
    const invoiceId = view.liveClose?.invoiceId;
    if (invoiceId && !invoices.has(invoiceId)) {
      const inv = await ctx.db.get(invoiceId);
      invoices.set(invoiceId, inv && inv.orgId === orgId ? inv : null);
    }
    const inv = invoiceId ? invoices.get(invoiceId) ?? null : null;
    const member = users.get(userKey)!;
    const origin = doc.date.slice(0, 7);
    return {
      _id: doc._id,
      taskId: doc.taskId,
      taskTitle: taskName.get(doc.taskId.toString()) ?? "Untitled task",
      userId: doc.userId,
      userName: member.name,
      userImageUrl: member.imageUrl,
      date: doc.date,
      startedAt: doc.startedAt,
      durationMinutes: m.minutes,
      note: doc.note || undefined,
      isBillable: m.isBillable,
      billableRate: doc.billableRate,
      workCategoryId: category?._id,
      workCategoryName: category?.name,
      workCategoryColor: category?.color,
      invoiceId: inv?._id,
      invoicePrefix: inv?.prefix,
      invoiceNumber: inv?.number,
      invoiceStatus: inv?.status,
      invoiceDueDate: inv?.dueDate,
      settledAt: undefined,
      settledReason: undefined,
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      // Per-row display amount only — totals always come from `pricing`.
      amount: isTm && m.isBillable ? round2((m.minutes / 60) * doc.billableRate) : null,
      carried: m.carried !== undefined,
      carriedReason: m.carried,
      originMonthKey: origin,
      originMonthLabel: monthLabel(origin),
      skipped: skippedTo !== null,
      skippedToLabel: skippedTo,
    };
  }

  const rows: CloseWorkspaceRow[] = [];
  for (const m of view.members) {
    if (!m.doc) continue;
    rows.push(await row(m.doc, { minutes: m.entry.minutes, isBillable: m.entry.isBillable, carried: m.carried }, null));
  }
  if (!view.liveClose) {
    const project = toScopeProject(c.project);
    for (const e of skippedOutOf({ project, entries: c.entries, liveCloses: c.livePeriods, period: view.period })) {
      const to = effectivePeriod(project, e, c.livePeriods);
      rows.push(await row(e.doc, { minutes: e.minutes, isBillable: e.isBillable }, periodSubjectLabel(to.start, to.end)));
    }
  }
  return rows.sort(compareCloseRows);
}
