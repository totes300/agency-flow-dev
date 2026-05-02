/**
 * Pure copy/layout derivation for `<InvoiceBanner>`. Lives outside the
 * component so the wording can be unit-tested without React or Convex.
 *
 * Returns the rendered strings + tone hints for the 4 banner kinds. The
 * component itself only handles layout, icon, modal, and click handling.
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
      uninvoicedAmount: number
      uninvoicedMinutes: number
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
      kind: "retainer-cycle-closed"
      cycleLabel: string
      closedAt: number
      usedMinutes: number
      budgetMinutes: number
      overageDue: number
      withinBudget: boolean
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
        title: `Uninvoiced balance · ${formatMinutes(state.uninvoicedMinutes)}`,
        subline: lastInvoicedSubline(state.lastInvoicedAt),
        amount: formatCurrencyPrecise(state.uninvoicedAmount, currency),
        amountLabel: "unbilled",
        amountTone: "neutral",
        labelTone: "muted",
      }

    case "retainer-monthly": {
      const hasOverage = state.overageDue > 0
      return {
        title:
          state.readyMonthCount === 1
            ? "1 month ready to bill"
            : `${state.readyMonthCount} months ready to bill`,
        subline: join([lastInvoicedSubline(state.lastInvoicedAt), `${state.readyMonthsLabel} ready`]),
        amount: formatCurrencyPrecise(hasOverage ? state.overageDue : 0, currency),
        amountLabel: hasOverage ? "overage" : "within budget",
        amountTone: hasOverage ? "warn" : "neutral",
        labelTone: hasOverage ? "muted" : "ok",
      }
    }

    case "retainer-cycle-closed": {
      const closedPhrase = formatLastInvoiced(state.closedAt, { timezone })
      const overSegment = state.withinBudget
        ? null
        : `${formatMinutes(state.usedMinutes - state.budgetMinutes)} over`
      return {
        title: `${state.cycleLabel} cycle closed`,
        subline: join([
          closedPhrase ? `Closed ${closedPhrase}` : null,
          overSegment,
          `${formatMinutes(state.usedMinutes)} / ${formatMinutes(state.budgetMinutes)} used`,
        ]),
        amount: formatCurrencyPrecise(state.overageDue, currency),
        amountLabel: state.withinBudget ? "within budget" : "overage",
        amountTone: state.withinBudget ? "neutral" : "warn",
        labelTone: state.withinBudget ? "ok" : "muted",
      }
    }
  }
}
