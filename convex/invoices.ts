import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAdmin, validateStringLength } from "./lib/auth";
import { getOrgSettings, getProjectCurrency } from "./lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import {
  classifyMarkPaid,
  classifyUndo,
  type PriorState,
} from "./lib/markPaid";
import { resolveInvoiceByIdentifier } from "./lib/invoiceIdentifier";
import type { Doc, Id } from "./_generated/dataModel";
import { fromMinor, toMinor } from "./lib/billing/money";
import { formatInvoiceNumber, periodSubjectLabel } from "./lib/billing/labels";
import { loadCloseContext } from "./lib/billing/closeData";
import { closeRetainerUsage } from "./lib/billing/usageBlock";
import { openElapsedRetainerPeriods } from "./lib/billing/periodView";
import { absMonthOf } from "./lib/billing/periods";
import { deleteDraftInvoice, transitionInvoice } from "./lib/billing/invoiceLifecycle";
import { toInvoiceView, toLineView } from "./lib/billing/invoiceView";

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
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
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
          ...toInvoiceView(inv),
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
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("invoiced"),
        v.literal("paid"),
        v.literal("void"),
      ),
    ),
    // Multi-value filters with optional "is not" operator. Shape mirrors the
    // `Filter[]` wire format the UI uses so args build up from filters 1:1.
    clientIds: v.optional(v.array(v.id("clients"))),
    clientIdsOp: v.optional(v.union(v.literal("is"), v.literal("isNot"))),
    projectIds: v.optional(v.array(v.id("projects"))),
    projectIdsOp: v.optional(v.union(v.literal("is"), v.literal("isNot"))),
    // Inclusive YYYY-MM-DD ranges. Empty strings are ignored (the UI
    // materializes a date-range filter before the user picks both ends).
    issueDateFrom: v.optional(v.string()),
    issueDateTo: v.optional(v.string()),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
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

    if (args.clientIds && args.clientIds.length > 0) {
      const set = new Set(args.clientIds);
      const isNot = args.clientIdsOp === "isNot";
      invoices = invoices.filter((inv) =>
        isNot ? !set.has(inv.clientId) : set.has(inv.clientId),
      );
    }
    if (args.projectIds && args.projectIds.length > 0) {
      const set = new Set(args.projectIds);
      const isNot = args.projectIdsOp === "isNot";
      invoices = invoices.filter((inv) =>
        isNot ? !set.has(inv.projectId) : set.has(inv.projectId),
      );
    }

    if (args.issueDateFrom) {
      invoices = invoices.filter((inv) => inv.issueDate >= args.issueDateFrom!);
    }
    if (args.issueDateTo) {
      invoices = invoices.filter((inv) => inv.issueDate <= args.issueDateTo!);
    }
    if (args.dueDateFrom) {
      invoices = invoices.filter(
        (inv) => inv.dueDate != null && inv.dueDate >= args.dueDateFrom!,
      );
    }
    if (args.dueDateTo) {
      invoices = invoices.filter(
        (inv) => inv.dueDate != null && inv.dueDate <= args.dueDateTo!,
      );
    }

    const searchTerm = args.search?.trim().toLowerCase();
    if (searchTerm) {
      invoices = invoices.filter((inv) => {
        // Unnumbered drafts match the literal term "draft" instead of a
        // formatted number.
        const formatted =
          inv.number != null
            ? formatInvoiceNumber(inv.prefix, inv.number).toLowerCase()
            : "draft";
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
          ...toInvoiceView(inv),
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
 * Returns per-currency sums + counts for Draft, Unpaid, Past due, Paid This Month.
 *
 *   Unpaid   = status "invoiced" AND (no dueDate OR dueDate >= today)
 *   Past due = status "invoiced" AND dueDate <  today
 *
 * "Past due" is derived, not stored — server recomputes it each call against
 * today in the org timezone so the counts stay consistent with the badge.
 *
 * Void invoices are historical and excluded from every bucket.
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
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);
    // Current month in org timezone, e.g. "2026-04"
    const currentYearMonth = todayStr.slice(0, 7);

    // Sums run in minor units per currency, converted once for display.
    type Bucket = { count: number; currencySums: Record<string, number> };
    const empty = (): Bucket => ({ count: 0, currencySums: {} });
    const draft = empty();
    const unpaid = empty();
    const pastDue = empty();
    const paidThisMonth = empty();

    function accumulate(bucket: Bucket, inv: Doc<"invoices">) {
      bucket.count += 1;
      bucket.currencySums[inv.currency] =
        (bucket.currencySums[inv.currency] ?? 0) + inv.totalMinor;
    }
    const toDisplay = (bucket: Bucket): Bucket => ({
      count: bucket.count,
      currencySums: Object.fromEntries(
        Object.entries(bucket.currencySums).map(([cur, minor]) => [cur, fromMinor(minor, cur)]),
      ),
    });

    for (const inv of invoices) {
      if (inv.status === "void") continue;

      if (inv.status === "draft") {
        accumulate(draft, inv);
      } else if (inv.status === "invoiced") {
        // Undefined dueDate has no overdue clock — stays in Unpaid.
        if (inv.dueDate == null || inv.dueDate >= todayStr) {
          accumulate(unpaid, inv);
        } else {
          accumulate(pastDue, inv);
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

    // Everything issued and unpaid (unpaid + past due), for the hub summary.
    const outstanding = empty();
    for (const b of [unpaid, pastDue]) {
      outstanding.count += b.count;
      for (const [cur, minor] of Object.entries(b.currencySums)) {
        outstanding.currencySums[cur] = (outstanding.currencySums[cur] ?? 0) + minor;
      }
    }

    return {
      draft: toDisplay(draft),
      unpaid: toDisplay(unpaid),
      pastDue: toDisplay(pastDue),
      outstanding: toDisplay(outstanding),
      paidThisMonth: toDisplay(paidThisMonth),
    };
  },
});

/**
 * Inbox empty-state context — feeds the "All caught up" reward state.
 *
 * Returns the most recent finalized invoice (excluding drafts and voids) so
 * the screen can render "Last invoiced … · INV-… · {clientName}", plus the
 * day count to the next month-close (1-31). Both numbers are scoped to the
 * org timezone — same DST-safe rule that drives `formatLastInvoiced` so the
 * relative "X days ago" reads consistently across the app.
 *
 * Admin-only because the empty state lives on the admin Inbox page (members
 * never see this surface).
 */
export const getInboxEmptyStateContext = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    let last: Doc<"invoices"> | null = null;
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "void") continue;
      if (inv.number == null) continue; // finalized invoices are numbered; belt-and-suspenders
      if (last === null || inv.issueDate > last.issueDate) last = inv;
    }

    let lastInvoice: {
      id: Id<"invoices">;
      prefix: string;
      number: number;
      issueDate: string;
      issueDateTimestamp: number;
      clientName: string;
    } | null = null;
    if (last !== null && last.number != null) {
      const client = await ctx.db.get(last.clientId);
      const clientName =
        client && client.orgId === orgId ? client.name : "Unknown";
      lastInvoice = {
        id: last._id,
        prefix: last.prefix,
        number: last.number,
        issueDate: last.issueDate,
        issueDateTimestamp: Date.parse(last.issueDate + "T00:00:00Z"),
        clientName,
      };
    }

    // Days until the next month-close in org timezone. End-of-month is the
    // last calendar day of `todayStr`'s month — same loop math `getRetainerData`
    // uses, kept here to avoid a cross-file dep for one date calculation.
    const [yStr, mStr] = todayStr.split("-");
    const year = Number(yStr);
    const month = Number(mStr); // 1-12
    const lastDay = new Date(year, month, 0).getDate();
    const todayDay = Number(todayStr.slice(8, 10));
    const daysToNextMonthClose = Math.max(0, lastDay - todayDay);

    return { lastInvoice, daysToNextMonthClose };
  },
});

/**
 * Get invoice metrics for a project — feeds the project's Invoices tab.
 *
 * Three payment-health buckets (all single-currency — project has exactly one
 * currency via the D1 invariant):
 *
 *   unpaid       = status "invoiced" AND (no dueDate OR dueDate >= today)
 *   pastDue      = status "invoiced" AND dueDate <  today
 *   paidLifetime = status "paid" — sum shown as a muted summary line
 *
 * Plus billing-type-specific context:
 *   Fixed    → fixedBilled / fixedRemaining / fixedPercentInvoiced
 *   Retainer → uninvoicedMonths: elapsed, unclosed periods with overage (the
 *              callout links them to the Close workspace)
 *
 * Void invoices are excluded everywhere.
 * "Today" resolved in org timezone so the past-due line matches the badge.
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
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    // Void invoices are historical — excluded from totals and counts so the
    // metric cards reflect the live picture.
    const orgInvoices = invoices.filter((inv) => inv.status !== "void");

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // Money is summed in minor units (one currency per project, D1) and
    // converted once at the end for display.
    const currency = await getProjectCurrency(ctx, project);
    const display = (minor: number) => fromMinor(minor, currency);
    type Bucket = { count: number; amount: number };
    const empty = (): Bucket => ({ count: 0, amount: 0 });
    const unpaid = empty();
    const pastDue = empty();
    const paidLifetime = empty();

    let totalInvoiced = 0;
    // Track the most recent finalized issue date for the "Last invoiced" subline.
    // Drafts don't count — they aren't sent yet. Voids are already excluded.
    let lastInvoicedYMD: string | null = null;
    for (const inv of orgInvoices) {
      totalInvoiced += inv.totalMinor;

      if (inv.status === "invoiced") {
        const overdue = inv.dueDate != null && inv.dueDate < todayStr;
        const bucket = overdue ? pastDue : unpaid;
        bucket.count += 1;
        bucket.amount += inv.totalMinor;
      } else if (inv.status === "paid") {
        paidLifetime.count += 1;
        paidLifetime.amount += inv.totalMinor;
      }
      if (inv.status !== "draft" && (lastInvoicedYMD === null || inv.issueDate > lastInvoicedYMD)) {
        lastInvoicedYMD = inv.issueDate;
      }
    }

    // Fixed Fee: compute billed amount from lineType:"fixed" items only
    // (excludes manual rows so remaining balance stays accurate).
    // Only finalized invoices count — drafts are provisional.
    // `fixedExtraBilled` tracks everything billed BEYOND the fee on those
    // same invoices (manual lines — extra work, adjustments; time lines are
    // $0 on fixed invoices). Two axes: the fee's progress and the extras on
    // top — the Budget card shows both so "100% of fee" can never hide a
    // higher invoiced total.
    let fixedBilled = 0;
    let fixedExtraBilled = 0;
    if (project.billingType === "fixed") {
      for (const inv of orgInvoices) {
        // Drafts are provisional; voids are historical. Neither counts as billed.
        if (inv.status === "draft" || inv.status === "void") continue;
        const items = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of items) {
          if (item.lineType === "fixed") fixedBilled += item.amountMinor;
          else fixedExtraBilled += item.amountMinor;
        }
      }
    }

    const fixedPriceMinor = toMinor(project.fixedPrice ?? 0, currency);

    // Retainer: compute uninvoiced closed months
    type UninvoicedMonth = { year: number; month: number; label: string };
    let uninvoicedMonths: UninvoicedMonth[] = [];
    let uninvoicedOverageTotal = 0;
    if (project.billingType === "retainer") {
      // Elapsed, unclosed periods with overage — priced exactly as the Close
      // queue and `commitClose` price them. A period is listed by its last
      // month (where a cycle bills). The project-level total stays stable
      // across cycle navigation in the UI.
      const c = await loadCloseContext(ctx, orgId, args.projectId);
      const pending = (
        await openElapsedRetainerPeriods(ctx, c, { todayStr, roundingMinutes: 1 })
      ).filter((view) => view.price.overageMinutes > 0);
      uninvoicedMonths = pending.map((view) => ({
        year: Number(view.period.end.slice(0, 4)),
        month: Number(view.period.end.slice(5, 7)),
        label: periodSubjectLabel(view.period.start, view.period.end),
      }));
      uninvoicedOverageTotal = fromMinor(
        pending.reduce((sum, view) => sum + view.price.amountMinor, 0),
        c.currency,
      );
    }

    const bucketView = (b: Bucket): Bucket => ({ count: b.count, amount: display(b.amount) });

    return {
      totalInvoiced: display(totalInvoiced),
      invoiceCount: orgInvoices.length,
      currency,
      // Payment-health buckets (single-currency per D1 invariant)
      unpaid: bucketView(unpaid),
      pastDue: bucketView(pastDue),
      paidLifetime: bucketView(paidLifetime),
      // Fixed Fee specific
      fixedPrice: display(fixedPriceMinor),
      fixedBilled: display(fixedBilled),
      fixedExtraBilled: display(fixedExtraBilled),
      fixedRemaining: display(fixedPriceMinor - fixedBilled),
      fixedPercentInvoiced: fixedPriceMinor > 0
        ? Math.round((fixedBilled / fixedPriceMinor) * 100)
        : 0,
      // Retainer specific — elapsed periods with overage still to close.
      uninvoicedMonths,
      // Project-level overage total across `uninvoicedMonths` (rounded once,
      // currency = project currency by D1 invariant). The InvoiceBanner reads
      // this so the amount it shows matches the action it would take.
      uninvoicedOverageTotal,
      // Latest finalized issueDate as a UTC-midnight ms timestamp (or null).
      // Consumed by the InvoiceBanner subline via `formatLastInvoiced(..., { timezone })`.
      lastInvoicedAt: lastInvoicedYMD ? Date.parse(lastInvoicedYMD + "T00:00:00Z") : null,
    };
  },
});

// ─── Editor Queries ───────────────────────────────────────────────────────────

/**
 * Get a single invoice with all data needed for the editor:
 * line items grouped by category, project info, client info, org brand settings.
 */
export const getInvoice = query({
  // `identifier` is the URL segment. Two accepted forms (decision 2026-05-03):
  //   1. Friendly form, e.g. "INV-035" — primary path; produced by every
  //      internal link via `formatInvoiceNumber(prefix, number)`.
  //   2. Convex doc ID — backwards-compat fallback for bookmarks / pasted
  //      links saved before the URL refactor.
  // The page never has to know which form it received.
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const invoice = await resolveInvoiceByIdentifier(ctx, orgId, args.identifier);
    if (!invoice) return null;

    // Fetch line items (display amounts derived from minor units).
    const lineItems = (
      await ctx.db
        .query("invoiceLineItems")
        .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
        .collect()
    )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((li) => toLineView(li, invoice.currency));

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
      // Only time lines have hour quantities; fixed/overage/manual
      // store amounts or unit counts that must not inflate the hours subtotal.
      if (li.lineType === "time") group.subtotalHours += li.quantity;
    }

    // Round subtotal hours (display only)
    for (const g of grouped) {
      g.subtotalHours = Math.round(g.subtotalHours * 100) / 100;
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

    // Fixed Fee: total billed from lineType:"fixed" items across finalized
    // project invoices only (drafts are provisional).
    let fixedBilledMinor = 0;
    if (project && project.billingType === "fixed") {
      const projectInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", invoice.projectId))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      for (const inv of projectInvoices) {
        if (inv.status === "draft" || inv.status === "void") continue;
        const invItems = await ctx.db
          .query("invoiceLineItems")
          .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const item of invItems) {
          if (item.lineType === "fixed") fixedBilledMinor += item.amountMinor;
        }
      }
    }

    // The close that produced the invoice (absent on fixed-fee invoices):
    // its period, and for a retainer its frozen usage block — same shape as
    // `billingReports.getMonthlyReport`, rendered by the same component.
    const closeRaw = invoice.closeId !== undefined ? await ctx.db.get(invoice.closeId) : null;
    const close = closeRaw && closeRaw.orgId === orgId ? closeRaw : null;
    const view = toInvoiceView(invoice);
    const retainerUsage =
      close && close.kind === "retainer"
        ? await closeRetainerUsage(ctx, close, view.total)
        : null;

    return {
      invoice: view,
      lineItems,
      categoryGroups: grouped,
      orgInvoiceCount: orgInvoiceSample.length,
      fixedBilled: fromMinor(fixedBilledMinor, invoice.currency),
      period: close
        ? {
            start: close.periodStart,
            end: close.periodEnd,
            months: absMonthOf(close.periodEnd) - absMonthOf(close.periodStart) + 1,
          }
        : null,
      retainerUsage,
      project: project
        ? {
            name: project.name,
            billingType: project.billingType,
            fixedPrice: project.fixedPrice,
            monthlyFee: project.monthlyFee,
          }
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
      timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
      // Org-level template surfaces rendered on the invoice document.
      // Bundled with `getInvoice` so the editor doesn't need a second
      // `orgSettings.get` round-trip — same trip-saving as `brand`.
      org: {
        paymentInstructions: orgSettings?.paymentInstructions,
        invoiceMessageTemplate: orgSettings?.invoiceMessageTemplate,
      },
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
 * Update the editable `messageToClient` block on an invoice. Editable on
 * drafts only; finalized, paid, and voided invoices are locked. Trims input; empty (after trim) clears the field.
 */
export const updateInvoiceMessage = mutation({
  args: {
    id: v.id("invoices"),
    messageToClient: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    // Trim first, then validate — a 5001-char input with trailing whitespace
    // that trims to <5000 should be accepted, not rejected.
    const trimmed = args.messageToClient.trim();
    validateStringLength(trimmed, 5000, "Message to client");

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }

    if (invoice.status !== "draft") {
      throw new ConvexError("This invoice's message is locked.");
    }

    await ctx.db.patch(args.id, {
      messageToClient: trimmed === "" ? undefined : trimmed,
      updatedAt: Date.now(),
    });
  },
});

// ─── Lifecycle Mutations ───────────────────────────────────────────────────────
//
// Every status change goes through `lib/billing/invoiceLifecycle` (PRD §8.2):
// it owns the transition table, numbering (N9), the close side-effects and
// the billing event (N10).

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("invoiced"),
  v.literal("paid"),
  v.literal("void"),
);

export const changeInvoiceStatus = mutation({
  args: {
    id: v.id("invoices"),
    newStatus: statusValidator,
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }

    const result = await transitionInvoice(ctx, { orgId, userId }, invoice, args.newStatus);
    if (!result.ok) throw new ConvexError(result.reason);
  },
});

/**
 * Apply a status transition to multiple invoices in one call. Commits
 * succeeded rows even when some fail — matches how the Time-tab bulk
 * billable-toggle surfaces partial success.
 *
 * Returns both lists so the UI can toast "N updated, M failed" with reasons.
 */
export const bulkChangeInvoiceStatus = mutation({
  args: {
    ids: v.array(v.id("invoices")),
    newStatus: statusValidator,
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const succeeded: Id<"invoices">[] = [];
    const failed: { id: Id<"invoices">; reason: string }[] = [];

    for (const id of args.ids) {
      const invoice = await ctx.db.get(id);
      if (!invoice || invoice.orgId !== orgId) {
        failed.push({ id, reason: "Invoice not found." });
        continue;
      }
      const result = await transitionInvoice(ctx, { orgId, userId }, invoice, args.newStatus);
      if (result.ok) {
        succeeded.push(id);
      } else {
        failed.push({ id, reason: result.reason });
      }
    }

    return { succeeded, failed };
  },
});

/**
 * Inbox bulk mark-paid — admin-only, idempotent, returns a `priorStates`
 * snapshot the UI hands to `undoMarkInvoicesPaid` within the 5s undo window.
 *
 * Decision logic (per-row classify + patch outcome) lives in
 * `convex/lib/markPaid.ts` so it can be unit-tested without convex-test.
 *
 * Behavior recap (PRD § Concurrency rules · US 7, 48):
 *   - Already `paid`        → no-op (counted as `updated`, snapshot included).
 *   - `invoiced`            → patch `{status: "paid", paidAt: now}`.
 *   - `draft` / `void`      → skipped with reason (defensive — Inbox only
 *                             surfaces overdue rows, but stale UI state on a
 *                             second tab could include other statuses).
 *   - Cross-tenant / missing → skipped with reason.
 *
 * Last-write wins: no version check on the mark side. The snapshot allows
 * the undo path to detect a race and skip without overwriting.
 */
export const markInvoicesPaid = mutation({
  args: {
    invoiceIds: v.array(v.id("invoices")),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const now = Date.now();

    let updated = 0;
    const priorStates: PriorState[] = [];
    const skipped: { id: Id<"invoices">; reason: string }[] = [];

    for (const id of args.invoiceIds) {
      const invoice = await ctx.db.get(id);
      if (!invoice || invoice.orgId !== orgId) {
        skipped.push({ id, reason: "Invoice not found." });
        continue;
      }
      const outcome = classifyMarkPaid(
        { status: invoice.status, paidAt: invoice.paidAt },
        now,
      );
      if (outcome.kind === "skip") {
        skipped.push({ id, reason: outcome.reason });
        continue;
      }
      priorStates.push({
        id,
        status: outcome.prior.status,
        paidAt: outcome.prior.paidAt,
      });
      updated += 1;
      if (outcome.kind === "patch") {
        // Same lifecycle as `changeInvoiceStatus`, so the paid event (N10)
        // is written exactly once. `paidAt` comes from the lifecycle's `now`.
        const result = await transitionInvoice(ctx, { orgId, userId }, invoice, "paid");
        if (!result.ok) {
          // Should be unreachable — classifyMarkPaid only patches when
          // current=invoiced, and invoiced → paid is in VALID_TRANSITIONS.
          // Treat as skip rather than throw so the rest of the batch ships.
          skipped.push({ id, reason: result.reason });
          updated -= 1;
          priorStates.pop();
        }
      }
      // `noop`: counted in `updated`, no DB write.
    }

    return { updated, skipped, priorStates };
  },
});

/**
 * Inbox undo — reverts a prior `markInvoicesPaid` batch within the 5s window.
 *
 * Skip rule: if an invoice's current status is no longer "paid", another
 * admin (or another tab) transitioned it during our window. Per the PRD we
 * NEVER overwrite their edit — that row is added to `skipped` with a reason
 * the UI surfaces in the toast.
 */
export const undoMarkInvoicesPaid = mutation({
  args: {
    priorStates: v.array(
      v.object({
        id: v.id("invoices"),
        status: v.union(
          v.literal("draft"),
          v.literal("invoiced"),
          v.literal("paid"),
          v.literal("void"),
        ),
        paidAt: v.union(v.number(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const now = Date.now();

    let reverted = 0;
    const skipped: { id: Id<"invoices">; reason: string }[] = [];

    for (const snapshot of args.priorStates) {
      const invoice = await ctx.db.get(snapshot.id);
      if (!invoice || invoice.orgId !== orgId) {
        skipped.push({ id: snapshot.id, reason: "Invoice not found." });
        continue;
      }
      const outcome = classifyUndo(
        { status: invoice.status, paidAt: invoice.paidAt },
        { status: snapshot.status, paidAt: snapshot.paidAt },
      );
      if (outcome.kind === "skip") {
        skipped.push({ id: snapshot.id, reason: outcome.reason });
        continue;
      }
      // Through the lifecycle, like the mark side. In practice undo only
      // reverts paid → invoiced, which clears paidAt (snapshot.paidAt is
      // null then). An idempotent mark (snapshot already "paid") has no
      // transition to undo, so it restores paidAt directly.
      if (outcome.setStatus === invoice.status) {
        // No status change — just restore paidAt from snapshot (covers
        // the idempotent-mark noop revert case).
        await ctx.db.patch(snapshot.id, {
          paidAt: outcome.setPaidAt ?? undefined,
          updatedAt: now,
        });
        reverted += 1;
        continue;
      }
      const result = await transitionInvoice(ctx, { orgId, userId }, invoice, outcome.setStatus);
      if (!result.ok) {
        skipped.push({ id: snapshot.id, reason: result.reason });
        continue;
      }
      reverted += 1;
    }

    return { reverted, skipped };
  },
});

/**
 * Delete a never-numbered DRAFT invoice and release its close (N9, §8.2).
 * A numbered or finalized invoice is voided instead, which keeps the record.
 */
export const deleteInvoice = mutation({
  args: {
    id: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found.");
    }
    await deleteDraftInvoice(ctx, { orgId, userId }, invoice);
  },
});
