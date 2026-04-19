import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings, getProjectCurrency } from "./lib/orgHelpers";
import { getDateInTimezone } from "./lib/timer";
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
        .collect();
      // Filter by orgId to prevent cross-tenant leakage
      invoices = invoices.filter((inv) => inv.orgId === orgId);
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
    status: v.optional(v.union(v.literal("draft"), v.literal("invoiced"), v.literal("paid"))),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
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

    if (args.clientId) invoices = invoices.filter((inv) => inv.clientId === args.clientId);
    if (args.projectId) invoices = invoices.filter((inv) => inv.projectId === args.projectId);

    const searchTerm = args.search?.trim().toLowerCase();
    if (searchTerm) {
      invoices = invoices.filter((inv) => {
        const formatted = formatInvoiceNumber(inv.prefix, inv.number).toLowerCase();
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
 * Returns per-currency sums + counts for Draft, Outstanding, Overdue, Paid This Month.
 *
 * Product decision: invoices with undefined dueDate are treated as Outstanding
 * (no overdue clock). See docs/invoicing-issue-7-tasks.md.
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
    const timezone = orgSettings?.timezone ?? "UTC";
    const todayStr = getDateInTimezone(Date.now(), timezone);
    // Current month in org timezone, e.g. "2026-04"
    const currentYearMonth = todayStr.slice(0, 7);

    type Bucket = { count: number; currencySums: Record<string, number> };
    const empty = (): Bucket => ({ count: 0, currencySums: {} });
    const draft = empty();
    const outstanding = empty();
    const overdue = empty();
    const paidThisMonth = empty();

    function accumulate(bucket: Bucket, inv: Doc<"invoices">) {
      bucket.count += 1;
      bucket.currencySums[inv.currency] =
        round2((bucket.currencySums[inv.currency] ?? 0) + inv.total);
    }

    for (const inv of invoices) {
      if (inv.status === "draft") {
        accumulate(draft, inv);
      } else if (inv.status === "invoiced") {
        // undefined dueDate → Outstanding (product decision)
        if (inv.dueDate == null || inv.dueDate >= todayStr) {
          accumulate(outstanding, inv);
        } else {
          accumulate(overdue, inv);
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

    return { draft, outstanding, overdue, paidThisMonth };
  },
});

/**
 * Closed, uninvoiced retainer months across all retainer projects in the org.
 * Feeds the "Ready to invoice" card on /invoices.
 */
export const getReadyToInvoice = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "UTC";

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const retainerProjects = projects.filter(
      (p) => p.billingType === "retainer" && !p.archivedAt,
    );

    type ReadyRow = {
      clientId: Id<"clients">;
      clientName: string;
      clientLogoUrl: string | null;
      projectId: Id<"projects">;
      projectName: string;
      monthlyFee: number;
      currency: string;
      year: number;
      month: number;
      label: string;
      startDate: string;
      endDate: string;
    };

    const rows: ReadyRow[] = [];
    const clientLogoCache = new Map<string, string | null>();

    for (const project of retainerProjects) {
      const months = await getClosedUninvoicedMonths(
        ctx as any,
        orgId,
        project._id,
        project,
        timezone,
      );
      if (months.length === 0) continue;

      const client = await ctx.db.get(project.clientId);
      if (!client || client.orgId !== orgId) continue;

      const clientKey = client._id.toString();
      let logoUrl = clientLogoCache.get(clientKey) ?? null;
      if (!clientLogoCache.has(clientKey)) {
        logoUrl = client.logoStorageId
          ? await ctx.storage.getUrl(client.logoStorageId)
          : null;
        clientLogoCache.set(clientKey, logoUrl);
      }

      for (const m of months) {
        rows.push({
          clientId: client._id,
          clientName: client.name,
          clientLogoUrl: logoUrl,
          projectId: project._id,
          projectName: project.name,
          monthlyFee: project.monthlyFee ?? 0,
          currency: client.currency,
          year: m.year,
          month: m.month,
          label: m.label,
          startDate: m.startDate,
          endDate: m.endDate,
        });
      }
    }

    rows.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
    return rows;
  },
});

/**
 * Get invoice metrics for a project — totals for metric cards.
 * Returns billing-type-specific fields for Fixed Fee projects.
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
      .collect();
    const orgInvoices = invoices.filter((inv) => inv.orgId === orgId);

    let totalInvoiced = 0;
    for (const inv of orgInvoices) {
      totalInvoiced += inv.total;
    }

    // Fixed Fee: compute billed amount from lineType:"fixed" items only
    // (excludes manual rows so remaining balance stays accurate).
    // Only finalized invoices count — drafts are provisional.
    let fixedBilled = 0;
    if (project.billingType === "fixed") {
      for (const inv of orgInvoices) {
        if (inv.status === "draft") continue;
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
    let uninvoicedMonthCount = 0;
    let uninvoicedMonthLabels: string[] = [];
    if (project.billingType === "retainer") {
      const orgSettings = await getOrgSettings(ctx, orgId);
      const timezone = orgSettings?.timezone ?? "UTC";
      const closedUninvoiced = await getClosedUninvoicedMonths(
        ctx as any,
        orgId,
        args.projectId,
        project,
        timezone,
      );
      uninvoicedMonthCount = closedUninvoiced.length;
      uninvoicedMonthLabels = closedUninvoiced.map((m) => m.label);
    }

    const currency = await getProjectCurrency(ctx, project);

    return {
      totalInvoiced,
      invoiceCount: orgInvoices.length,
      currency,
      // Fixed Fee specific
      fixedPrice,
      fixedBilled,
      fixedRemaining: round2(fixedPrice - fixedBilled),
      fixedPercentInvoiced: fixedPrice > 0
        ? Math.round((fixedBilled / fixedPrice) * 100)
        : 0,
      // Retainer specific
      uninvoicedMonthCount,
      uninvoicedMonthLabels,
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
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;

    // Get all tasks for this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    // Fetch all billable, uninvoiced entries
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries
            .filter((e) => e.isBillable && !e.invoiceId)
            .map((e) => ({
              ...e,
              taskTitle: task.title,
              workCategoryId: e.snapshotCategoryId,
            }));
        }),
      )
    ).flat();

    // Apply date range filter
    const filtered = allEntries.filter((e) => {
      if (args.startDate && e.date < args.startDate) return false;
      if (args.endDate && e.date > args.endDate) return false;
      return true;
    });

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
        .collect();

      let alreadyInvoiced = 0;
      for (const inv of existingInvoices) {
        if (inv.orgId !== orgId) continue;
        if (inv.status === "draft") continue;
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

type RetainerComputeInput = {
  /** Grouped task minutes: Map<groupKey, totalMinutes> */
  taskMinutesMap: Map<string, number>;
  roundingMinutes: number;
  startBalance: number;
  includedMinutes: number;
  monthlyFee: number;
  overageRate: number;
  rolloverEnabled: boolean;
  cycleLength: number;
  /** Position of this month within its cycle (0-indexed). -1 if unknown. */
  positionInCycle: number;
};

type RetainerComputeResult = {
  usedMinutes: number;
  endBalance: number;
  isOverageDue: boolean;
  overageMinutes: number;
  overageHours: number;
  overageAmount: number;
  retainerFeeAmount: number;
  total: number;
};

/**
 * Single source of truth for retainer balance + overage computation.
 * Used by createInvoice, getRetainerInvoicePreview, and recalcRetainerBalance.
 */
function computeRetainerBalance(input: RetainerComputeInput): RetainerComputeResult {
  // Sum rounded task hours → used minutes
  let usedMinutes = 0;
  for (const minutes of input.taskMinutesMap.values()) {
    usedMinutes += roundMinutesUp(minutes, input.roundingMinutes);
  }

  const endBalance = input.startBalance + input.includedMinutes - usedMinutes;

  // Overage logic
  let isOverageDue = false;
  if (endBalance < 0) {
    if (!input.rolloverEnabled) {
      isOverageDue = true;
    } else {
      // Rollover ON: overage only on cycle-closing month
      isOverageDue = input.positionInCycle >= 0 && input.positionInCycle === input.cycleLength - 1;
    }
  }

  let overageMinutes = 0;
  let overageHours = 0;
  let overageAmount = 0;
  if (isOverageDue) {
    overageMinutes = Math.abs(endBalance);
    overageHours = round2(overageMinutes / 60);
    overageAmount = round2(overageHours * input.overageRate);
  }

  const retainerFeeAmount = input.monthlyFee;
  const total = round2(retainerFeeAmount + overageAmount);

  return {
    usedMinutes,
    endBalance,
    isOverageDue,
    overageMinutes,
    overageHours,
    overageAmount,
    retainerFeeAmount,
    total,
  };
}

/**
 * Compute position of a month within its retainer cycle (0-indexed).
 * Returns -1 if project start date is missing.
 */
function getRetainerCyclePosition(
  projectStartDate: string | undefined,
  monthYear: number,
  monthMonth: number, // 1-12
  cycleLength: number,
): number {
  if (!projectStartDate) return -1;
  const startParts = projectStartDate.split("-").map(Number);
  const monthsDiff = (monthYear - startParts[0]) * 12 + (monthMonth - startParts[1]);
  return monthsDiff % cycleLength;
}

// Collapse a YYYY-MM-DD start date to its month boundary (YYYY-MM-01) so
// validation guards compare at month granularity. The rest of the retainer
// system (cycle position, sequential finalization) already ignores day-of-month.
function projectStartMonth(startDate: string | undefined): string | undefined {
  return startDate ? `${startDate.slice(0, 7)}-01` : undefined;
}

/**
 * Group time entries by (workCategoryId, taskId) and return a Map of group key → total minutes.
 * Shared between create, preview, and recalc.
 */
function groupRetainerEntryMinutes(
  entries: Array<{ workCategoryId?: string | null; taskId: string; durationMinutes: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.workCategoryId ?? "none"}::${e.taskId}`;
    map.set(key, (map.get(key) ?? 0) + e.durationMinutes);
  }
  return map;
}

/**
 * Derive the start balance for a retainer invoice.
 *
 * The rules mirror the retainer overview engine (convex/projects.ts):
 *   - Rollover OFF  → always 0. Each month is independent; overage settles the
 *     deficit and the next month starts clean.
 *   - Rollover ON, first month of a new cycle → 0. Cycles reset.
 *   - Rollover ON, subsequent month in cycle → chain from the latest prior
 *     retainer invoice on the project. Drafts AND finalized count — draft
 *     edits cascade forward via {@link recalcRetainerBalance} so the chain
 *     stays consistent as the admin edits unfinalized months.
 */
async function getRetainerStartBalance(
  ctx: any,
  orgId: string,
  projectId: Id<"projects">,
  periodStart: string,
  project: Doc<"projects">,
): Promise<number> {
  const rolloverEnabled = project.rolloverEnabled ?? true;

  // Rollover OFF: each month independent — always start at 0
  if (!rolloverEnabled) return 0;

  // Rollover ON: check cycle position
  const cycleLength = project.cycleLength ?? 3;
  const [periodYear, periodMonth] = periodStart.split("-").map(Number);
  const position = getRetainerCyclePosition(project.startDate, periodYear, periodMonth, cycleLength);

  // First month of cycle (position 0) always starts at 0
  if (position === 0) return 0;

  // Subsequent month in cycle: chain from the latest prior invoice (any status).
  const existingInvoices: Doc<"invoices">[] = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q: any) => q.eq("projectId", projectId))
    .collect();

  const previous = existingInvoices
    .filter(
      (inv: Doc<"invoices">) =>
        inv.orgId === orgId &&
        inv.periodEnd &&
        inv.periodEnd < periodStart &&
        inv.retainerEndBalanceMinutes != null,
    )
    .sort((a: Doc<"invoices">, b: Doc<"invoices">) => (b.periodEnd! > a.periodEnd! ? 1 : -1));

  if (previous.length > 0) {
    return previous[0].retainerEndBalanceMinutes ?? 0;
  }
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
  ctx: any,
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

  let positionInCycle = -1;
  if (invoice.periodStart) {
    const parts = invoice.periodStart.split("-").map(Number);
    positionInCycle = getRetainerCyclePosition(project.startDate, parts[0], parts[1], cycleLength);
  }

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

  // Chain cascade — editing this invoice's time rows changes its end balance,
  // which is the start balance of the NEXT retainer month. If the next month
  // has a draft invoice, re-snapshot its start balance from the new end
  // balance and recurse. Finalized invoices are frozen by design; if one
  // happens to follow a draft, we stop the cascade there — the stale-chain
  // concern is guarded at the revert/delete boundary by
  // {@link findLaterRetainerInvoice}.
  await cascadeRetainerChain(ctx, invoice, result.endBalance, project);
}

/**
 * If a later-month draft retainer invoice exists on the same project, update
 * its `retainerStartBalanceMinutes` from the updated prior end balance and
 * recursively recalc it so its own subsequent drafts stay in lockstep.
 */
async function cascadeRetainerChain(
  ctx: any,
  previousInvoice: Doc<"invoices">,
  _previousEndBalance: number,
  project: Doc<"projects">,
) {
  if (!previousInvoice.periodEnd) return;
  // Cascade only makes sense when the chain is "on". Cycle boundaries handle
  // the reset inside {@link getRetainerStartBalance}.
  const rolloverEnabled =
    previousInvoice.retainerRolloverEnabled ?? project.rolloverEnabled ?? true;
  if (!rolloverEnabled) return;

  const projectInvoices: Doc<"invoices">[] = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q: any) =>
      q.eq("projectId", previousInvoice.projectId),
    )
    .collect();

  const next = projectInvoices
    .filter(
      (inv) =>
        inv._id !== previousInvoice._id &&
        inv.orgId === previousInvoice.orgId &&
        inv.periodStart &&
        inv.periodStart > previousInvoice.periodEnd!,
    )
    .sort((a, b) => (a.periodStart! > b.periodStart! ? 1 : -1))[0];

  if (!next || next.status !== "draft" || !next.periodStart) return;

  // Re-derive start balance rather than assuming the updated end balance
  // flows directly through — this keeps cycle-boundary resets honored by
  // the shared rule in getRetainerStartBalance.
  const newStartBalance = await getRetainerStartBalance(
    ctx,
    next.orgId,
    next.projectId,
    next.periodStart,
    project,
  );

  // Only touch the draft when the chained value actually changed.
  if ((next.retainerStartBalanceMinutes ?? 0) === newStartBalance) return;

  const now = Date.now();
  await ctx.db.patch(next._id, {
    retainerStartBalanceMinutes: newStartBalance,
    updatedAt: now,
  });

  // Re-run the recalc on the downstream draft with the refreshed start
  // balance. This will itself cascade further forward if more drafts chain.
  const refreshed: Doc<"invoices"> = {
    ...next,
    retainerStartBalanceMinutes: newStartBalance,
  };
  await recalcRetainerBalance(ctx, next._id, refreshed, project);
}

/**
 * Enumerate all closed months from project start to today that don't have an invoice.
 * Used by both the retainer preview query and the metrics query.
 */
async function getClosedUninvoicedMonths(
  ctx: { db: { query: (table: string) => any; get: (id: any) => any } },
  orgId: string,
  projectId: Id<"projects">,
  project: Doc<"projects">,
  timezone: string,
) {
  const startDate = project.startDate;
  if (!startDate) return [];

  const todayStr = getDateInTimezone(Date.now(), timezone);
  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const [startYear, startMonth] = startDate.split("-").map(Number);

  // Build all months from project start to today
  const allMonths: { year: number; month: number; label: string; startDate: string; endDate: string }[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < todayYear || (y === todayYear && m <= todayMonth)) {
    const lastDay = new Date(y, m, 0).getDate();
    const mStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const mEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const isClosed = mEnd < todayStr;
    if (isClosed) {
      allMonths.push({
        year: y,
        month: m,
        label: monthLabel(mStart),
        startDate: mStart,
        endDate: mEnd,
      });
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }

  // Get existing invoices for this project (any status — duplicate guard is regardless of status)
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q: any) => q.eq("projectId", projectId))
    .collect();
  const invoicedMonths = new Set(
    invoices
      .filter((inv: Doc<"invoices">) => inv.orgId === orgId && inv.periodStart)
      .map((inv: Doc<"invoices">) => inv.periodStart!.slice(0, 7)),
  );

  return allMonths.filter((m) => !invoicedMonths.has(`${m.year}-${String(m.month).padStart(2, "0")}`));
}

/**
 * Live preview for retainer invoice creation modal.
 * Returns balance data, fee, overage, and total for a selected month.
 */
/**
 * Get closed uninvoiced months for a retainer project.
 * Dedicated query for the month dropdown — no preview math.
 */
export const getRetainerUninvoicedMonths = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId || project.billingType !== "retainer") return [];
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "UTC";
    return getClosedUninvoicedMonths(ctx as any, orgId, args.projectId, project, timezone);
  },
});

/**
 * Live preview for retainer invoice creation modal.
 * Uses shared computeRetainerBalance for consistent math with createInvoice.
 */
export const getRetainerInvoicePreview = query({
  args: {
    projectId: v.id("projects"),
    year: v.number(),
    month: v.number(), // 1-12
    roundingMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    // Validate month range
    if (args.month < 1 || args.month > 12 || !Number.isInteger(args.month) || !Number.isInteger(args.year)) {
      return null;
    }

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId || project.billingType !== "retainer") return null;

    // Validate month is closed and within project range
    const orgSettingsVal = await getOrgSettings(ctx, orgId);
    const tzVal = orgSettingsVal?.timezone ?? "UTC";
    const todayVal = getDateInTimezone(Date.now(), tzVal);
    const lastDayCheck = new Date(args.year, args.month, 0).getDate();
    const mEndCheck = `${args.year}-${String(args.month).padStart(2, "0")}-${String(lastDayCheck).padStart(2, "0")}`;
    if (mEndCheck >= todayVal) return null; // month not closed yet
    const mStartCheck = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const projectStart = projectStartMonth(project.startDate);
    if (projectStart && mStartCheck < projectStart) return null; // before project start month

    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) return null;

    const lastDay = new Date(args.year, args.month, 0).getDate();
    const mStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const mEnd = `${args.year}-${String(args.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Get billable uninvoiced entries for this month
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries
            .filter((e) => e.isBillable && !e.invoiceId && e.date >= mStart && e.date <= mEnd)
            .map((e) => ({
              workCategoryId: e.snapshotCategoryId?.toString() ?? null,
              taskId: e.taskId.toString(),
              durationMinutes: e.durationMinutes,
            }));
        }),
      )
    ).flat();

    // Use shared grouping helper — same as createInvoice
    const taskMinutesMap = groupRetainerEntryMinutes(allEntries);

    // Get start balance using shared helper
    const startBalance = await getRetainerStartBalance(ctx, orgId, args.projectId, mStart, project);

    const cycleLength = project.cycleLength ?? 3;
    const positionInCycle = getRetainerCyclePosition(project.startDate, args.year, args.month, cycleLength);

    const result = computeRetainerBalance({
      taskMinutesMap,
      roundingMinutes: args.roundingMinutes,
      startBalance,
      includedMinutes: project.includedMinutesPerMonth ?? 0,
      monthlyFee: project.monthlyFee ?? 0,
      overageRate: project.overageRate ?? 0,
      rolloverEnabled: project.rolloverEnabled ?? true,
      cycleLength,
      positionInCycle,
    });

    return {
      totalMinutes: result.usedMinutes,
      retainerFee: result.retainerFeeAmount,
      startBalance,
      included: project.includedMinutesPerMonth ?? 0,
      used: result.usedMinutes,
      endBalance: result.endBalance,
      overageAmount: result.overageAmount,
      total: result.total,
      currency: client?.currency ?? "USD",
    };
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
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries
            .filter((e) => e.isBillable && !e.invoiceId)
            .map((e) => ({
              ...e,
              workCategoryId: e.snapshotCategoryId,
            }));
        }),
      )
    ).flat();

    // 3. Apply date range filter
    // Retainer: compute month boundaries from retainerYear/retainerMonth
    let effectiveStart = args.startDate;
    let effectiveEnd = args.endDate;
    if (billingType === "retainer") {
      if (!args.retainerYear || !args.retainerMonth) {
        throw new ConvexError("Retainer invoices require a month selection.");
      }
      const y = args.retainerYear;
      const m = args.retainerMonth;
      effectiveStart = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      effectiveEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Duplicate guard: one invoice per project-month regardless of status
      const existingInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .collect();
      const duplicate = existingInvoices.find(
        (inv) =>
          inv.orgId === orgId &&
          inv.periodStart === effectiveStart &&
          inv.periodEnd === effectiveEnd,
      );
      if (duplicate) {
        const label = monthLabel(effectiveStart);
        throw new ConvexError(`An invoice for ${label} already exists.`);
      }

      // BUG FIX: Validate month is within valid billing window
      const orgSettingsForValidation = await getOrgSettings(ctx, orgId);
      const validationTimezone = orgSettingsForValidation?.timezone ?? "UTC";
      const todayStr = getDateInTimezone(Date.now(), validationTimezone);

      // Reject months before project start month (day-of-month ignored — see projectStartMonth)
      const projectStart = projectStartMonth(project.startDate);
      if (projectStart && effectiveStart < projectStart) {
        throw new ConvexError("Cannot create an invoice for a month before the retainer start date.");
      }

      // Reject months that haven't closed yet (endDate must be in the past)
      if (effectiveEnd >= todayStr) {
        throw new ConvexError("Cannot create an invoice for a month that hasn't ended yet.");
      }

      // Sequential guard — reject if any earlier month in the same cycle has
      // NO invoice yet. Drafts count: each month's draft chains its
      // `retainerStartBalanceMinutes` from the prior month's end balance, so
      // the sequence only needs an invoice to exist, not to be finalized.
      // (Rollover ON only — balance chaining requires order.)
      // Default rolloverEnabled to true to match the rest of the retainer system
      // (computeRetainerBalance and getRetainerData both use `?? true`).
      if (project.rolloverEnabled ?? true) {
        const cycleLen = project.cycleLength ?? 3;
        const position = getRetainerCyclePosition(project.startDate, y, m, cycleLen);

        if (position > 0) {
          // Check that all previous months in this cycle have an invoice
          for (let p = 0; p < position; p++) {
            // Compute the month at position p in this cycle
            const startParts = project.startDate!.split("-").map(Number);
            const cycleStartMonthOffset = Math.floor(
              ((y - startParts[0]) * 12 + (m - startParts[1])) / cycleLen
            ) * cycleLen;
            const prevMonthOffset = cycleStartMonthOffset + p;
            const prevYear = startParts[0] + Math.floor((startParts[1] - 1 + prevMonthOffset) / 12);
            const prevMonth = ((startParts[1] - 1 + prevMonthOffset) % 12) + 1;
            const prevStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;

            const hasPrevInvoice = existingInvoices.some(
              (inv) =>
                inv.orgId === orgId &&
                inv.periodStart === prevStart,
            );
            if (!hasPrevInvoice) {
              const prevLabel = monthLabel(prevStart);
              throw new ConvexError(`Create the ${prevLabel} invoice first. Retainer months must be invoiced in order when rollover is enabled.`);
            }
          }
        }
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

    // 6. Read org settings for numbering + payment terms
    const orgSettings = await getOrgSettings(ctx, orgId);
    const prefix = orgSettings?.invoicePrefix ?? "INV-";
    const nextNumber = orgSettings?.nextInvoiceNumber ?? 1;
    const paymentTermsDays = orgSettings?.defaultPaymentTermsDays ?? 30;

    // 7. Compute issue date and due date
    const timezone = orgSettings?.timezone ?? "UTC";
    const issueDate = getDateInTimezone(Date.now(), timezone);
    const issueDateObj = new Date(issueDate + "T00:00:00Z");
    issueDateObj.setUTCDate(issueDateObj.getUTCDate() + paymentTermsDays);
    const dueDate = issueDateObj.toISOString().slice(0, 10);

    // 8. Auto-prefill subject — "March 2026 — Project" for period-scoped invoices, project name otherwise
    const subject =
      billingType !== "fixed" && periodStart
        ? `${monthLabel(periodStart)} — ${project.name}`
        : project.name;

    // 9. Build line items
    const now = Date.now();
    let subtotal = 0;

    type LineItem = {
      lineType: "time" | "fixed" | "retainer_fee" | "overage";
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
      retainerFee = project.monthlyFee ?? 0;
      retainerOverageRate = project.overageRate ?? 0;
      retainerIncluded = project.includedMinutesPerMonth ?? 0;

      // Build task minutes map from grouped entries (same grouping as line items above)
      const taskMinutesMap = new Map<string, number>();
      for (const group of groupMap.values()) {
        const key = `${group.workCategoryId ?? "none"}::${group.taskId}`;
        taskMinutesMap.set(key, (taskMinutesMap.get(key) ?? 0) + group.minutes);
      }

      retainerStartBalance = await getRetainerStartBalance(ctx, orgId, args.projectId, periodStart!, project);

      const cycleLength = project.cycleLength ?? 3;
      const positionInCycle = args.retainerMonth && args.retainerYear
        ? getRetainerCyclePosition(project.startDate, args.retainerYear, args.retainerMonth, cycleLength)
        : -1;

      const retainerResult = computeRetainerBalance({
        taskMinutesMap,
        roundingMinutes: args.roundingMinutes,
        startBalance: retainerStartBalance,
        includedMinutes: retainerIncluded,
        monthlyFee: retainerFee,
        overageRate: retainerOverageRate,
        rolloverEnabled: project.rolloverEnabled ?? true,
        cycleLength,
        positionInCycle,
      });

      retainerUsed = retainerResult.usedMinutes;
      retainerEndBalance = retainerResult.endBalance;

      // Retainer fee line item
      subtotal += retainerResult.retainerFeeAmount;
      lineItems.push({
        lineType: "retainer_fee",
        description: "Retainer fee",
        quantity: 1,
        unitPrice: retainerFee,
        amount: retainerResult.retainerFeeAmount,
        workCategoryId: undefined,
        entryIds: [],
      });

      // Overage line item
      if (retainerResult.isOverageDue) {
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
    }

    // Fixed: add the fixed fee line item
    if (billingType === "fixed") {
      const fixedPrice = project.fixedPrice ?? 0;

      // Calculate already invoiced: sum of lineType:"fixed" amounts across
      // finalized project invoices only. Drafts are provisional — counting
      // them would let a delete-then-recreate cycle over-bill the project.
      const existingInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .collect();
      const projectInvoiceIds = existingInvoices
        .filter((inv) => inv.orgId === orgId && inv.status !== "draft")
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

    // 10. Create the invoice
    const invoiceData: Record<string, unknown> = {
      orgId,
      projectId: args.projectId,
      clientId: project.clientId,
      number: nextNumber,
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

    // 13. Increment nextInvoiceNumber atomically (Convex OCC)
    if (orgSettings) {
      await ctx.db.patch(orgSettings._id, {
        nextInvoiceNumber: nextNumber + 1,
        updatedAt: now,
      });
    }

    return invoiceId;
  },
});

// ─── Editor Queries ───────────────────────────────────────────────────────────

/**
 * Get a single invoice with all data needed for the editor:
 * line items grouped by category, project info, client info, org brand settings.
 */
export const getInvoice = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) return null;

    // Fetch line items
    const lineItems = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.id))
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
      // Only time lines have hour quantities; fixed/retainer_fee/overage/manual
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
        .collect();
      for (const inv of projectInvoices) {
        if (inv.orgId !== orgId) continue;
        if (inv.status === "draft") continue;
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

    return {
      invoice,
      lineItems,
      categoryGroups: grouped,
      orgInvoiceCount: orgInvoiceSample.length,
      fixedBilled,
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
      timezone: orgSettings?.timezone ?? "UTC",
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

    // Derived line types (`fixed`, `retainer_fee`, `overage`) are anchored to
    // project/invoice snapshots (fixedPrice, retainerMonthlyFee, etc.). Editing
    // their numeric fields would silently desync the total from the snapshot.
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

    // Guard core billing rows: `fixed` and `retainer_fee` are derived from the
    // project and anchor the invoice total — removing them leaves the invoice
    // in an incoherent state. `overage` is auto-managed by recalcRetainerBalance.
    // Only `time` and `manual` rows can be removed by the user.
    if (
      lineItem.lineType === "fixed" ||
      lineItem.lineType === "retainer_fee" ||
      lineItem.lineType === "overage"
    ) {
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

/** Valid status transitions for the invoice state machine. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["invoiced"],
  invoiced: ["paid", "draft"],
  paid: ["invoiced"],
};

/**
 * Check whether a retainer invoice has ANY later invoice (draft or finalized)
 * on the same project. Used by both `deleteInvoice` (LIFO) and
 * `changeInvoiceStatus` (revert guard) — both operations un-freeze the
 * invoice's balance snapshot, which later invoices have already chained from.
 *
 * Drafts are included: a later draft's `retainerStartBalanceMinutes` was
 * captured from this invoice's end balance; reverting/deleting here would
 * strand that chain.
 *
 * Returns the nearest blocking invoice, or null if no guard is needed.
 */
async function findLaterRetainerInvoice(
  ctx: any,
  orgId: string,
  invoice: Doc<"invoices">,
): Promise<Doc<"invoices"> | null> {
  if (!invoice.periodEnd) return null;
  const project = await ctx.db.get(invoice.projectId);
  if (!project || project.orgId !== orgId || project.billingType !== "retainer") return null;

  const projectInvoices: Doc<"invoices">[] = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q: any) => q.eq("projectId", invoice.projectId))
    .collect();

  const later = projectInvoices
    .filter(
      (inv) =>
        inv._id !== invoice._id &&
        inv.orgId === orgId &&
        inv.periodStart &&
        inv.periodStart > invoice.periodEnd!,
    )
    .sort((a, b) => (a.periodStart! > b.periodStart! ? 1 : -1));

  // Return the LATEST later invoice — LIFO guidance: unwind from the newest
  // backwards. E.g. to revert March with April and May invoiced, the user
  // must revert May first, then April, then March.
  return later.length > 0 ? later[later.length - 1] : null;
}

/**
 * Change invoice status following the state machine:
 *   draft → invoiced → paid
 *   invoiced → draft (revert)
 *   paid → invoiced (revert)
 *
 * No direct paid → draft path.
 */
export const changeInvoiceStatus = mutation({
  args: {
    id: v.id("invoices"),
    newStatus: v.union(
      v.literal("draft"),
      v.literal("invoiced"),
      v.literal("paid"),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }

    const allowed = VALID_TRANSITIONS[invoice.status];
    if (!allowed || !allowed.includes(args.newStatus)) {
      throw new ConvexError(
        `Cannot transition from "${invoice.status}" to "${args.newStatus}".`,
      );
    }

    // Retainer revert guard: reverting an invoiced retainer back to draft
    // unfreezes its balance snapshot, which later invoices have already
    // chained from. Block if ANY later retainer invoice exists (draft or
    // finalized) — a later draft's start balance was captured from here.
    if (invoice.status === "invoiced" && args.newStatus === "draft") {
      const blocker = await findLaterRetainerInvoice(ctx, orgId, invoice);
      if (blocker) {
        const label = blocker.periodStart ? monthLabel(blocker.periodStart) : "a later";
        throw new ConvexError(
          `Remove the ${label} invoice first. Retainer invoices must be unwound in reverse order.`,
        );
      }
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.newStatus,
      updatedAt: now,
    };

    // Set paidAt when marking as paid
    if (args.newStatus === "paid") {
      patch.paidAt = now;
    }
    // Clear paidAt when reverting from paid
    if (invoice.status === "paid" && args.newStatus === "invoiced") {
      patch.paidAt = undefined;
    }

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Delete an invoice:
 * 1. Unlink time entries (clear invoiceId) — must happen BEFORE deleting line items
 * 2. Delete all line items
 * 3. Delete the invoice
 *
 * Retainer LIFO guard: retainer invoices cannot be deleted if any later
 * retainer invoice (draft or finalized) exists for the same project. A later
 * draft's `retainerStartBalanceMinutes` was captured from this invoice's end
 * balance; deleting out of order breaks the chain.
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

    // Retainer LIFO guard — applies to drafts and finalized invoices alike.
    const blocker = await findLaterRetainerInvoice(ctx, orgId, invoice);
    if (blocker) {
      const label = blocker.periodStart ? monthLabel(blocker.periodStart) : "a later";
      throw new ConvexError(`Delete the ${label} invoice first.`);
    }

    // 1. Unlink time entries — collect all timeEntryIds from line items BEFORE deleting them
    const lineItems = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.id))
      .collect();

    const now = Date.now();
    for (const li of lineItems) {
      if (li.timeEntryIds && li.timeEntryIds.length > 0) {
        for (const entryId of li.timeEntryIds) {
          const entry = await ctx.db.get(entryId);
          // Explicit tenancy gate (see removeInvoiceLineItem for rationale).
          if (
            entry &&
            entry.orgId === orgId &&
            entry.invoiceId === args.id
          ) {
            await ctx.db.patch(entryId, { invoiceId: undefined, updatedAt: now });
          }
        }
      }
    }

    // 2. Delete all line items
    for (const li of lineItems) {
      await ctx.db.delete(li._id);
    }

    // 3. Delete the invoice
    await ctx.db.delete(args.id);
  },
});
