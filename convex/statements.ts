/**
 * Retainer Statements — period summaries for closed retainer months.
 *
 * Why this file exists: a closed retainer month with no billable amount
 * (within budget, no monthly fee, no overage) doesn't produce an invoice —
 * see `convex/lib/readyToInvoice.ts:isInvoiceable` and the createInvoice
 * guard in `convex/invoices.ts`. The "what happened in this period" record
 * still matters (audit, client share-out), so we render it on demand from
 * the same data that drives the project's MonthlyBreakdownCard. No new
 * persisted entity — the statement IS a render of `getRetainerStatement`.
 *
 * Design rules (locked with the user, 2026-05-02):
 *  - Statements are NOT entities — they're computed every read from time
 *    entries + project config. Backdating policy keeps closed periods stable
 *    (entries land in the next open period).
 *  - The PDF document is "Activity Statement", not invoice-shaped — no
 *    invoice number, no AMOUNT DUE, no due date. The client must not mistake
 *    a statement for a bill.
 *  - Available for every closed month regardless of rollover, including
 *    mid-cycle months in rollover projects (they're interim snapshots).
 *  - Future auto-send cron will call this same query — the single source of
 *    truth keeps emailed statements identical to manually downloaded ones.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "./lib/timer";
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
 * The balance numbers here match `computeRetainerBalance` in
 * `convex/invoices.ts` — the same logic used by the createInvoice mutation
 * and getRetainerInvoicePreview. If a billable invoice exists for this
 * month, the statement still renders (the client may want a share-out copy
 * even after billing), and `linkedInvoice` is set so the UI can link out.
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

    // Period boundaries in YYYY-MM-DD.
    const periodStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const lastDay = new Date(args.year, args.month, 0).getDate();
    const periodEnd = `${args.year}-${String(args.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Pull billable, uninvoiced AND invoiced entries — a statement reflects
    // all logged work in the period regardless of invoice status. Voided
    // invoice entries also count (they were really worked).
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();
    const taskMap = new Map<string, Doc<"tasks">>();
    for (const t of tasks) taskMap.set(t._id, t);

    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries.filter(
            (e) => e.date >= periodStart && e.date <= periodEnd,
          );
        }),
      )
    ).flat();
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

    // Balance numbers — read from the linked invoice if one exists (frozen
    // snapshot from createInvoice), otherwise compute live from the entries
    // above. Reading the invoice when available keeps the statement and
    // invoice byte-identical for clients who receive both.
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const linkedInvoice =
      projectInvoices.find(
        (inv) => inv.periodStart === periodStart && inv.status !== "void",
      ) ?? null;

    const includedMinutes = project.includedMinutesPerMonth ?? 0;
    const monthlyFee = project.monthlyFee ?? 0;
    const overageRate = project.overageRate ?? 0;

    const usedMinutes = linkedInvoice?.retainerUsedMinutes ?? billableEntries.reduce(
      (s, e) => s + e.durationMinutes,
      0,
    );
    const startBalanceMinutes = linkedInvoice?.retainerStartBalanceMinutes ?? 0;
    const endBalanceMinutes =
      linkedInvoice?.retainerEndBalanceMinutes ??
      startBalanceMinutes + includedMinutes - usedMinutes;
    const overageMinutes = endBalanceMinutes < 0 ? Math.abs(endBalanceMinutes) : 0;
    const overageHours = round2(overageMinutes / 60);
    const overageAmount = round2(overageHours * overageRate);
    const total = round2(monthlyFee + overageAmount);

    // Period label — "March 2026"
    const periodLabel = new Date(args.year, args.month - 1, 1).toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" },
    );

    return {
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
      billing: {
        monthlyFee,
        overageRate,
        overageAmount,
        total,
        currency: client.currency,
      },
      project: {
        id: project._id,
        name: project.name,
        rolloverEnabled: project.rolloverEnabled ?? true,
        cycleLength: project.cycleLength ?? 3,
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
