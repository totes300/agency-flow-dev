/**
 * Reporting collectors — batch-shaped internal queries, kept as the core for
 * the MCP server's `report` tool (docs/prd-mcp.md §8).
 *
 * Design rules:
 *  - BATCH-SHAPED: "loop over all clients / all months" happens HERE, in deterministic code, in one query — never
 *    as a model-side tool loop (D1: code loops and sums, the model never
 *    re-adds).
 *  - Auth runs with the CALLING USER's identity: each collector is a
 *    `*ForAuth(ctx, auth, args)` core that the internal query calls with
 *    `getAuthContext` / `requireAdmin` and MCP with `getMcpAuthContext`;
 *    admin-only cores assert the role themselves (`assertAdmin`).
 *  - Aggregation math lives in the pure layer
 *    (`convex/lib/reportCore.ts`) — fixture-tested, no Convex runtime.
 *  - NEVER return truncated aggregates: a clipped sum is a WRONG number.
 *    When a scan exceeds its cap, throw a model-actionable ConvexError
 *    telling the agent to narrow the period.
 *  - Ids arrive as plain strings from tool schemas; normalize + tenancy-check
 *    with self-correcting error messages (same as `timesheets.ts`).
 */

import { v, ConvexError } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertAdmin, getAuthContext, requireAdmin, type AuthContext } from "./lib/auth";
import { assertValidDateString } from "./lib/dateValidation";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { classifyReportPeriod } from "./lib/reportPeriod";
import { monthKeyFromAbs } from "./lib/billing/periods";
import { fromMinor } from "./lib/billing/money";
import { monthBalances } from "./lib/billing/periodView";
import {
  aggregateClientMonths,
  aggregateClientTasks,
  aggregateOrgFinance,
  aggregateTimeByMember,
  classifyRetainerMonth,
  isValidMonthKey,
  lastDayOfMonth,
  monthKeysBetween,
  type ReportEntryInput,
  type ReportNotedEntryInput,
  type RetainerMonthStatus,
  type TaskProjectRef,
} from "./lib/reportCore";
import { round2 } from "./lib/billing/money";
import { getProjectEntries } from "./lib/projectEntries";
import { loadCloseContext } from "./lib/billing/closeData";

/** Hard scan ceilings — throwing beats returning a silently-wrong sum. */
export const MAX_REPORT_ENTRIES = 20_000;
const MAX_RANGE_DAYS = 366;
const MAX_MONTH_SPAN = 24;

const NARROW_PERIOD_HINT =
  "The requested period contains too many time entries to aggregate in one " +
  "call — ask for a narrower date range and combine the results.";

function assertDateRange(fromDate: string, toDate: string): void {
  assertValidDateString(fromDate, "fromDate");
  assertValidDateString(toDate, "toDate");
  if (toDate < fromDate) {
    throw new ConvexError("toDate must not be before fromDate.");
  }
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const days =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ConvexError(
      `Date range too large — maximum ${MAX_RANGE_DAYS} days per call. ` +
        "Split the period and combine the results.",
    );
  }
}

function toReportEntry(e: Doc<"timeEntries">): ReportEntryInput {
  return {
    userId: e.userId.toString(),
    taskId: e.taskId.toString(),
    date: e.date,
    durationMinutes: e.durationMinutes,
    isBillable: e.isBillable,
    costRate: e.costRate,
    billableRate: e.billableRate,
    rateCurrency: e.rateCurrency,
  };
}

/**
 * Resolve where each entry's task lives (task → project → client), with
 * per-doc tenancy guards. Tasks without a project map to `null` so the
 * aggregators can bucket them under "No project".
 */
async function buildTaskProjectLookup(
  ctx: QueryCtx,
  orgId: string,
  taskIds: ReadonlySet<string>,
): Promise<Map<string, TaskProjectRef | null>> {
  const taskDocs = await Promise.all(
    [...taskIds].map((id) => ctx.db.get(id as Id<"tasks">)),
  );
  const projectIds = new Set<string>();
  const tasks: Doc<"tasks">[] = [];
  for (const t of taskDocs) {
    if (!t || t.orgId !== orgId) continue;
    tasks.push(t);
    if (t.projectId) projectIds.add(t.projectId.toString());
  }

  const projectDocs = await Promise.all(
    [...projectIds].map((id) => ctx.db.get(id as Id<"projects">)),
  );
  const projectMap = new Map<string, Doc<"projects">>();
  const clientIds = new Set<string>();
  for (const p of projectDocs) {
    if (!p || p.orgId !== orgId) continue;
    projectMap.set(p._id.toString(), p);
    clientIds.add(p.clientId.toString());
  }

  const clientDocs = await Promise.all(
    [...clientIds].map((id) => ctx.db.get(id as Id<"clients">)),
  );
  const clientMap = new Map<string, Doc<"clients">>();
  for (const c of clientDocs) {
    if (!c || c.orgId !== orgId) continue;
    clientMap.set(c._id.toString(), c);
  }

  const lookup = new Map<string, TaskProjectRef | null>();
  for (const t of tasks) {
    const project = t.projectId
      ? projectMap.get(t.projectId.toString())
      : undefined;
    const client = project ? clientMap.get(project.clientId.toString()) : undefined;
    lookup.set(
      t._id.toString(),
      project
        ? {
            projectId: project._id.toString(),
            projectName: project.name,
            clientId: project.clientId.toString(),
            clientName: client?.name ?? "Unknown",
            currency: client?.currency ?? "unknown",
          }
        : null,
    );
  }
  return lookup;
}

/** Org-date index scan with the hard cap (throws instead of truncating). */
async function scanEntriesInRange(
  ctx: QueryCtx,
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<Doc<"timeEntries">[]> {
  const entries = await ctx.db
    .query("timeEntries")
    .withIndex("by_orgId_date", (q) =>
      q.eq("orgId", orgId).gte("date", fromDate).lte("date", toDate),
    )
    .take(MAX_REPORT_ENTRIES + 1);
  if (entries.length > MAX_REPORT_ENTRIES) {
    throw new ConvexError(NARROW_PERIOD_HINT);
  }
  return entries;
}

// ─── Time by member (Package C) ─────────────────────────────────────────────

/**
 * Per-member time rollup for a period: totals + per-project split.
 *
 * Auth: `getAuthContext` — non-admins are force-scoped to themselves (the
 * exact `workday.weekGrid` rule), so a member-run agent can only report the
 * running member's own time. Admins may target specific members
 * (`userIds`) or the whole team (`allMembers`); default is the caller.
 */
export const timeByMember = internalQuery({
  args: {
    fromDate: v.string(), // YYYY-MM-DD inclusive
    toDate: v.string(),
    // Plain strings — they arrive from the model via the tool schema.
    userIds: v.optional(v.array(v.string())),
    allMembers: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await timeByMemberForAuth(ctx, await getAuthContext(ctx), args),
});

export async function timeByMemberForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { fromDate: string; toDate: string; userIds?: string[]; allMembers?: boolean },
) {
  assertDateRange(args.fromDate, args.toDate);

  // Membership roster — names for every potential row.
  const memberships = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
    .collect();
  const linked = memberships.flatMap((m) => (m.userId ? [m.userId] : []));
  const userDocs = await Promise.all(linked.map((id) => ctx.db.get(id)));
  const userNameById = new Map<string, string>();
  for (const u of userDocs) {
    if (u && !u.deletedAt) userNameById.set(u._id.toString(), u.name);
  }

  // Target selection (D6: members can never widen beyond themselves).
  let targetUserIds: string[];
  if (!auth.isAdmin) {
    targetUserIds = [auth.userId.toString()];
  } else if (args.userIds && args.userIds.length > 0) {
    targetUserIds = args.userIds.map((raw) => {
      const id = ctx.db.normalizeId("users", raw);
      if (!id || !userNameById.has(id.toString())) {
        throw new ConvexError(
          `Unknown user id "${raw}". Use the listTeamMembers tool to get valid member ids.`,
        );
      }
      return id.toString();
    });
  } else if (args.allMembers) {
    targetUserIds = [...userNameById.keys()];
  } else {
    targetUserIds = [auth.userId.toString()];
  }
  targetUserIds = [...new Set(targetUserIds)];

  const allowed = new Set(targetUserIds);
  const entries = (
    await scanEntriesInRange(ctx, auth.orgId, args.fromDate, args.toDate)
  ).filter((e) => allowed.has(e.userId.toString()));

  const taskIds = new Set(entries.map((e) => e.taskId.toString()));
  const projectByTaskId = await buildTaskProjectLookup(
    ctx,
    auth.orgId,
    taskIds,
  );

  const members = aggregateTimeByMember({
    entries: entries.map(toReportEntry),
    targetUserIds,
    userNameById,
    projectByTaskId,
  });

  return {
    fromDate: args.fromDate,
    toDate: args.toDate,
    members,
    totals: {
      minutes: members.reduce((s, m) => s + m.minutes, 0),
      billableMinutes: members.reduce((s, m) => s + m.billableMinutes, 0),
      nonBillableMinutes: members.reduce((s, m) => s + m.nonBillableMinutes, 0),
      entryCount: members.reduce((s, m) => s + m.entryCount, 0),
    },
  };
}

// ─── Client monthly totals (Package D) ──────────────────────────────────────

/**
 * A client's per-month time + billable value across a month range — the
 * "full year in one call" collector (owner workflow W2). Admin-gated like
 * every client-level financial collector (`collectTimesheetData` precedent).
 */
export const clientMonthlySummary = internalQuery({
  args: {
    clientId: v.string(),
    fromMonth: v.string(), // YYYY-MM inclusive
    toMonth: v.string(),
  },
  handler: async (ctx, args) => await clientMonthlySummaryForAuth(ctx, await requireAdmin(ctx), args),
});

/**
 * `options.tasks` (MCP `report` client_monthly, docs/prd-mcp.md D25) adds one
 * rollup per task worked in the range — its minutes and its time-entry notes,
 * from the same entries as the month totals. Without it the result is
 * exactly the internal query's.
 */
export async function clientMonthlySummaryForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { clientId: string; fromMonth: string; toMonth: string },
  options: { tasks?: boolean } = {},
) {
  assertAdmin(auth);

  if (!isValidMonthKey(args.fromMonth) || !isValidMonthKey(args.toMonth)) {
    throw new ConvexError("Months must be YYYY-MM strings, e.g. 2026-06.");
  }
  if (args.toMonth < args.fromMonth) {
    throw new ConvexError("toMonth must not be before fromMonth.");
  }
  if (monthKeysBetween(args.fromMonth, args.toMonth).length > MAX_MONTH_SPAN) {
    throw new ConvexError(
      `Month range too large — maximum ${MAX_MONTH_SPAN} months per call.`,
    );
  }

  const clientId = ctx.db.normalizeId("clients", args.clientId);
  const client = clientId ? await ctx.db.get(clientId) : null;
  if (!client || client.orgId !== auth.orgId) {
    throw new ConvexError(
      "Client not found. Use the listClients tool to get valid client ids.",
    );
  }

  const projects = (
    await ctx.db
      .query("projects")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .collect()
  ).filter((p) => p.orgId === auth.orgId);

  const fromDate = `${args.fromMonth}-01`;
  const toDate = lastDayOfMonth(args.toMonth);

  // Per-project indexed read: the client's project set is bounded, and this
  // avoids scanning every org entry in the range.
  const projectByTaskId = new Map<string, TaskProjectRef | null>();
  const entries: ReportEntryInput[] = [];
  const noted: ReportNotedEntryInput[] = [];
  for (const project of projects) {
    const ref: TaskProjectRef = {
      projectId: project._id.toString(),
      projectName: project.name,
      clientId: client._id.toString(),
      clientName: client.name,
      currency: client.currency,
    };
    for (const e of await getProjectEntries(ctx, auth.orgId, project._id)) {
      projectByTaskId.set(e.taskId.toString(), ref);
      if (e.date < fromDate || e.date > toDate) continue;
      entries.push(toReportEntry(e));
      if (options.tasks) noted.push({ ...toReportEntry(e), note: e.note, startedAt: e.startedAt });
      if (entries.length > MAX_REPORT_ENTRIES) {
        throw new ConvexError(NARROW_PERIOD_HINT);
      }
    }
  }

  const { months, totals } = aggregateClientMonths({
    entries,
    fromMonth: args.fromMonth,
    toMonth: args.toMonth,
    projectByTaskId,
  });

  return {
    client: {
      id: client._id.toString(),
      name: client.name,
      currency: client.currency,
    },
    fromMonth: args.fromMonth,
    toMonth: args.toMonth,
    months,
    totals,
    ...(options.tasks ? { tasks: aggregateClientTasks({ entries: noted, projectByTaskId }) } : {}),
  };
}

// ─── Retainer health sweep (Package E) ──────────────────────────────────────

type RetainerHealthRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  currency: string;
  retainerStatus: "active" | "inactive";
  rolloverEnabled: boolean;
  cycleLength: number;
  /** 1-indexed position of the month in its cycle; null without startDate. */
  cyclePosition: number | null;
  includedMinutesPerMonth: number;
  usedMinutes: number;
  /** Running balance after this month (the balance ladder, §8.3). */
  monthEndBalanceMinutes: number;
  /** Cycle-to-date scope (whole allowance vs usage so far) — cycle periods only. */
  cycle: {
    budgetMinutes: number;
    usedMinutes: number;
    balanceMinutes: number;
    isClosingMonth: boolean;
  } | null;
  status: RetainerMonthStatus;
  periodEnded: boolean;
  isClosed: boolean;
  overageDue: boolean;
  overageMinutes: number;
  overageAmount: number;
  monthlyFee: number;
  overageRate: number;
  invoice: { number: number | undefined; prefix: string; status: string } | null;
};

/**
 * Month-close sweep: ONE row per non-archived retainer project with its
 * month state — used/included/balance, overage due-ness (same invoice-aware
 * rule `getRetainerData` applies), admin close state, covering invoice.
 * The owner's "go through ALL clients" workflow (W3) in a single call.
 */
export const retainerHealthForMonth = internalQuery({
  args: {
    year: v.number(),
    month: v.number(), // 1-12
  },
  handler: async (ctx, args) => await retainerHealthForMonthForAuth(ctx, await requireAdmin(ctx), args),
});

export async function retainerHealthForMonthForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { year: number; month: number },
) {
  assertAdmin(auth);

  if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2200) {
    throw new ConvexError("year must be a four-digit year.");
  }
  if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12) {
    throw new ConvexError("month must be 1-12.");
  }

  const orgSettings = await getOrgSettings(ctx, auth.orgId);
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
  const todayStr = getDateInTimezone(Date.now(), timezone);
  if (classifyReportPeriod(args.year, args.month, todayStr) === "future") {
    throw new ConvexError(
      "That month hasn't started yet — pick the current or a past month.",
    );
  }

  const targetKey = monthKeyFromAbs(args.year * 12 + args.month - 1);
  const periodEnd = lastDayOfMonth(targetKey);
  const periodEnded = periodEnd < todayStr;
  const monthLabel = new Date(args.year, args.month - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  const retainers = (
    await ctx.db
      .query("projects")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect()
  ).filter((p) => p.billingType === "retainer" && !p.archivedAt);

  const clientCache = new Map<string, Doc<"clients"> | null>();
  const rows: RetainerHealthRow[] = [];

  for (const project of retainers) {
    let client = clientCache.get(project.clientId.toString());
    if (client === undefined) {
      const doc = await ctx.db.get(project.clientId);
      client = doc && doc.orgId === auth.orgId ? doc : null;
      clientCache.set(project.clientId.toString(), client);
    }

    const monthlyFee = project.monthlyFee ?? 0;
    const overageRate = project.overageRate ?? 0;
    // Defaults mirror `projects.create` (cycleLength 1 → monthly, no rollover).
    const rolloverEnabled = project.rolloverEnabled ?? false;
    const cycleLength = project.cycleLength ?? 1;

    // The month's balance-ladder row (§8.3) from the period that settles
    // it — the same row the project page, report and Close workspace show.
    const closeContext = await loadCloseContext(ctx, auth.orgId, project._id);
    const balance = (
      await monthBalances(ctx, closeContext, [targetKey], { todayStr, roundingMinutes: 1 })
    ).get(targetKey);
    // A cycle month before the retainer's first cycle: not a retainer month yet.
    if (!balance) continue;
    const { view, row } = balance;
    const ladder = view.price.monthlyBalances;
    const isCycle = ladder.length > 1;

    // The live close covering the month: its invoice and the closed flag.
    const coveringInvoice = view.liveClose?.invoiceId
      ? await ctx.db.get(view.liveClose.invoiceId)
      : null;
    const isClosed = view.liveClose !== null;

    // A cycle month classifies on the cycle-to-date view (whole allowance
    // vs usage so far); a monthly period on its own balance. Overage is
    // DUE only where the period settles — its last month, once ended —
    // and while no invoice covers it (`getRetainerData` rule).
    const settles = row.isLast && view.period.end < todayStr;
    const status: RetainerMonthStatus = classifyRetainerMonth(
      isCycle
        ? { workedMinutes: row.usedToDateMinutes, endBalanceMinutes: row.remainingMinutes, periodEnded: settles }
        : { workedMinutes: row.usedMinutes, endBalanceMinutes: row.balanceMinutes, periodEnded },
    );
    const overageDue = settles && row.overageMinutes > 0 && !coveringInvoice;
    const overageMinutes = overageDue ? row.overageMinutes : 0;
    const cyclePosition = isCycle ? ladder.indexOf(row) + 1 : null;
    const cycle: RetainerHealthRow["cycle"] = isCycle
      ? {
          budgetMinutes: view.price.includedMinutes,
          usedMinutes: row.usedToDateMinutes,
          balanceMinutes: row.remainingMinutes,
          isClosingMonth: row.isLast,
        }
      : null;

    rows.push({
      projectId: project._id.toString(),
      projectName: project.name,
      clientId: project.clientId.toString(),
      clientName: client?.name ?? "Unknown",
      currency: client?.currency ?? "unknown",
      retainerStatus: project.retainerStatus ?? "active",
      rolloverEnabled,
      cycleLength,
      cyclePosition,
      includedMinutesPerMonth: row.includedMinutes,
      usedMinutes: row.usedMinutes,
      monthEndBalanceMinutes: row.balanceMinutes,
      cycle,
      status,
      periodEnded,
      isClosed,
      overageDue,
      overageMinutes,
      overageAmount: overageDue ? fromMinor(row.overageAmountMinor, closeContext.currency) : 0,
      monthlyFee,
      overageRate,
      invoice: coveringInvoice
        ? {
            number: coveringInvoice.number,
            prefix: coveringInvoice.prefix,
            status: coveringInvoice.status,
          }
        : null,
    });
  }

  rows.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName) ||
      a.projectName.localeCompare(b.projectName),
  );

  const overageDueByCurrency = new Map<string, number>();
  for (const row of rows) {
    if (!row.overageDue) continue;
    overageDueByCurrency.set(
      row.currency,
      (overageDueByCurrency.get(row.currency) ?? 0) + row.overageAmount,
    );
  }

  return {
    month: targetKey,
    monthLabel,
    periodEnded,
    rows,
    summary: {
      retainerProjects: rows.length,
      overageDueCount: rows.filter((r) => r.overageDue).length,
      overageDueByCurrency: [...overageDueByCurrency.entries()]
        .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    },
  };
}

// ─── Org finance snapshot (Package G) ───────────────────────────────────────

/** Output cap for the per-project rows (totals are never truncated). */
const MAX_SNAPSHOT_PROJECT_ROWS = 50;

/**
 * Org-wide financial snapshot for a period: raw-ledger time + labor cost +
 * entry-derived billable value, and per-currency totals of the invoices
 * ISSUED in the same period. Two revenue views on purpose — the entry
 * ledger misses retainer fees (rate 0 by design); the invoice totals carry
 * them. Admin-only.
 */
export const orgFinanceSnapshot = internalQuery({
  args: {
    fromDate: v.string(), // YYYY-MM-DD inclusive
    toDate: v.string(),
  },
  handler: async (ctx, args) => await orgFinanceSnapshotForAuth(ctx, await requireAdmin(ctx), args),
});

export async function orgFinanceSnapshotForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { fromDate: string; toDate: string },
) {
  assertAdmin(auth);
  assertDateRange(args.fromDate, args.toDate);

  const entries = await scanEntriesInRange(
    ctx,
    auth.orgId,
    args.fromDate,
    args.toDate,
  );
  const taskIds = new Set(entries.map((e) => e.taskId.toString()));
  const projectByTaskId = await buildTaskProjectLookup(ctx, auth.orgId, taskIds);

  const invoices = (
    await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect()
  ).filter(
    (inv) =>
      inv.status !== "void" &&
      inv.issueDate >= args.fromDate &&
      inv.issueDate <= args.toDate,
  );

  const rollup = aggregateOrgFinance({
    entries: entries.map(toReportEntry),
    invoices: invoices.map((inv) => ({
      status: inv.status,
      total: fromMinor(inv.totalMinor, inv.currency),
      currency: inv.currency,
    })),
    projectByTaskId,
  });

  return {
    fromDate: args.fromDate,
    toDate: args.toDate,
    time: rollup.time,
    laborCostByCurrency: rollup.laborCostByCurrency,
    billableValueByCurrency: rollup.billableValueByCurrency,
    invoicing: rollup.invoicing,
    projects: rollup.projects.slice(0, MAX_SNAPSHOT_PROJECT_ROWS),
    projectCount: rollup.projects.length,
    projectsTruncated: rollup.projects.length > MAX_SNAPSHOT_PROJECT_ROWS,
  };
}
