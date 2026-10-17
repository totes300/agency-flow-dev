/**
 * Close workspace query — the server side of the full-page Close workspace
 * (`docs/closing-refactor/02-close-workspace-readonly.md`).
 *
 * Responsibility: fetch the docs for one project + period, compose the pure
 * `billingScope` module server-side (I1–I4), and return an enriched, UI-ready
 * scope report — a flat, pre-sorted ledger of Time-tab-shaped rows with
 * member/category/invoice joins, the budget summary numbers, carried info, and
 * the typed issues. Grouping happens client-side (`convex/lib/closeGroups.ts`)
 * so the workspace can group by any axis; NO date math or money logic lives in
 * the client — every displayed number originates here from `billingScope`.
 *
 * Admin-only (the Billing hub is admin-only, unchanged). Returns `null` for a
 * missing/foreign/non-billable project or a malformed period so the route can
 * 404 without a second round-trip.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import {
  computeBillingScope,
  resolveEntryPeriods,
  getNextPeriod,
  type ScopeEntryInput,
  type ScopeProjectInput,
  type BillingType,
  type CarriedReason,
  type MonthlyBalanceRow,
  type ScopeIssue,
} from "./lib/billingScope";
import {
  computeCloseFlags,
  type CloseFlag,
  type RunningTimerInfo,
} from "./lib/closeFlags";
import { compareCloseRows } from "./lib/closeGroups";
import type { EntrySettlementSnapshot } from "./lib/types";
import {
  checkSkipEligibility,
  skipRejectionMessage,
} from "./lib/skipGuards";
import { toScopeProjectInput, toScopeEntryInput } from "./lib/commitScope";
import { buildCycleRangeLabel, monthName } from "./lib/retainerUsage";
import { enumerateReadyRows } from "./invoices";
import type { ReadyRow } from "./lib/readyToInvoice";
import { getInvoiceAnchorMonthKey } from "./lib/invoiceAnchor";
import { getFixedBilledFinalized } from "./lib/fixedBilling";
import {
  summarizeQueueScope,
  assignDisabledReasons,
  groupQueueByMonth,
} from "./lib/closeQueue";
import { round2 } from "./lib/billing/money";
import { getProjectEntries } from "./lib/projectEntries";

// ─── Output shapes ───────────────────────────────────────────────────────────

/**
 * One flat ledger row, shaped to be structurally compatible with the project
 * Time tab's `TimeEntryRow` (see `components/projects/project-time-table.tsx`)
 * so the Close workspace renders through the same shared table. Close-specific
 * review state (carried / skipped) rides along as extra fields; grouping and
 * group meta happen client-side via `convex/lib/closeGroups.ts`.
 */
export type CloseWorkspaceRow = EntrySettlementSnapshot & {
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
  /** Lock signals — always unset for open-period scope; carried for closed (I4). */
  invoiceId: Id<"invoices"> | undefined;
  invoicePrefix: string | undefined;
  invoiceNumber: number | undefined;
  invoiceStatus: "draft" | "invoiced" | "paid" | "void" | undefined;
  invoiceDueDate: string | undefined;
  /**
   * Server-computed billable amount (T&M only, `round2`-rounded). The UI must
   * render THIS, never recompute from rate × duration — commit derives its
   * totals server-side and the ledger may not disagree with it by a cent.
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
  period: { start: string; end: string; label: string; isCalendar: boolean };
  /** Label of the period a skip lands in ("Skip → <next>"). null for fixed/closed. */
  nextPeriodLabel: string | null;
  billingType: "fixed" | "retainer" | "t_and_m";
  // Budget summary (raw, unrounded — from billingScope).
  usageMinutes: number;
  includedMinutes: number;
  balanceMinutes: number;
  /** Billable minutes carried into this period — the ladder's opening row. */
  carriedInMinutes: number;
  /** Retainer balance ladder (one row per period month); [] for T&M/fixed. */
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
  fromSettlementStamps: boolean;
  /**
   * Set when the period reads as closed ONLY because a DRAFT invoice covers
   * it (F5): draft-locked entries carry `invoiceId`, not settlement stamps,
   * so the stamp-read ledger renders empty. The UI shows an "Open draft"
   * banner instead of a silently blank closed view (reachable via stale
   * deep-links only — the queue filters these periods out).
   */
  coveringDraft: { id: Id<"invoices">; prefix: string; number: number | null } | null;
  issues: ScopeIssue[];
  totalLoggedMinutes: number;
  /** Org timezone — client-side date-axis grouping must bucket with it. */
  timezone: string;
  /** Flat ledger rows in canonical display order (`compareCloseRows`). */
  entries: CloseWorkspaceRow[];
  /** v1 review flags from the pure `closeFlags` module (ordered blocking→warning→info). */
  flags: CloseFlag[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** "June 2026" for a YYYY-MM key. */
function monthKeyLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthName(y, m)} ${y}`;
}

/**
 * Period display label, derived from the actual span (not the rollover flag):
 * a single calendar month → "June 2026"; a multi-month cycle → "Apr–Jun 2026";
 * fixed → "Remaining fee".
 */
function periodLabel(billingType: string, start: string, end: string): string {
  if (billingType === "fixed") return "Remaining fee";
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const months: Array<{ year: number; month: number }> = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push({ year: y, month: m });
    if (m === 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
  }
  if (months.length <= 1) return `${monthName(sy, sm)} ${sy}`;
  return buildCycleRangeLabel(months);
}

/** Every time entry of a project, plus task titles (the queue's timer flag needs the task ids). */
async function loadProjectEntries(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: Id<"projects">,
): Promise<{ entries: Doc<"timeEntries">[]; taskName: Map<string, string> }> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", orgId).eq("projectId", projectId),
    )
    .collect();
  const taskName = new Map<string, string>();
  for (const t of tasks) taskName.set(t._id.toString(), t.title);

  const entries = await getProjectEntries(ctx, orgId, projectId);
  return { entries, taskName };
}

/**
 * Active timers (running / paused) whose task belongs to this project and whose
 * start date falls inside the period — the `running-timer` review flag (PRD
 * story 13). A timer overlaps the period only if the entry it will produce
 * would land in it, so we date-gate on `timerStartedAt`. Warning-only; never a
 * commit blocker (story 28).
 */
async function loadRunningTimers(
  ctx: QueryCtx,
  orgId: string,
  projectTaskIds: Set<string>,
  period: { start: string; end: string },
  timezone: string,
): Promise<RunningTimerInfo[]> {
  const memberships = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  const out: RunningTimerInfo[] = [];
  for (const m of memberships) {
    if (!m.userId) continue;
    const user = await ctx.db.get(m.userId);
    if (!user || user.deletedAt) continue;
    if (user.timerStatus !== "running" && user.timerStatus !== "paused") continue;
    if (!user.timerTaskId || !projectTaskIds.has(user.timerTaskId.toString())) {
      continue;
    }
    if (user.timerStartedAt === undefined) continue;
    const timerDate = getDateInTimezone(user.timerStartedAt, timezone);
    if (timerDate < period.start || timerDate > period.end) continue;
    out.push({ userId: user._id });
  }
  return out;
}

/**
 * All active (running / paused) timers in the org, resolved to {task, date}
 * once. The close queue filters this list per period+project in memory rather
 * than re-scanning `orgMembers` for every row (`loadRunningTimers` is the
 * single-period workspace variant).
 */
type ActiveTimer = { userId: Id<"users">; taskIdStr: string; dateStr: string };
async function loadActiveTimers(
  ctx: QueryCtx,
  orgId: string,
  timezone: string,
): Promise<ActiveTimer[]> {
  const memberships = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const out: ActiveTimer[] = [];
  for (const m of memberships) {
    if (!m.userId) continue;
    const user = await ctx.db.get(m.userId);
    if (!user || user.deletedAt) continue;
    if (user.timerStatus !== "running" && user.timerStatus !== "paused") continue;
    if (!user.timerTaskId || user.timerStartedAt === undefined) continue;
    out.push({
      userId: user._id,
      taskIdStr: user.timerTaskId.toString(),
      dateStr: getDateInTimezone(user.timerStartedAt, timezone),
    });
  }
  return out;
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export const getCloseWorkspace = query({
  args: {
    projectId: v.id("projects"),
    // "YYYY-MM" for calendar periods, or "fixed" for fixed projects.
    period: v.string(),
  },
  handler: async (ctx, args): Promise<CloseWorkspaceData | null> => {
    const { orgId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;
    if (project.billingType === "non_billable") return null;

    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) return null;

    // Parse the period token. Fixed uses the "fixed" sentinel; everything else
    // must be canonical YYYY-MM.
    const isFixed = project.billingType === "fixed";
    let targetPeriodStart: string;
    if (isFixed) {
      targetPeriodStart = project.startDate ?? "2000-01-01";
    } else {
      const m = args.period.match(/^(\d{4})-(\d{2})$/);
      if (!m) return null;
      const yr = Number(m[1]);
      const mo = Number(m[2]);
      if (yr < 2000 || mo < 1 || mo > 12) return null;
      targetPeriodStart = `${m[1]}-${m[2]}-01`;
    }

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    const rounding = orgSettings?.roundingMinutes ?? 1;

    const { entries, taskName } = await loadProjectEntries(
      ctx,
      orgId,
      project._id,
    );

    // For fixed: remaining-fee needs Σ finalized fixed line amounts.
    let fixedBilledFinalized = 0;
    if (isFixed) {
      const invs = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      for (const inv of invs) {
        if (inv.status === "draft" || inv.status === "void") continue;
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const it of items) {
          if (it.lineType === "fixed") fixedBilledFinalized += it.amount;
        }
      }
    }

    const closedPeriods = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    const projectInput: ScopeProjectInput = toScopeProjectInput(project);
    const entryInputs: ScopeEntryInput[] = entries.map(toScopeEntryInput);

    const scope = computeBillingScope({
      project: projectInput,
      entries: entryInputs,
      closedPeriods: closedPeriods.map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        closedAt: p.closedAt ?? null,
      })),
      invoices: invoices.map((inv) => ({
        status: inv.status,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
      })),
      todayStr,
      targetPeriodStart,
      roundingMinutes: rounding,
      fixedBilledFinalized: round2(fixedBilledFinalized),
    });

    // Join member + category. Caches avoid re-fetching a repeated
    // user/category across the entry set.
    const entryById = new Map(entries.map((e) => [e._id.toString(), e]));
    const invoiceById = new Map(invoices.map((inv) => [inv._id.toString(), inv]));
    const userCache = new Map<
      string,
      { name: string; imageUrl: string | undefined }
    >();
    async function getMember(userId: Id<"users">) {
      const key = userId.toString();
      const hit = userCache.get(key);
      if (hit) return hit;
      const u = await ctx.db.get(userId);
      const safe = { name: u?.name ?? "Unknown", imageUrl: u?.imageUrl };
      userCache.set(key, safe);
      return safe;
    }
    const categoryCache = new Map<
      string,
      { _id: Id<"workCategories">; name: string; color: string } | null
    >();
    async function getCategory(catId: Id<"workCategories"> | undefined) {
      if (!catId) return null;
      const key = catId.toString();
      if (categoryCache.has(key)) return categoryCache.get(key) ?? null;
      const c = await ctx.db.get(catId);
      const safe =
        c && c.orgId === orgId
          ? { _id: c._id, name: c.name, color: c.color }
          : null;
      categoryCache.set(key, safe);
      return safe;
    }

    // F5 — a period covered only by a DRAFT invoice reads as closed (drafts
    // anchor periods so the queue drops them) but has no settlement stamps to
    // render. Surface the draft so the UI can route there instead of showing
    // a blank committed ledger.
    let coveringDraft: CloseWorkspaceData["coveringDraft"] = null;
    if (scope.fromSettlementStamps && !isFixed) {
      const draft = invoices.find(
        (inv) =>
          inv.status === "draft" &&
          inv.periodStart !== undefined &&
          inv.periodEnd !== undefined &&
          inv.periodStart <= scope.period.end &&
          scope.period.start <= inv.periodEnd,
      );
      if (draft) {
        coveringDraft = {
          id: draft._id,
          prefix: draft.prefix,
          number: draft.number ?? null,
        };
      }
    }

    // Next-period label ("Skip → <next>"). Same target for every in-scope entry
    // (their current effective period IS this period).
    const nextPeriodLabel =
      isFixed || scope.fromSettlementStamps
        ? null
        : periodLabel(
            project.billingType,
            getNextPeriod(projectInput, scope.period).start,
            getNextPeriod(projectInput, scope.period).end,
          );

    async function buildRow(
      src: Doc<"timeEntries">,
      opts: {
        durationMinutes: number;
        isBillable: boolean;
        note: string;
        carried: boolean;
        carriedReason?: CarriedReason;
        originMonthKey: string;
        skipped: boolean;
        skippedToLabel: string | null;
      },
    ): Promise<CloseWorkspaceRow> {
      const amount =
        projectInput.billingType === "t_and_m" && opts.isBillable
          ? round2((opts.durationMinutes / 60) * (src.billableRate ?? 0))
          : null;
      const member = await getMember(src.userId);
      const category = await getCategory(src.snapshotCategoryId);
      const inv = src.invoiceId
        ? invoiceById.get(src.invoiceId.toString())
        : undefined;
      return {
        _id: src._id,
        taskId: src.taskId,
        taskTitle: taskName.get(src.taskId.toString()) ?? "Untitled task",
        userId: src.userId,
        userName: member.name,
        userImageUrl: member.imageUrl,
        date: src.date,
        startedAt: src.startedAt,
        durationMinutes: opts.durationMinutes,
        note: opts.note || undefined,
        isBillable: opts.isBillable,
        billableRate: src.billableRate ?? 0,
        workCategoryId: category?._id,
        workCategoryName: category?.name,
        workCategoryColor: category?.color,
        invoiceId: inv?._id,
        invoicePrefix: inv?.prefix,
        invoiceNumber: inv?.number,
        invoiceStatus: inv?.status,
        invoiceDueDate: inv?.dueDate,
        settledAt: src.settledAt,
        settledReason: src.settledReason,
        settledPeriodStart: src.settledPeriodStart,
        settledPeriodEnd: src.settledPeriodEnd,
        amount,
        carried: opts.carried,
        carriedReason: opts.carriedReason,
        originMonthKey: opts.originMonthKey,
        originMonthLabel: monthKeyLabel(opts.originMonthKey),
        skipped: opts.skipped,
        skippedToLabel: opts.skippedToLabel,
      };
    }

    const rows: CloseWorkspaceRow[] = [];
    let totalLoggedMinutes = 0;
    // In-scope entries.
    for (const se of scope.entries) {
      const src = entryById.get(se.entryId.toString());
      if (!src) continue;
      totalLoggedMinutes += se.durationMinutes;
      rows.push(
        await buildRow(src, {
          durationMinutes: se.durationMinutes,
          isBillable: se.isBillable,
          note: se.note ?? "",
          carried: se.carried,
          carriedReason: se.carriedReason,
          originMonthKey: se.originMonthKey,
          skipped: false,
          skippedToLabel: null,
        }),
      );
    }

    // Skipped-out entries: deferred out of THIS period into a later one. They're
    // no longer in scope (don't count toward totals), but surface collapsed with
    // Undo while this period is open (PRD stories 18–19). Detected via
    // `resolveEntryPeriods`: withoutSkip == this period, withSkip > this period.
    if (!scope.fromSettlementStamps && !isFixed) {
      const resolutions = resolveEntryPeriods({
        project: projectInput,
        entries: entryInputs,
        closedPeriods: closedPeriods.map((p) => ({
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          closedAt: p.closedAt ?? null,
        })),
        invoices: invoices.map((inv) => ({
          status: inv.status,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
        })),
        todayStr,
      });
      for (const r of resolutions) {
        if (r.withoutSkip.start !== scope.period.start) continue;
        if (r.withSkip.start <= scope.period.start) continue;
        const src = entryById.get(r.entryId.toString());
        if (!src) continue;
        rows.push(
          await buildRow(src, {
            durationMinutes: src.durationMinutes,
            isBillable: src.isBillable,
            note: src.note ?? "",
            carried: false,
            originMonthKey: src.date.slice(0, 7),
            skipped: true,
            skippedToLabel: periodLabel(
              project.billingType,
              r.withSkip.start,
              r.withSkip.end,
            ),
          }),
        );
      }
    }

    // Canonical display order (in-scope chronological, skipped last). Group
    // meta (subtotals, carried promotion, all-skipped) is derived client-side
    // per group axis via `convex/lib/closeGroups.ts`.
    rows.sort(compareCloseRows);

    // Review flags (slice 04) — derived by the pure `closeFlags` module from
    // the same scope report, plus running-timer info. A closed period gets NO
    // flags: the ledger is immutable (I4), so a "to review" list would be a
    // to-do list nothing can act on.
    const flags = scope.fromSettlementStamps
      ? []
      : computeCloseFlags({
          scope,
          runningTimers: await loadRunningTimers(
            ctx,
            orgId,
            new Set(taskName.keys()),
            { start: scope.period.start, end: scope.period.end },
            timezone,
          ),
        });

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
      client: { id: client._id, name: client.name },
      currency: client.currency,
      period: {
        start: scope.period.start,
        end: scope.period.end,
        label: periodLabel(
          project.billingType,
          scope.period.start,
          scope.period.end,
        ),
        isCalendar: !isFixed,
      },
      nextPeriodLabel,
      billingType: project.billingType,
      usageMinutes: scope.usageMinutes,
      includedMinutes: scope.includedMinutes,
      balanceMinutes: scope.includedMinutes - scope.usageMinutes,
      carriedInMinutes: scope.carriedInMinutes,
      monthlyBalances: scope.monthlyBalances,
      balanceToDateMinutes: scope.balanceToDateMinutes,
      // Fixed has no calendar period (empty `period.end` would read as elapsed).
      periodElapsed: !isFixed && scope.period.end < todayStr,
      overageMinutes: scope.overageMinutes,
      overageRate: project.overageRate ?? null,
      overageAmount: scope.overageAmount,
      amount: scope.amount,
      withinBudget: scope.withinBudget,
      committable: scope.committable,
      fromSettlementStamps: scope.fromSettlementStamps,
      coveringDraft,
      issues: scope.issues,
      totalLoggedMinutes,
      timezone,
      entries: rows,
      flags,
    };
  },
});

// ─── Close queue (slice 08) ──────────────────────────────────────────────────

/** One actionable period in the Billing → Close tab. */
export type CloseQueueRow = {
  /** Stable key (project + period) — matches the ready-feed key shape. */
  key: string;
  projectId: Id<"projects">;
  projectName: string;
  clientId: Id<"clients">;
  clientName: string;
  billingType: BillingType;
  /** Workspace URL period token: "YYYY-MM" or "fixed". */
  periodToken: string;
  /** Display label: "June 2026" / "Apr–Jun 2026" / "Remaining fee". */
  periodLabel: string;
  /** Calendar month this row groups under (YYYY-MM); a cycle uses its closing month. */
  monthKey: string;
  amount: number;
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
  /** I3 — is this the project's first open, elapsed period? */
  committable: boolean;
  /** Oldest-first hint ("Close June 2026 first") when not committable. */
  disabledReason: string | null;
  /** Over-budget retainer with no overage rate — routes to Set rate, not Review. */
  configIssue: "missing-overage-rate" | null;
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
  /** Total open rows — equals the sidebar badge's generate+close count (US 5). */
  actionableCount: number;
};

/** Stable row key mirroring `lib/invoices/list-rows.readyRowKey` (server-side). */
function queueRowKey(r: ReadyRow): string {
  return r.period
    ? `ready:${r.kind}:${r.projectId}:${r.period.year}-${r.period.month}`
    : `ready:${r.kind}:${r.projectId}`;
}

/**
 * The Billing → Close queue — every open, elapsed, closable period across the
 * org, enriched with review signals and grouped by calendar month with
 * oldest-first blocking (PRD stories 1–5, 29). Admin-only.
 *
 * Period enumeration reuses `enumerateReadyRows` (the same pass that feeds the
 * sidebar badge, so the two can never disagree — US 5); each row is then
 * enriched with a per-period `billingScope` + `closeFlags` composition for the
 * "N to review" signal, colored hours, and I3 committability. The pure
 * `closeQueue` helpers own the summarizing, oldest-first hints, and month
 * grouping/progress.
 */
export const getCloseQueue = query({
  args: {},
  handler: async (ctx): Promise<CloseQueueData> => {
    const { orgId } = await requireAdmin(ctx);
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    const rounding = orgSettings?.roundingMinutes ?? 1;
    const currentMonthKey = todayStr.slice(0, 7);

    const readyRows = await enumerateReadyRows(ctx, orgId, todayStr);
    const activeTimers = await loadActiveTimers(ctx, orgId, timezone);

    // Group ready rows by project so each project's docs are fetched once.
    const byProject = new Map<string, ReadyRow[]>();
    for (const r of readyRows) {
      const k = r.projectId.toString();
      const g = byProject.get(k);
      if (g) g.push(r);
      else byProject.set(k, [r]);
    }

    const committedByMonth = new Map<string, number>();
    const enriched: CloseQueueRow[] = [];

    for (const rows of byProject.values()) {
      const project = await ctx.db.get(rows[0].projectId);
      if (!project || project.orgId !== orgId) continue;
      const client = await ctx.db.get(project.clientId);
      if (!client || client.orgId !== orgId) continue;
      const isFixed = project.billingType === "fixed";

      const { entries, taskName } = await loadProjectEntries(ctx, orgId, project._id);
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      const closedPeriods = await ctx.db
        .query("retainerPeriods")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      const fixedBilledFinalized = isFixed
        ? await getFixedBilledFinalized(ctx, orgId, project._id)
        : 0;

      const projectInput: ScopeProjectInput = toScopeProjectInput(project);
      const entryInputs: ScopeEntryInput[] = entries.map(toScopeEntryInput);
      const projectTaskIds = new Set(taskName.keys());
      const scopeClosedPeriods = closedPeriods.map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        closedAt: p.closedAt ?? null,
      }));
      const scopeInvoices = invoices.map((inv) => ({
        status: inv.status,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
      }));

      // Progress counter: periods already committed this month leave the queue
      // but still count toward "N of M closed". Dedupe per project so a period
      // that is both invoiced and admin-closed counts once.
      const committedMonths = new Set<string>();
      for (const inv of invoices) {
        if (inv.status === "void") continue;
        const k =
          getInvoiceAnchorMonthKey(inv) ??
          (inv.periodEnd ? inv.periodEnd.slice(0, 7) : null);
        if (k) committedMonths.add(k);
      }
      for (const p of closedPeriods) {
        if (p.closedAt !== undefined) committedMonths.add(p.periodStart.slice(0, 7));
      }
      for (const k of committedMonths) {
        committedByMonth.set(k, (committedByMonth.get(k) ?? 0) + 1);
      }

      for (const row of rows) {
        const targetPeriodStart = row.period
          ? `${row.period.year}-${String(row.period.month).padStart(2, "0")}-01`
          : (project.startDate ?? "2000-01-01");
        const scope = computeBillingScope({
          project: projectInput,
          entries: entryInputs,
          closedPeriods: scopeClosedPeriods,
          invoices: scopeInvoices,
          todayStr,
          targetPeriodStart,
          roundingMinutes: rounding,
          fixedBilledFinalized: round2(fixedBilledFinalized),
        });
        // Defense in depth: a period billingScope reads from settlement stamps
        // is already closed — it must never surface as an actionable queue row
        // (that would be an uncloseable dead-end). The ready-row builders now
        // exclude admin-closed / invoice-covered periods at the source, so this
        // is a belt-and-suspenders guard against any future enumeration leak.
        if (scope.fromSettlementStamps) continue;
        const runningTimers: RunningTimerInfo[] = activeTimers
          .filter(
            (t) =>
              projectTaskIds.has(t.taskIdStr) &&
              t.dateStr >= scope.period.start &&
              t.dateStr <= scope.period.end,
          )
          .map((t) => ({ userId: t.userId }));
        const flags = computeCloseFlags({ scope, runningTimers });
        const summary = summarizeQueueScope(scope, flags);
        const monthKey = row.period
          ? `${row.period.year}-${String(row.period.month).padStart(2, "0")}`
          : currentMonthKey;

        // Money + budget state come from `billingScope` (the single source of
        // truth), NOT the naive ready-row builder — otherwise a period with
        // carried-in entries would show the builder's date-bucketed amount
        // ($853) while the workspace and the eventual invoice bill the true
        // scope amount ($1,813). A within-budget retainer is a "Close & report"
        // row (no invoice amount); everything else bills `scope.amount`.
        const isRetainer = project.billingType === "retainer";
        const closeRow = isRetainer && scope.withinBudget;
        const badgeKind: "within-budget" | "over-budget" | null = isRetainer
          ? scope.withinBudget
            ? "within-budget"
            : "over-budget"
          : null;

        enriched.push({
          key: queueRowKey(row),
          projectId: project._id,
          projectName: project.name,
          clientId: client._id,
          clientName: client.name,
          billingType: project.billingType,
          periodToken: isFixed ? "fixed" : monthKey,
          periodLabel: periodLabel(
            project.billingType,
            scope.period.start,
            scope.period.end,
          ),
          monthKey,
          amount: scope.amount,
          currency: row.currency,
          badgeKind,
          isCloseRow: closeRow,
          overageHours: scope.overageMinutes > 0 ? scope.overageMinutes / 60 : null,
          loggedMinutes: summary.loggedMinutes,
          includedMinutes: scope.includedMinutes,
          entryCount: summary.entryCount,
          flagCount: summary.flagCount,
          committable: scope.committable,
          disabledReason: null,
          configIssue: scope.issues.includes("missing-overage-rate")
            ? "missing-overage-rate"
            : null,
        });
      }
    }

    // I3 oldest-first hints (monthKey doubles as the chronological sort key).
    const disabled = assignDisabledReasons(
      enriched.map((r) => ({
        key: r.key,
        projectId: r.projectId.toString(),
        sortKey: r.monthKey,
        committable: r.committable,
        periodLabel: r.periodLabel,
      })),
    );
    for (const r of enriched) r.disabledReason = disabled.get(r.key) ?? null;

    const groups = groupQueueByMonth(enriched, committedByMonth);
    const months: CloseQueueMonth[] = groups.map((g) => ({
      monthKey: g.monthKey,
      label: monthKeyLabel(g.monthKey),
      rows: g.rows,
      openCount: g.openCount,
      closedCount: g.closedCount,
      totalCount: g.totalCount,
      totalsByCurrency: g.totalsByCurrency,
    }));

    return { months, actionableCount: enriched.length };
  },
});

// ─── Skip mutation (slice 05) ────────────────────────────────────────────────

/** Load the close context (period-close rows + invoices) for one project. */
async function loadCloseState(ctx: MutationCtx, orgId: string, projectId: Id<"projects">) {
  const closedPeriods = await ctx.db
    .query("retainerPeriods")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();
  return {
    closedPeriods: closedPeriods.map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      closedAt: p.closedAt ?? null,
    })),
    invoices: invoices.map((inv) => ({
      status: inv.status,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
    })),
  };
}

/**
 * Admin-only batch skip / un-skip (PRD § Skip). Sets or clears the
 * `skippedThrough` stamp on a batch of OPEN entries.
 *
 * Guards (all-or-nothing, `checkSkipEligibility`): non-admin rejected by
 * `requireAdmin`; org-scoped; every entry must be open (locked entries reject
 * the whole batch); `date` is never touched.
 *
 * Skip target is server-derived, never client-supplied (PRD invariant): each
 * entry's `skippedThrough` is set to its CURRENT effective-period end (I1 via
 * `resolveEntryPeriods`), so the entry moves to the next period. Clearing the
 * stamp restores it; if its origin period has since closed, I1 still resolves it
 * forward to the first open period (structurally — nothing to enforce here).
 */
export const skipEntries = mutation({
  args: {
    entryIds: v.array(v.id("timeEntries")),
    // Omit / false → skip (stamp forward). true → un-skip (clear the stamp).
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    // Load + tenancy check.
    const entries: Doc<"timeEntries">[] = [];
    for (const id of args.entryIds) {
      const e = await ctx.db.get(id);
      if (!e || e.orgId !== orgId) throw new ConvexError("Entry not found.");
      entries.push(e);
    }

    const eligibility = checkSkipEligibility(entries);
    if (!eligibility.ok) throw new ConvexError(skipRejectionMessage(eligibility));

    const now = Date.now();

    // ── Un-skip: clear the stamp. I1 handles forward resolution structurally. ──
    if (args.clear) {
      for (const e of entries) {
        await ctx.db.patch(e._id, { skippedThrough: undefined, updatedAt: now });
      }
      return { count: entries.length, cleared: true };
    }

    // ── Skip: re-derive each entry's current effective-period end (I1). ──
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(now, timezone);

    // Resolve each entry's project (via its task). Group by project so the
    // effective-period re-derivation runs once per project over its full entry
    // set (firstOpenPeriod needs the whole set).
    const projectByEntry = new Map<string, Id<"projects">>();
    const taskCache = new Map<string, Doc<"tasks">>();
    for (const e of entries) {
      const key = e.taskId.toString();
      let task = taskCache.get(key);
      if (!task) {
        const loaded = await ctx.db.get(e.taskId);
        if (!loaded || loaded.orgId !== orgId) {
          throw new ConvexError("Entry task not found.");
        }
        task = loaded;
        taskCache.set(key, task);
      }
      if (!task.projectId) throw new ConvexError("Entry is not on a project task.");
      projectByEntry.set(e._id.toString(), task.projectId);
    }
    const byProject = new Map<string, Doc<"timeEntries">[]>();
    for (const e of entries) {
      const pid = projectByEntry.get(e._id.toString())!.toString();
      const list = byProject.get(pid) ?? [];
      list.push(e);
      byProject.set(pid, list);
    }

    let count = 0;
    for (const [pidStr, batch] of byProject) {
      const project = await ctx.db.get(pidStr as Id<"projects">);
      if (!project || project.orgId !== orgId) {
        throw new ConvexError("Project not found.");
      }
      const { entries: projEntries } = await loadProjectEntries(
        ctx,
        orgId,
        project._id,
      );
      const { closedPeriods, invoices } = await loadCloseState(
        ctx,
        orgId,
        project._id,
      );
      const resolutions = resolveEntryPeriods({
        project: toScopeProjectInput(project),
        entries: projEntries.map(toScopeEntryInput),
        closedPeriods,
        invoices,
        todayStr,
      });
      const endByEntry = new Map(
        resolutions.map((r) => [r.entryId.toString(), r.withSkip.end]),
      );
      for (const e of batch) {
        const targetEnd = endByEntry.get(e._id.toString());
        if (!targetEnd) {
          // Only OPEN entries appear in resolutions; eligibility already
          // guaranteed open, so this is defensive.
          throw new ConvexError("Couldn't resolve the skip target for an entry.");
        }
        await ctx.db.patch(e._id, { skippedThrough: targetEnd, updatedAt: now });
        count++;
      }
    }
    return { count, cleared: false };
  },
});
