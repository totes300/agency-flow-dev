/**
 * One billing period of one project, as every read surface sees it
 * (docs/prd-billing-refactor.md N8, N11).
 *
 *   - A period with a live close reads its members from the close's immutable
 *     snapshot and re-prices them with the inputs the close froze — so the
 *     numbers are exactly what the invoice / report was committed with.
 *   - Any other period reads its members from the scope rule and prices them
 *     live — the same call `commitClose` makes, so the promise is the invoice.
 *
 * The queue row, the Close workspace and the monthly report are all built from
 * this, which is what makes them agree.
 */

import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import {
  frozenPricingProject,
  snapshotMembers,
  toPricingProject,
  toScopeProject,
  type BillingEntry,
  type CloseContext,
} from "./closeData";
import { nextPeriod, periodOfDate, type Period } from "./periods";
import { priceScope, type MonthlyBalanceRow, type PriceResult, type PricedEntry } from "./pricing";
import { committablePeriod, isPeriodClosed, scopeOf, type CarriedReason } from "./scope";

type Reader = { db: GenericDatabaseReader<DataModel> };

export type PeriodMember = {
  entry: PricedEntry & { _id: Id<"timeEntries"> };
  carried?: CarriedReason;
  /** Stored report month (§8.3) — snapshot members only. */
  monthKey?: string;
  /** The live entry document (present unless it was deleted after commit). */
  doc: Doc<"timeEntries"> | null;
};

export type PeriodView = {
  period: Period;
  /** The live close settling this period, if any. */
  liveClose: Doc<"billingCloses"> | null;
  members: PeriodMember[];
  price: PriceResult;
  /** The period `commitClose` would accept right now (oldest-first), if any. */
  committable: Period | null;
  /** Elapsed unclosed periods waiting behind the committable one. */
  pendingAfter: number;
};

export async function buildPeriodView(
  ctx: Reader,
  c: CloseContext,
  period: Period,
  opts: { todayStr: string; roundingMinutes: number },
): Promise<PeriodView> {
  const scopeProject = toScopeProject(c.project);
  const { period: committable, pendingAfter } = committablePeriod({
    project: scopeProject,
    entries: c.entries,
    liveCloses: c.livePeriods,
    todayStr: opts.todayStr,
  });
  const docById = new Map(c.entries.map((e) => [e._id, e.doc]));
  const liveClose =
    c.liveCloses.find((cl) => cl.periodStart <= period.end && cl.periodEnd >= period.start) ?? null;

  if (liveClose) {
    const { members, price } = await priceClose(ctx, liveClose, opts.todayStr);
    return {
      period: { start: liveClose.periodStart, end: liveClose.periodEnd },
      liveClose,
      members: sortMembers(
        members.map((m) => ({ ...m, doc: docById.get(m.entry._id) ?? null })),
      ),
      price,
      committable,
      pendingAfter,
    };
  }

  const scoped = scopeOf<BillingEntry>({
    project: scopeProject,
    entries: c.entries,
    liveCloses: c.livePeriods,
    period,
  });
  const members = scoped.map(({ entry, carried }) => ({
    entry,
    ...(carried ? { carried } : {}),
    doc: entry.doc,
  }));
  const price = priceScope({
    project: toPricingProject(c.project, c.currency),
    period,
    members,
    roundingMinutes: c.project.billingType === "retainer" ? 1 : opts.roundingMinutes,
    todayStr: opts.todayStr,
  });
  return { period, liveClose: null, members, price, committable, pendingAfter };
}

/**
 * A close's frozen snapshot re-priced with the inputs it froze — exactly the
 * numbers it was committed with. `todayStr` only decides which ladder months
 * read as pending; a document (invoice, worksheet) passes nothing and sees
 * the whole period as elapsed.
 */
export async function priceClose(
  ctx: Reader,
  close: Doc<"billingCloses">,
  todayStr: string = close.periodEnd,
) {
  const rows = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
    .collect();
  const members = snapshotMembers(rows);
  const price = priceScope({
    project: frozenPricingProject(close),
    period: { start: close.periodStart, end: close.periodEnd },
    members,
    roundingMinutes: close.roundingMinutes,
    todayStr,
  });
  return { members, price };
}

/** One month's ladder row, with the period view that produced it. */
export type MonthBalance = { monthKey: string; view: PeriodView; row: MonthlyBalanceRow };

/**
 * The balance-ladder row (§8.3) of each requested month (YYYY-MM), read from
 * the period that settles it: a live close's snapshot when one covers the
 * month, the scope rule otherwise. Months sharing a period share one view.
 * A month no period of the grid contains (a cycle month before the project
 * start) is absent from the result.
 */
export async function monthBalances(
  ctx: Reader,
  c: CloseContext,
  monthKeys: string[],
  opts: { todayStr: string; roundingMinutes: number },
): Promise<Map<string, MonthBalance>> {
  const grid = toScopeProject(c.project);
  const views = new Map<string, PeriodView>();
  const out = new Map<string, MonthBalance>();
  for (const monthKey of monthKeys) {
    const monthStart = `${monthKey}-01`;
    const close = c.liveCloses.find((cl) => cl.periodStart <= monthStart && cl.periodEnd >= monthStart);
    const period = close
      ? { start: close.periodStart, end: close.periodEnd }
      : periodOfDate(grid, monthStart);
    let view = views.get(period.start);
    if (!view) {
      view = await buildPeriodView(ctx, c, period, opts);
      views.set(period.start, view);
    }
    const row = view.price.monthlyBalances.find((r) => r.monthKey === monthKey);
    if (row) out.set(monthKey, { monthKey, view, row });
  }
  return out;
}

function sortMembers(members: PeriodMember[]): PeriodMember[] {
  return [...members].sort((a, b) =>
    a.entry.date !== b.entry.date
      ? a.entry.date < b.entry.date ? -1 : 1
      : a.entry._id < b.entry._id ? -1 : a.entry._id > b.entry._id ? 1 : 0,
  );
}

/**
 * Every elapsed period of a retainer without a live close, oldest first —
 * what is still waiting to be closed (the queue shows the first one; project
 * pages summarize all of them). Empty for T&M and for a retainer without a
 * start date.
 */
export async function openElapsedRetainerPeriods(
  ctx: Reader,
  c: CloseContext,
  opts: { todayStr: string; roundingMinutes: number },
): Promise<PeriodView[]> {
  const project = toScopeProject(c.project);
  if (project.billingType !== "retainer" || !project.startDate) return [];
  const views: PeriodView[] = [];
  for (
    let p = periodOfDate(project, project.startDate);
    p.end < opts.todayStr;
    p = nextPeriod(project, p)
  ) {
    if (isPeriodClosed(p, c.livePeriods)) continue;
    views.push(await buildPeriodView(ctx, c, p, opts));
  }
  return views;
}
