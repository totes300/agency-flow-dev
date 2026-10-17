/**
 * Money and minute rounding — the ONE place billing math rounds.
 *
 * docs/prd-billing-refactor.md §7 (pricing and rounding policy). Every module
 * that prices time imports from here; private `round2` / `roundMinutesUp`
 * copies are not allowed (there used to be 11 + 6 of them).
 *
 * Two generations live here while the refactor is in flight:
 *   - Legacy currency-unit helpers (`round2`) for the existing engines, which
 *     store amounts as decimal currency units.
 *   - Minor-unit helpers (`toMinor`, `fromMinor`, `priceMinutesMinor`) for the
 *     close-entity pricing module (slices 2–3), which stores integer cents.
 * The legacy helpers are deleted with the old engines (slice 5).
 */

// ─── Minute rounding ─────────────────────────────────────────────────────────

/**
 * Round minutes UP to the next `increment` (T&M line rounding). An increment
 * of 1 or less leaves the minutes untouched — the ledger is already whole
 * minutes, and retainer math always passes 1 (raw).
 */
export function ceilToIncrement(minutes: number, increment: number): number {
  if (increment <= 1) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

// ─── Legacy: decimal currency units ──────────────────────────────────────────

/** Round a decimal currency amount to cents (legacy engines only). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Minor units ─────────────────────────────────────────────────────────────

/**
 * ISO 4217 minor-unit exponents that differ from the default of 2. HUF is 2
 * in ISO 4217; whether invoices round it to whole forints is an open owner /
 * accountant decision (PRD §13) and would be a display-precision rule, not a
 * storage change.
 */
const EXPONENT_OVERRIDES: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/** Number of decimal places of `currency`'s minor unit. */
export function currencyExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

/**
 * Round half away from zero to an integer. `Math.round` rounds -0.5 toward
 * +∞, which would price a credit differently from the matching charge.
 */
export function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Decimal currency amount → integer minor units. */
export function toMinor(amount: number, currency: string): number {
  return roundHalfUp(amount * 10 ** currencyExponent(currency));
}

/** Integer minor units → decimal currency amount (for display and legacy APIs). */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

/**
 * Price `minutes` at an hourly rate given in minor units. One multiplication,
 * one rounding — never via rounded hours (the B1 defect).
 */
export function priceMinutesMinor(minutes: number, rateMinorPerHour: number): number {
  return roundHalfUp((minutes * rateMinorPerHour) / 60);
}

/**
 * `minutes` at a DECIMAL hourly rate (project config), priced exactly like a
 * close prices it — rate to minor units, one multiplication, one rounding —
 * and returned as a decimal display amount. For read surfaces that show what
 * a close will bill (overage due, open T&M amount) without committing one.
 */
export function priceMinutesDisplay(minutes: number, rate: number, currency: string): number {
  return fromMinor(priceMinutesMinor(minutes, toMinor(rate, currency)), currency);
}
