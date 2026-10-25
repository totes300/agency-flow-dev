/**
 * Close-model read views (docs/prd-billing-refactor.md §10): the Billing →
 * Close queue, the sidebar badge and the Close workspace, built on
 * `lib/billing/periodView`. Admin-only. The response types below are the
 * UI's contract (imported by `components/billing/*`).
 *
 *   - The queue has ONE row per project — its committable period — with the
 *     number of periods waiting behind it (`pendingPeriods`); there are no
 *     blocked rows.
 *   - Fixed-fee projects have no periods (D5) and never appear here.
 *   - A drafted period shows its frozen snapshot plus the draft link.
 */

import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertAdmin, requireAdmin, type AuthContext } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { computeCloseFlags, type CloseFlag, type RunningTimerInfo } from "./lib/closeFlags";
import { compareCloseRows } from "./lib/closeGroups";
import { groupQueueByMonth, summarizeQueueScope } from "./lib/closeQueue";
import { isClosableProject, loadCloseContext, toScopeProject, type CloseContext } from "./lib/billing/closeData";
import { monthLabel, periodSubjectLabel } from "./lib/billing/labels";
import { fromMinor, priceMinutesMinor, toMinor } from "./lib/billing/money";
import { nextPeriod, periodOfDate } from "./lib/billing/periods";
import { buildPeriodView, type PeriodMember, type PeriodView } from "./lib/billing/periodView";
import { committablePeriod, effectivePeriod, skippedOutOf } from "./lib/billing/scope";
import { loadActiveTimers, type ActiveTimer } from "./lib/billing/timers";
import type { MonthlyBalanceRow } from "./lib/billing/pricing";
import type { CarriedReason } from "./lib/billing/scope";
import type { EntryCloseSnapshot } from "./lib/types";
import {
  buildProjectBillingPeriods,
  type PeriodInvoice,
  type PeriodRow,
  type ProjectBillingPeriods,
} from "./lib/billing/projectPeriods";
import {
  periodPrimaryAction,
  periodUndoActions,
  type PeriodState,
  type PrimaryAction,
  type UndoAction,
} from "./lib/billing/periodState";

// ─── Response types ──────────────────────────────────────────────────────────

/** Workspace issues: a pricing issue, or an earlier period still open. */
export type WorkspaceIssue = "not-earliest-open" | "missing-overage-rate";

/**
 * One flat ledger row, structurally compatible with the project Time tab's
 * row (`components/projects/project-time-table.tsx`) so the Close workspace
 * renders through the same shared table. Close review state (carried /
 * skipped) rides along; grouping happens client-side via `lib/closeGroups`.
 */
export type CloseWorkspaceRow = EntryCloseSnapshot & {
  _id: Id<"timeEntries">;
  taskId: Id<"tasks">;
  taskTitle: string;
  userId: Id<"users">;
  userName: string;
  userImageUrl: string | undefined;
  date: string;
  /** Wall-clock start (epoch ms) — the edit modal re-anchors date changes to it. */
  startedAt: number;
  durationMinutes: number;
  note: string | undefined;
  isBillable: boolean;
  billableRate: number;
  workCategoryId: Id<"workCategories"> | undefined;
  workCategoryName: string | undefined;
  workCategoryColor: string | undefined;
  /** The close's invoice, for a committed period. */
  invoiceId: Id<"invoices"> | undefined;
  invoicePrefix: string | undefined;
  invoiceNumber: number | undefined;
  invoiceStatus: "draft" | "invoiced" | "paid" | "void" | undefined;
  invoiceDueDate: string | undefined;
  /**
   * Server-computed per-row amount (T&M only). The UI renders THIS and never
   * recomputes from rate × duration; totals always come from `pricing`.
   */
  amount: number | null;
  carried: boolean;
  carriedReason?: CarriedReason;
  /** "carried · <month>" label source — origin month key (YYYY-MM). */
  originMonthKey: string;
  originMonthLabel: string;
  /** True when this entry was skipped OUT of this period (renders collapsed, not counted). */
  skipped: boolean;
  /** For skipped rows — the period label it was deferred to (e.g. "July 2026"). */
  skippedToLabel: string | null;
};

export type CloseWorkspaceData = {
  project: {
    id: Id<"projects">;
    name: string;
    code: string;
    billingType: "fixed" | "retainer" | "t_and_m";
    rolloverEnabled: boolean;
    cycleLength: number | null;
    overageRate: number | null;
    includedMinutesPerMonth: number | null;
    monthlyFee: number | null;
    fixedPrice: number | null;
    /** Feeds the add/edit entry modal's assignee scoping. */
    teamMembers: Id<"users">[];
  };
  client: { id: Id<"clients">; name: string };
  currency: string;
  period: { start: string; end: string; label: string };
  /** Label of the period a skip lands in ("Skip → <next>"). null once closed. */
  nextPeriodLabel: string | null;
  billingType: "fixed" | "retainer" | "t_and_m";
  // Budget summary (raw, unrounded — from `pricing`).
  usageMinutes: number;
  includedMinutes: number;
  balanceMinutes: number;
  /** Billable minutes carried into this period — the ladder's opening row. */
  carriedInMinutes: number;
  /** Retainer balance ladder (one row per period month); [] for T&M. */
  monthlyBalances: MonthlyBalanceRow[];
  /** Balance over the months that have started — the honest mid-cycle number. */
  balanceToDateMinutes: number;
  /** period.end < today — picks "Ending balance" vs "Balance to date" copy. */
  periodElapsed: boolean;
  overageMinutes: number;
  overageRate: number | null;
  overageAmount: number;
  amount: number;
  withinBudget: boolean;
  committable: boolean;
  /** The period has a live close: the ledger is its frozen snapshot. */
  isClosed: boolean;
  /** The live close's invoice while it is still a draft ("Open draft" banner). */
  coveringDraft: { id: Id<"invoices">; prefix: string; number: number | null } | null;
  issues: WorkspaceIssue[];
  totalLoggedMinutes: number;
  /** Org timezone — client-side date-axis grouping must bucket with it. */
  timezone: string;
  /** Flat ledger rows in canonical display order (`compareCloseRows`). */
  entries: CloseWorkspaceRow[];
  /** Review flags from the pure `closeFlags` module (ordered blocking→warning→info). */
  flags: CloseFlag[];
  /**
   * The period as the project page sees it (docs/prd-project-billing-redesign.md
   * §10): state chip, blocker, undo items, invoice and documents. Null for a
   * period the project's rows do not list (an empty ended T&M month).
   */
  periodRow: PeriodRow | null;
};

/** One project's committable period in the Billing → Close tab. */
export type CloseQueueRow = {
  /** Stable key (project + period). */
  key: string;
  projectId: Id<"projects">;
  projectName: string;
  clientId: Id<"clients">;
  clientName: string;
  billingType: Doc<"projects">["billingType"];
  /** Workspace URL period token: "YYYY-MM". */
  periodToken: string;
  /** Display label: "June 2026" / "Apr–Jun 2026". */
  periodLabel: string;
  /** Calendar month this row groups under (YYYY-MM); a cycle uses its closing month. */
  monthKey: string;
  /** Display amount; `amountMinor` is what totals sum. */
  amount: number;
  amountMinor: number;
  currency: string;
  badgeKind: "within-budget" | "over-budget" | null;
  /** Within-budget close ("Close & report") vs a Generate row. */
  isCloseRow: boolean;
  overageHours: number | null;
  /** Billable minutes counted for money — the row's colored hours. */
  loggedMinutes: number;
  includedMinutes: number;
  entryCount: number;
  flagCount: number;
  /** Over-budget retainer with no overage rate — routes to Set rate, not Review. */
  configIssue: "missing-overage-rate" | null;
  /** Elapsed periods of this project waiting behind this one. */
  pendingPeriods: number;
};

export type CloseQueueMonth = {
  monthKey: string;
  label: string;
  rows: CloseQueueRow[];
  openCount: number;
  closedCount: number;
  totalCount: number;
  totalsByCurrency: Record<string, number>;
};

export type CloseQueueData = {
  months: CloseQueueMonth[];
  /** Total open rows — equals the sidebar badge's generate+close count. */
  actionableCount: number;
};

// ─── Shared ──────────────────────────────────────────────────────────────────

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
export function flagsFor(view: PeriodView, runningTimers: RunningTimerInfo[]): CloseFlag[] {
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

export function timersIn(
  timers: ActiveTimer[],
  taskIds: Set<string>,
  period: { start: string; end: string },
): RunningTimerInfo[] {
  return timers
    .filter((t) => taskIds.has(t.taskIdStr) && t.dateStr >= period.start && t.dateStr <= period.end)
    .map((t) => ({ userId: t.userId }));
}

export async function projectTaskIds(ctx: QueryCtx, orgId: string, projectId: Id<"projects">) {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .collect();
  return new Map(tasks.map((t) => [t._id.toString(), t.title]));
}

// ─── Queue ───────────────────────────────────────────────────────────────────

async function buildQueue(ctx: QueryCtx, orgId: string): Promise<CloseQueueData> {
  const settings = await viewSettings(ctx, orgId);
  const timers = await loadActiveTimers(ctx, orgId, settings.timezone);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  const rows: CloseQueueRow[] = [];
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
      amountMinor: view.price.amountMinor,
      currency: c.currency,
      badgeKind: isRetainer ? (view.price.withinBudget ? "within-budget" : "over-budget") : null,
      isCloseRow: isRetainer && view.price.withinBudget,
      overageHours: view.price.overageMinutes > 0 ? view.price.overageMinutes / 60 : null,
      loggedMinutes: summary.loggedMinutes,
      includedMinutes: view.price.includedMinutes,
      entryCount: summary.entryCount,
      flagCount: summary.flagCount,
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

/**
 * One row per project's committable period — the pre-redesign queue. No UI
 * reads it any more (the hub is `getNeedsAction`, which also backs the MCP
 * `close_queue` report); it stays internal as the N11 consistency fixture of
 * the billing suites.
 */
export const getCloseQueue = internalQuery({
  args: {},
  handler: async (ctx): Promise<CloseQueueData> => await getCloseQueueForAuth(ctx, await requireAdmin(ctx)),
});

/**
 * `getCloseQueue` for an already-built auth context (the internal fixture). Admin-only.
 */
export async function getCloseQueueForAuth(ctx: QueryCtx, auth: AuthContext): Promise<CloseQueueData> {
  assertAdmin(auth);
  return buildQueue(ctx, auth.orgId);
}

// ─── Project periods ─────────────────────────────────────────────────────────

/**
 * The project page's billing read model (docs/prd-project-billing-redesign.md
 * §6.1): every period with its server-derived state, action and undo, the
 * tab counts and totals. Fixed fee carries `fixed`; non-billable has no periods.
 */
export const getProjectBillingPeriods = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<ProjectBillingPeriods | null> => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;
    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) return null;
    const settings = await viewSettings(ctx, orgId);
    return buildProjectBillingPeriods(ctx, orgId, project, client.currency, settings);
  },
});

// ─── Needs action (hub + badge) ──────────────────────────────────────────────

/** Hub groups in month-end order (§6.2). Past due is listed, never counted. */
export const NEEDS_ACTION_GROUPS = ["needs_rate", "ready_to_invoice", "ready_to_close", "draft", "past_due"] as const;
export type NeedsActionGroup = (typeof NEEDS_ACTION_GROUPS)[number];

/** One Billing hub row: a needs-action period, or a fixed-fee invoice (draft / past due). */
export type NeedsActionRow = {
  key: string;
  group: NeedsActionGroup;
  projectId: Id<"projects">;
  projectName: string;
  clientId: Id<"clients">;
  clientName: string;
  billingType: Doc<"projects">["billingType"];
  currency: string;
  /** The period; null on a fixed-fee invoice row. */
  period: PeriodRow | null;
  invoice: PeriodInvoice | null;
  /** The invoice total when there is an invoice, else the period's price. */
  amountMinor: number;
  action: PrimaryAction | null;
  undo: UndoAction[];
};

type MoneyByCurrency = Record<string, number>;

export type NeedsActionData = {
  rows: NeedsActionRow[];
  /** §5.5 — every needs-action period (blocked ones too) plus fixed drafts. */
  needsActionCount: number;
  pastDueCount: number;
  /** "October 2026 · month-end in N days". */
  today: string;
  tiles: {
    unbilled: { minorByCurrency: MoneyByCurrency; readyCount: number; draftCount: number };
    outstanding: { minorByCurrency: MoneyByCurrency; pastDueCount: number; invoicedCount: number };
    paidThisMonth: { minorByCurrency: MoneyByCurrency; count: number };
    monthsToClose: { count: number; waitingCount: number };
  };
};

const addMoney = (m: MoneyByCurrency, currency: string, minor: number) => {
  m[currency] = (m[currency] ?? 0) + minor;
};

/**
 * One pass over the org's non-archived billable projects, through the same
 * builder as the project page — the hub list, its tiles and the sidebar badge
 * all come from here (A6, A16).
 */
async function buildNeedsAction(ctx: QueryCtx, orgId: string): Promise<NeedsActionData> {
  const settings = await viewSettings(ctx, orgId);
  const thisMonth = settings.todayStr.slice(0, 7);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const clients = new Map<Id<"clients">, Doc<"clients"> | null>();

  const rows: NeedsActionRow[] = [];
  let needsActionCount = 0;
  let pastDueCount = 0;
  const tiles: NeedsActionData["tiles"] = {
    unbilled: { minorByCurrency: {}, readyCount: 0, draftCount: 0 },
    outstanding: { minorByCurrency: {}, pastDueCount: 0, invoicedCount: 0 },
    paidThisMonth: { minorByCurrency: {}, count: 0 },
    monthsToClose: { count: 0, waitingCount: 0 },
  };

  for (const project of projects) {
    if (project.archivedAt || project.billingType === "non_billable") continue;
    if (!clients.has(project.clientId)) {
      const c = await ctx.db.get(project.clientId);
      clients.set(project.clientId, c && c.orgId === orgId ? c : null);
    }
    const client = clients.get(project.clientId);
    if (!client) continue;
    const model = await buildProjectBillingPeriods(ctx, orgId, project, client.currency, settings);
    needsActionCount += model.needsActionCount;
    pastDueCount += model.pastDueCount;
    const base = {
      projectId: project._id,
      projectName: project.name,
      clientId: client._id,
      clientName: client.name,
      billingType: project.billingType,
      currency: model.currency,
    };

    for (const period of model.periods) {
      const group = groupOf(period.state);
      if (!group) continue;
      rows.push({
        ...base,
        key: `${project._id}:${period.key}`,
        group,
        period,
        invoice: period.invoice,
        amountMinor: period.invoice?.totalMinor ?? period.amountMinor,
        action: period.action,
        undo: period.undo,
      });
      if (period.state === "ready_to_invoice") {
        tiles.unbilled.readyCount += 1;
        addMoney(tiles.unbilled.minorByCurrency, model.currency, period.amountMinor);
      }
      if (period.state === "ready_to_close") {
        tiles.monthsToClose.count += 1;
        if (period.blockedBy) tiles.monthsToClose.waitingCount += 1;
      }
    }

    // Fixed fee has no periods: its drafts and past-due invoices are rows of their own.
    if (project.billingType === "fixed") {
      for (const inv of model.invoices) {
        if (inv.status !== "draft" && inv.status !== "past_due") continue;
        const state: PeriodState = inv.status;
        rows.push({
          ...base,
          key: `${project._id}:${inv.id}`,
          group: inv.status,
          period: null,
          invoice: inv,
          amountMinor: inv.totalMinor,
          action: periodPrimaryAction(state, { isCommittable: false }),
          undo: periodUndoActions(state, { draftNumbered: inv.number !== null }),
        });
      }
    }

    for (const inv of model.invoices) {
      if (inv.status === "draft") {
        tiles.unbilled.draftCount += 1;
        addMoney(tiles.unbilled.minorByCurrency, model.currency, inv.totalMinor);
      } else if (inv.status === "invoiced" || inv.status === "past_due") {
        if (inv.status === "past_due") tiles.outstanding.pastDueCount += 1;
        else tiles.outstanding.invoicedCount += 1;
        addMoney(tiles.outstanding.minorByCurrency, model.currency, inv.totalMinor);
      } else if (
        inv.status === "paid" &&
        inv.paidAt !== null &&
        getDateInTimezone(inv.paidAt, settings.timezone).slice(0, 7) === thisMonth
      ) {
        tiles.paidThisMonth.count += 1;
        addMoney(tiles.paidThisMonth.minorByCurrency, model.currency, inv.totalMinor);
      }
    }
  }

  const order = (g: NeedsActionGroup) => NEEDS_ACTION_GROUPS.indexOf(g);
  rows.sort(
    (a, b) =>
      order(a.group) - order(b.group) ||
      (a.period?.start ?? a.invoice?.issueDate ?? "").localeCompare(b.period?.start ?? b.invoice?.issueDate ?? "") ||
      a.projectName.localeCompare(b.projectName),
  );
  return { rows, needsActionCount, pastDueCount, today: settings.todayStr, tiles };
}

function groupOf(state: PeriodState): NeedsActionGroup | null {
  switch (state) {
    case "needs_rate":
    case "ready_to_invoice":
    case "ready_to_close":
    case "draft":
    case "past_due":
      return state;
    default:
      return null;
  }
}

/** Billing hub → Needs action: one row per period that needs action, plus the tiles. */
export const getNeedsAction = query({
  args: {},
  handler: async (ctx): Promise<NeedsActionData> => await getNeedsActionForAuth(ctx, await requireAdmin(ctx)),
});

/** `getNeedsAction` for an already-built auth context (the MCP `close_queue` report, docs/prd-mcp.md). Admin-only. */
export async function getNeedsActionForAuth(ctx: QueryCtx, auth: AuthContext): Promise<NeedsActionData> {
  assertAdmin(auth);
  return buildNeedsAction(ctx, auth.orgId);
}

/** Sidebar badge (§5.5): needs-action periods and past-due invoices, one pass. */
export const getNavSignals = query({
  args: {},
  handler: async (ctx): Promise<{ needsActionCount: number; pastDueCount: number }> => {
    const { orgId } = await requireAdmin(ctx);
    const { needsActionCount, pastDueCount } = await buildNeedsAction(ctx, orgId);
    return { needsActionCount, pastDueCount };
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
    const model = await buildProjectBillingPeriods(ctx, orgId, project, c.currency, settings);
    const periodRow = model.periods.find((p) => p.start === view.period.start) ?? null;
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
      isClosed: closed,
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
      periodRow,
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
  const close = view.liveClose;
  const closeSnapshot: EntryCloseSnapshot = close
    ? {
        closeStatus: close.status === "draft" ? "draft" : "final",
        closeKind: close.kind,
        closePeriodStart: close.periodStart,
        closePeriodEnd: close.periodEnd,
        closedAt: close.committedAt,
      }
    : {};

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
      ...closeSnapshot,
      // Per-row display amount only — totals always come from `pricing`.
      amount:
        isTm && m.isBillable
          ? fromMinor(priceMinutesMinor(m.minutes, toMinor(doc.billableRate, c.currency)), c.currency)
          : null,
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
