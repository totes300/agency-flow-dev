import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { type AuthContext, getAuthContext, requireAdmin } from "./lib/auth";
import {
  computeCycleOverageContext,
  computePeriodOverageContext,
  getCyclePeriods,
} from "./lib/retainerCycle";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";

// ─── Queries ────────────────────────────────────────────────────────────────

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    const periods = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    return periods.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  },
});

// ─── Period boundary helpers (pure) ─────────────────────────────────────────

/**
 * Validate a YYYY-MM-01 string and derive the matching last-of-month date.
 *
 * Exported as a pure helper so the close mutations can accept the natural
 * UI key (`periodStart`) without re-deriving year/month/last-day arithmetic
 * in three places.
 */
export function periodBoundsFromStart(periodStart: string): {
  year: number;
  month: number; // 1-indexed
  periodStart: string;
  periodEnd: string;
} {
  const m = periodStart.match(/^(\d{4})-(\d{2})-01$/);
  if (!m) {
    throw new ConvexError(
      "periodStart must be the first day of a month in YYYY-MM-01 format.",
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000) throw new ConvexError("Year must be >= 2000.");
  if (month < 1 || month > 12) throw new ConvexError("Month must be 1-12.");

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, periodStart, periodEnd };
}

// ─── Close-gate predicates (pure) ───────────────────────────────────────────
//
// Extracted from `closePeriod` so the gating rules are unit-testable
// without spinning up Convex. The wrapper mutation just composes:
//   load period → fetch overage context → fetch overlapping invoices
//   → evaluateCloseGate() → settle if allowed.

export type InvoiceLikeForCloseGate = {
  status: "draft" | "invoiced" | "paid" | "void";
  periodStart?: string;
  periodEnd?: string;
};

/**
 * Does any non-void invoice's `[periodStart, periodEnd]` overlap the
 * period being closed? An open / draft invoice overlapping the range means
 * a billing flow is already in motion for these hours — closing as
 * "covered by retainer fee" would orphan the draft and silently zero out
 * revenue. Belt-and-suspenders on top of the overage check.
 *
 * Voids don't count — they freed their period (matches the convention in
 * `getRetainerData` and `getInvoiceAnchorMonthKey`).
 */
export function findConflictingInvoice<T extends InvoiceLikeForCloseGate>(
  invoices: readonly T[],
  period: { periodStart: string; periodEnd: string },
): T | null {
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    if (!inv.periodStart || !inv.periodEnd) continue;
    // Overlap test: [a,b] overlaps [c,d] iff a ≤ d AND c ≤ b.
    if (inv.periodStart <= period.periodEnd && period.periodStart <= inv.periodEnd) {
      return inv;
    }
  }
  return null;
}

export type CloseGateInput = {
  isOverageDue: boolean;
  conflictingInvoice: { status: string } | null;
};

export type CloseGateResult =
  | { allowed: true }
  | { allowed: false; message: string };

const OVERAGE_BLOCK_MESSAGE =
  "This period has overage that must be invoiced before it can be closed. " +
  "Create the overage invoice first.";

// Plural counterpart for `closeRetainerCycle` — the user remediation is
// still "create the overage invoice first", but the unit of overage is the
// CYCLE, not a single month. Distinct wording so the toast actually maps
// to the action the admin took (clicking `Close cycle`, not `Close`).
const CYCLE_OVERAGE_BLOCK_MESSAGE =
  "This cycle has overage that must be invoiced before it can be closed.";

const DRAFT_INVOICE_BLOCK_MESSAGE =
  "An invoice already covers this period. " +
  "Void or finalize that invoice before closing the period.";

const CYCLE_DRAFT_INVOICE_BLOCK_MESSAGE =
  "An invoice already covers part of this cycle. " +
  "Void or finalize that invoice before closing the cycle.";

/**
 * The two-gate close rule, as a pure decision.
 *
 *   gate 1 (overage): `isOverageDue` from `computePeriodOverageContext`.
 *     - For non-rollover months: any negative end balance is due.
 *     - For rollover monthly periods: NEVER due (cycle handles overage at
 *       cycle end), so monthly close succeeds even mid-cycle.
 *   gate 2 (invoice conflict): any non-void invoice overlapping the
 *     period's date range.
 *
 * Overage wins precedence — its remediation ("Create the overage invoice
 * first") is the action the user must take.
 */
export function evaluateCloseGate(input: CloseGateInput): CloseGateResult {
  if (input.isOverageDue) {
    return { allowed: false, message: OVERAGE_BLOCK_MESSAGE };
  }
  if (input.conflictingInvoice !== null) {
    return { allowed: false, message: DRAFT_INVOICE_BLOCK_MESSAGE };
  }
  return { allowed: true };
}

/**
 * Cycle-level counterpart for `closeRetainerCycle`. Same two-gate shape
 * as `evaluateCloseGate`, but the messages are scoped to the cycle so the
 * remediation copy matches the action the admin attempted.
 *
 * Overage precedence still wins for the same reason as the monthly gate:
 * the user's next correct action is "create the overage invoice first",
 * not "void the conflicting draft invoice".
 */
export function evaluateCycleCloseGate(input: CloseGateInput): CloseGateResult {
  if (input.isOverageDue) {
    return { allowed: false, message: CYCLE_OVERAGE_BLOCK_MESSAGE };
  }
  if (input.conflictingInvoice !== null) {
    return { allowed: false, message: CYCLE_DRAFT_INVOICE_BLOCK_MESSAGE };
  }
  return { allowed: true };
}

// ─── Entry-eligibility predicates (pure) ────────────────────────────────────

export type EntryEligibilityShape = {
  date: string;
  // Optional (not `T | undefined`) so the predicate accepts both unit-test
  // fixtures and live `Doc<"timeEntries">` rows where these fields are
  // declared as `v.optional(...)`.
  settledAt?: number;
  invoiceId?: Id<"invoices">;
};

/**
 * Is this entry one that `closePeriod` should newly settle?
 *   - falls inside the period's date range,
 *   - not already settled (no `settledAt`),
 *   - not already invoice-linked (`invoiceId` would mean it belongs to a
 *     billed flow; closing as `retainer_included` would mis-classify it).
 */
export function shouldSettleEntry(
  entry: EntryEligibilityShape,
  period: { periodStart: string; periodEnd: string },
): boolean {
  if (entry.date < period.periodStart || entry.date > period.periodEnd) {
    return false;
  }
  if (entry.settledAt !== undefined) return false;
  if (entry.invoiceId !== undefined) return false;
  return true;
}

export type ReopenEligibilityShape = {
  settledReason?: "invoiced" | "retainer_included" | "fixed_included";
  settledPeriodStart?: string;
  settledPeriodEnd?: string;
};

/**
 * Is this entry one that `reopenPeriod` should unsettle?
 *
 * Match on the per-monthly boundary triple `(reason, start, end)`. This is
 * the criterion that makes per-month reopen safe even after Slice 4's
 * cycle close: a cycle close writes the monthly boundary on each entry
 * (not the cycle boundary), so reopening March specifically reverses
 * exactly the March entries — never February's or April's.
 */
export function shouldReopenEntry(
  entry: ReopenEligibilityShape,
  period: { periodStart: string; periodEnd: string },
): boolean {
  return (
    entry.settledReason === "retainer_included" &&
    entry.settledPeriodStart === period.periodStart &&
    entry.settledPeriodEnd === period.periodEnd
  );
}

// ─── DB-backed helpers (called from mutations) ──────────────────────────────

type AnyMutationCtx = GenericMutationCtx<DataModel>;

/**
 * Shared upsert: find-or-insert the `retainerPeriods` row for
 * `(projectId, periodStart)`. Returns the doc (whether pre-existing or
 * newly inserted).
 *
 * Why this exists (Revision Pass #8): the Monthly Breakdown is computed
 * from date math in `getRetainerData` — most displayed months have no
 * `retainerPeriods` row. `closePeriod` must accept the natural UI key
 * (`projectId + periodStart`) and create the row on demand inside the
 * mutation, never assuming the row already exists. The public `ensure`
 * mutation now delegates here so the two paths can't drift.
 */
export async function ensureRetainerPeriodInternal(
  ctx: AnyMutationCtx,
  authCtx: AuthContext,
  project: Doc<"projects">,
  periodStart: string,
): Promise<Doc<"retainerPeriods">> {
  const bounds = periodBoundsFromStart(periodStart);

  const existing = await ctx.db
    .query("retainerPeriods")
    .withIndex("by_projectId_periodStart", (q) =>
      q.eq("projectId", project._id).eq("periodStart", bounds.periodStart),
    )
    .first();
  if (existing) return existing;

  const now = Date.now();
  const id = await ctx.db.insert("retainerPeriods", {
    orgId: authCtx.orgId,
    projectId: project._id,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    createdAt: now,
    updatedAt: now,
    createdBy: authCtx.userId,
  });
  const inserted = await ctx.db.get(id);
  if (!inserted) {
    // Defensive — Convex's insert-then-get round-trip should never fail.
    throw new ConvexError("Failed to load freshly-inserted retainer period.");
  }
  return inserted;
}

/**
 * Shared body of `closePeriod`. Extracted so Slice 4's `closeRetainerCycle`
 * can reuse it verbatim (it closes each of the cycle's N monthly periods
 * with the same `closedAt` timestamp).
 *
 * Caller is responsible for guard checks (overage / invoice conflict) —
 * the cycle path runs its OWN cycle-level overage check via
 * `computeCycleOverageContext` instead of the per-month one.
 *
 * Walks tasks → entries fan-out. Acknowledged N+1; same pattern Slice 2
 * uses in `convex/lib/retainerCycle.ts:sumBillableMinutes`. A `projectId`
 * denormalization on `timeEntries` is the perf-driven follow-up.
 */
export async function closePeriodInternal(
  ctx: AnyMutationCtx,
  authCtx: AuthContext,
  period: Doc<"retainerPeriods">,
  /**
   * Optional shared timestamp. `closeRetainerCycle` passes one value to
   * close all N monthly periods so they end up with identical `closedAt`
   * (the cycle-close fingerprint per parent PRD § "Rollover cycle close").
   * Defaults to `Date.now()` for `closePeriod`'s single-month path.
   */
  now: number = Date.now(),
): Promise<{ settledCount: number }> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", authCtx.orgId).eq("projectId", period.projectId),
    )
    .collect();

  let settledCount = 0;

  for (const task of tasks) {
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .collect();
    for (const e of entries) {
      // Tenancy belt — `by_taskId` doesn't narrow by orgId.
      if (e.orgId !== authCtx.orgId) continue;
      if (!shouldSettleEntry(e, period)) continue;

      await ctx.db.patch(e._id, {
        settledAt: now,
        settledReason: "retainer_included",
        settledPeriodStart: period.periodStart,
        settledPeriodEnd: period.periodEnd,
        updatedAt: now,
      });
      settledCount++;
    }
  }

  await ctx.db.patch(period._id, {
    closedAt: now,
    closedBy: authCtx.userId,
    updatedAt: now,
  });

  return { settledCount };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Legacy entrypoint kept for any existing `(year, month)` callers (e.g.
 * `retainerCron.ts`). New code should call `closePeriod` directly, which
 * accepts `periodStart` and ensure-then-closes in one round-trip.
 */
export const ensure = mutation({
  args: {
    projectId: v.id("projects"),
    year: v.number(),
    month: v.number(), // 1-indexed (January = 1)
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) {
      throw new ConvexError("Project not found");
    }
    if (project.billingType !== "retainer") {
      throw new ConvexError("Not a retainer project");
    }

    if (!Number.isInteger(args.year) || args.year < 2000) {
      throw new ConvexError("Year must be an integer >= 2000");
    }
    if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12) {
      throw new ConvexError("Month must be an integer between 1 and 12");
    }

    const periodStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const period = await ensureRetainerPeriodInternal(
      ctx,
      authCtx,
      project,
      periodStart,
    );
    return period._id;
  },
});

/**
 * Admin-only: close a retainer month so its within-budget hours stop
 * appearing as "open / needs billing" in stats and filters.
 *
 * Two-gate flow (see `evaluateCloseGate`):
 *   1. Reject if the period has overage that should be on an invoice
 *      (non-rollover only — rollover monthly overage is cycle-level).
 *   2. Reject if a non-void invoice already covers the date range
 *      (belt-and-suspenders against orphaning a draft invoice).
 *
 * On success: every billable AND non-billable entry in range that is
 * neither already-settled nor invoice-linked gets `settledAt` +
 * `settledReason: "retainer_included"` + the monthly period boundary
 * stamped. Non-billable entries are part of the client-facing report and
 * are intentionally also locked (decision table item).
 */
export const closePeriod = mutation({
  args: {
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-01
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) {
      throw new ConvexError("Project not found.");
    }
    if (project.billingType !== "retainer") {
      throw new ConvexError("Not a retainer project.");
    }

    // Gate -1 — rollover projects don't support monthly close. Their billing
    // unit is the CYCLE, not the month, and admin-closing a mid-cycle month
    // settles its entries as `retainer_included` — which then HIDES those
    // hours from the cycle's overage computation in `createInvoice`
    // (filtered by `settledAt === undefined`). The result: a real cycle
    // overage looks like "no overage" and the cycle invoice can't be
    // generated. Slice 3's allowance for mid-cycle monthly close was a
    // design oversight — there is no legitimate use case (post-cycle-
    // invoice the entries are locked via `invoiceId` anyway; pre-invoice
    // it breaks billing). The only valid rollover close path is
    // `closeRetainerCycle` on a within-budget cycle (Slice 4).
    if (project.rolloverEnabled) {
      throw new ConvexError(
        "Monthly close is not available on rollover projects. " +
          "Use \"Close cycle\" on the cycle-end row instead — it bulk-closes " +
          "all months together once the cycle is within budget.",
      );
    }

    const period = await ensureRetainerPeriodInternal(
      ctx,
      authCtx,
      project,
      args.periodStart,
    );
    if (period.closedAt !== undefined) {
      throw new ConvexError("Period is already closed.");
    }

    // Gate 0 — calendar-ended check. Backend defense against a stale browser
    // tab calling close on a still-running month: locking mid-month would
    // stamp every same-month entry `retainer_included` and any new entry
    // inside the (now-closed) range would be rejected by
    // `assertEntryDateOpen`. Recovery is a per-month manual reopen — costly.
    {
      const orgSettings = await getOrgSettings(ctx, authCtx.orgId);
      const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
      const todayStr = getDateInTimezone(Date.now(), timezone);
      if (period.periodEnd >= todayStr) {
        throw new ConvexError(
          "This period hasn't ended yet. Wait until the month closes before locking it.",
        );
      }
    }

    // Gate 1 — overage. `computePeriodOverageContext` encodes the
    // rollover-vs-non-rollover rule (Slice 2): rollover monthly is NEVER
    // overage-due at the monthly level, so this gate passes mid-cycle. The
    // cycle-level gate is Slice 4's `closeRetainerCycle`.
    const overageContext = await computePeriodOverageContext(
      ctx,
      project,
      period,
    );

    // Gate 2 — non-void invoice overlapping the period range.
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), authCtx.orgId))
      .collect();
    const conflictingInvoice = findConflictingInvoice(projectInvoices, period);

    const gate = evaluateCloseGate({
      isOverageDue: overageContext.isOverageDue,
      conflictingInvoice,
    });
    if (!gate.allowed) {
      throw new ConvexError(gate.message);
    }

    return await closePeriodInternal(ctx, authCtx, period);
  },
});

/**
 * Admin-only: undo `closePeriod` on a single month.
 *
 * Reverses entries by the per-month-boundary triple `(settledReason ==
 * "retainer_included", settledPeriodStart, settledPeriodEnd)` so the
 * reverse set is unambiguous even after Slice 4's cycle close has written
 * the same `closedAt` across N monthly periods.
 *
 * Clears `closedAt`/`closedBy` on the period row so the Monthly
 * Breakdown's lifecycle pill flips back to `open`. The row itself is kept
 * (not deleted) so any audit-trail follow-up can still find it.
 */
export const reopenPeriod = mutation({
  args: {
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-01
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) {
      throw new ConvexError("Project not found.");
    }
    if (project.billingType !== "retainer") {
      throw new ConvexError("Not a retainer project.");
    }

    const period = await ensureRetainerPeriodInternal(
      ctx,
      authCtx,
      project,
      args.periodStart,
    );
    if (period.closedAt === undefined) {
      throw new ConvexError("Period is not closed.");
    }

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", authCtx.orgId).eq("projectId", project._id),
      )
      .collect();

    const now = Date.now();
    let reopenedCount = 0;

    for (const task of tasks) {
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .collect();
      for (const e of entries) {
        if (e.orgId !== authCtx.orgId) continue;
        if (!shouldReopenEntry(e, period)) continue;

        await ctx.db.patch(e._id, {
          settledAt: undefined,
          settledReason: undefined,
          settledPeriodStart: undefined,
          settledPeriodEnd: undefined,
          updatedAt: now,
        });
        reopenedCount++;
      }
    }

    await ctx.db.patch(period._id, {
      closedAt: undefined,
      closedBy: undefined,
      updatedAt: now,
    });

    return { reopenedCount };
  },
});

// ─── Cycle close (Slice 4) ──────────────────────────────────────────────────

/**
 * Admin-only: close every month of a rollover retainer cycle in one
 * action. Bulk-applies `closePeriodInternal` to each of the cycle's N
 * monthly periods so they all carry an identical `closedAt` (the
 * cycle-close fingerprint per parent PRD § Mutations).
 *
 * Critical invariant — entries keep their MONTHLY boundary on
 * `settledPeriodStart/End`, NOT the cycle boundary. This is what makes
 * Slice 3's `reopenPeriod` unambiguous after a cycle close: reopening
 * March alone reverses exactly the March entries via the per-month
 * boundary triple, never touching February or April. The parent PRD
 * § "Rollover cycle close" calls this out as load-bearing.
 *
 * Rejects on cycle-level overage via `computeCycleOverageContext` (Slice
 * 2). For rollover projects this is the real billing-due check — the
 * monthly overage gate is intentionally lenient because rollover overage
 * settles at cycle end, not per month.
 */
export const closeRetainerCycle = mutation({
  args: {
    projectId: v.id("projects"),
    cycleStart: v.string(), // YYYY-MM-01 — first month of the cycle
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) {
      throw new ConvexError("Project not found.");
    }
    if (project.billingType !== "retainer") {
      throw new ConvexError("Not a retainer project.");
    }
    if (!project.rolloverEnabled) {
      throw new ConvexError(
        "closeRetainerCycle only applies to rollover retainer projects.",
      );
    }
    if (!project.startDate || !project.cycleLength) {
      throw new ConvexError("Project is missing rollover configuration.");
    }

    // Validate `cycleStart` shape early; bounds derived for the conflict-
    // invoice query below.
    const cycleStartBounds = periodBoundsFromStart(args.cycleStart);

    // Resolve the N monthly periods that belong to this cycle. We compute
    // the cycle offset relative to "today in the org's timezone" so the
    // result lines up with `getRetainerData`'s view of the same cycle.
    const orgSettings = await getOrgSettings(ctx, authCtx.orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const startMonths =
      Number(project.startDate.slice(0, 4)) * 12 +
      Number(project.startDate.slice(5, 7)) -
      1;
    const cycleStartMonths =
      cycleStartBounds.year * 12 + cycleStartBounds.month - 1;
    const cycleOffsetFromStart =
      (cycleStartMonths - startMonths) / project.cycleLength;
    if (!Number.isInteger(cycleOffsetFromStart) || cycleOffsetFromStart < 0) {
      throw new ConvexError(
        "cycleStart does not align to a cycle boundary for this project.",
      );
    }

    const todayMonths =
      Number(todayStr.slice(0, 4)) * 12 +
      Number(todayStr.slice(5, 7)) -
      1;
    const currentCycleIndex = Math.max(
      0,
      Math.floor((todayMonths - startMonths) / project.cycleLength),
    );
    const cycleOffset = cycleOffsetFromStart - currentCycleIndex;

    const cycle = getCyclePeriods({
      startDate: project.startDate,
      cycleLength: project.cycleLength,
      todayStr,
      cycleOffset,
    });
    if (!cycle) {
      throw new ConvexError("Requested cycle is before the project start.");
    }

    // Gate 0 — calendar-ended check. Backend defense against a stale
    // browser tab calling close on a still-running cycle: locking N months
    // mid-cycle would stamp every entry logged so far `retainer_included`
    // and any new entry inside the (now-closed) cycle would be rejected by
    // `assertEntryDateOpen`. Recovery is a per-month manual reopen across
    // all N months — costly. `getCyclePeriods` already computed this from
    // the same `todayStr` the UI's `decideRetainerRowCloseAction` uses.
    if (!cycle.isCycleClosed) {
      throw new ConvexError(
        "This cycle hasn't ended yet. Wait until the cycle closes before locking it.",
      );
    }

    // Gate 1 — cycle-level overage. Per `computeCycleOverageContext`
    // (Slice 2), the rollover-cycle mode returns `isOverageDue: true` iff
    // the cycle's aggregate worked minutes exceed its aggregate budget.
    const overageContext = await computeCycleOverageContext(
      ctx,
      project,
      cycle.periods,
    );

    // Gate 2 — non-void invoice overlapping ANY month in the cycle.
    // Reuses the monthly overlap predicate against the full cycle range
    // so a draft retainer invoice spanning the cycle (or a one-off
    // invoice covering one month inside it) blocks the close.
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), authCtx.orgId))
      .collect();
    const conflictingInvoice = findConflictingInvoice(projectInvoices, {
      periodStart: cycle.cycleStart,
      periodEnd: cycle.cycleEnd,
    });

    const gate = evaluateCycleCloseGate({
      isOverageDue: overageContext.isOverageDue,
      conflictingInvoice,
    });
    if (!gate.allowed) {
      throw new ConvexError(gate.message);
    }

    // Shared `now` so all N monthly periods receive identical `closedAt`
    // — the fingerprint that lets the UI group them as "Q1 2026 cycle
    // closed Apr 1 by Adam" via equality on `closedAt`.
    const now = Date.now();

    let settledCount = 0;
    for (const monthlyPeriod of cycle.periods) {
      const period = await ensureRetainerPeriodInternal(
        ctx,
        authCtx,
        project,
        monthlyPeriod.periodStart,
      );
      // Skip months that are already admin-closed (idempotent re-runs +
      // partial-recovery scenarios where an earlier cycle-close attempt
      // closed some months before erroring). `closePeriodInternal` itself
      // is a no-op on already-closed entries, but skipping the patch on
      // an already-closed period row avoids bumping its `updatedAt`.
      if (period.closedAt !== undefined) continue;
      const result = await closePeriodInternal(ctx, authCtx, period, now);
      settledCount += result.settledCount;
    }

    return { closedPeriods: cycle.periods.length, settledCount };
  },
});
