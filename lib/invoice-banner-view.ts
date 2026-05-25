/**
 * Pure copy/layout derivation for `<InvoiceBanner>`. Lives outside the
 * component so the wording can be unit-tested without React or Convex.
 *
 * Returns the rendered strings + tone hints for the 4 banner kinds. The
 * component itself only handles layout, icon, modal, and click handling.
 *
 * The retainer banner has TWO kinds — `retainer-monthly` (non-rollover, per-
 * month overage) and `retainer-cycle` (rollover, per-cycle overage). They
 * share the visual treatment but use different vocabulary so the title
 * matches the unit of billing (a month vs. a cycle).
 */

import { formatCurrencyPrecise, formatLastInvoiced, formatMinutes } from "@/lib/format"

export type InvoiceBannerState =
  | {
      kind: "fixed"
      remaining: number
      lastInvoicedAt: number | null
      daysSinceLastInvoice: number | null
      percentBilled: number
    }
  | {
      kind: "tm"
      // Phase 8 — was `uninvoiced*`; renamed to `open*` to match the new
      // entry-display vocabulary (open / draft / closed / non_billable).
      openAmount: number
      openMinutes: number
      lastInvoicedAt: number | null
      daysSinceLastInvoice: number | null
    }
  | {
      kind: "retainer-monthly"
      readyMonthCount: number
      readyMonthsLabel: string
      overageDue: number
      lastInvoicedAt: number | null
      targetYear: number
      targetMonth: number
    }
  | {
      kind: "retainer-cycle"
      readyCycleCount: number
      // Cycle-end month labels of every ready cycle, joined by " & " or ", ".
      // Example: "Apr 2026" or "Apr 2026 & Jul 2026". The cycle-end month
      // identifies the cycle; the user reads context from the project type
      // (subtitle says "3-month rollover").
      readyCyclesLabel: string
      overageDue: number
      lastInvoicedAt: number | null
      // Target = cycle-end month (the row `createInvoice` keys on for cycle
      // invoices). Same target shape as `retainer-monthly` so the click
      // handler's `generate({ retainerYear, retainerMonth })` works
      // identically — the backend resolves "this month" vs "this cycle"
      // from the project's rolloverEnabled.
      targetYear: number
      targetMonth: number
    }

export type InvoiceBannerView = {
  title: string
  subline: string | null
  amount: string
  amountLabel: string
  amountTone: "warn" | "neutral"
  labelTone: "muted" | "ok"
}

export function deriveInvoiceBannerView(
  state: InvoiceBannerState,
  currency: string,
  timezone: string,
): InvoiceBannerView {
  const lastInvoicedSubline = (ts: number | null) => {
    const phrase = formatLastInvoiced(ts, { timezone })
    return phrase ? `Last invoiced ${phrase}` : null
  }
  const join = (parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null

  switch (state.kind) {
    case "fixed":
      return {
        title: "Remaining to invoice",
        subline: join([
          lastInvoicedSubline(state.lastInvoicedAt),
          state.percentBilled > 0 ? `${state.percentBilled}% of contract billed` : null,
        ]),
        amount: formatCurrencyPrecise(state.remaining, currency),
        amountLabel: "remaining",
        amountTone: "neutral",
        labelTone: "muted",
      }

    case "tm":
      return {
        title: `Open balance · ${formatMinutes(state.openMinutes)}`,
        subline: lastInvoicedSubline(state.lastInvoicedAt),
        amount: formatCurrencyPrecise(state.openAmount, currency),
        amountLabel: "unbilled",
        amountTone: "neutral",
        labelTone: "muted",
      }

    case "retainer-monthly": {
      // Invariant: the banner only fires when there are uninvoiced over-budget
      // months — `metrics.uninvoicedMonths` is filtered to `endBalance < 0`
      // (`convex/invoices.ts:getClosedUninvoicedMonths`) and the caller
      // returns null on empty. By construction `overageDue` is therefore
      // > 0 here. We keep a defensive log in dev because if it ever flips
      // to 0, the banner is structurally lying — `Generate invoice` would
      // create a $0 draft and confuse the admin. There is no "within
      // budget" branch: a within-budget period is NOT something to bill,
      // it's something to close (and close lives on the Monthly Breakdown
      // row, not in a banner — closes aren't time-sensitive, cash flow is).
      if (process.env.NODE_ENV !== "production" && state.overageDue <= 0) {
        console.error(
          `[InvoiceBanner] retainer-monthly state has overageDue=${state.overageDue}. ` +
            `Banner should only fire for over-budget uninvoiced months. ` +
            `Check getClosedUninvoicedMonths filtering and metrics plumbing.`,
        )
      }
      return {
        title:
          state.readyMonthCount === 1
            ? "1 month ready to bill"
            : `${state.readyMonthCount} months ready to bill`,
        subline: join([lastInvoicedSubline(state.lastInvoicedAt), `${state.readyMonthsLabel} ready`]),
        amount: formatCurrencyPrecise(state.overageDue, currency),
        amountLabel: "overage",
        amountTone: "warn",
        labelTone: "muted",
      }
    }

    case "retainer-cycle": {
      // Mirrors `retainer-monthly` — same invariant (banner only fires when
      // cycleBalance < 0 across the cycle), same dev-build invariant log,
      // same visual treatment. Difference: the unit is the CYCLE, so the
      // title says "cycle" instead of "month". A rollover overage cycle is
      // exactly as billable-attention-worthy as a non-rollover overage
      // month — same cash-flow urgency, same Generate flow.
      if (process.env.NODE_ENV !== "production" && state.overageDue <= 0) {
        console.error(
          `[InvoiceBanner] retainer-cycle state has overageDue=${state.overageDue}. ` +
            `Banner should only fire for over-budget uninvoiced cycles. ` +
            `Check getClosedUninvoicedMonths (rollover branch) and metrics plumbing.`,
        )
      }
      return {
        title:
          state.readyCycleCount === 1
            ? "1 cycle ready to bill"
            : `${state.readyCycleCount} cycles ready to bill`,
        subline: join([lastInvoicedSubline(state.lastInvoicedAt), `${state.readyCyclesLabel} ready`]),
        amount: formatCurrencyPrecise(state.overageDue, currency),
        amountLabel: "overage",
        amountTone: "warn",
        labelTone: "muted",
      }
    }

  }
}
