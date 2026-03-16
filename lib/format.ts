const formatterCache = new Map<string, Intl.NumberFormat>()

function getCurrencyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}-${fractionDigits}`
  let fmt = formatterCache.get(key)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
      formatterCache.set(key, fmt)
    } catch {
      return new Intl.NumberFormat("en-US") // fallback, don't cache
    }
  }
  return fmt
}

/**
 * Format a number as currency using the project's/client's currency code.
 * Falls back gracefully for unknown currency codes.
 */
export function formatCurrency(amount: number, currency: string): string {
  return getCurrencyFormatter(currency, 0).format(amount)
}

/**
 * Format a number as currency with cents (2 decimal places).
 */
export function formatCurrencyPrecise(amount: number, currency: string): string {
  return getCurrencyFormatter(currency, 2).format(amount)
}

/**
 * Format minutes as HH:MM display string.
 * e.g., 630 → "10:30", 90 → "01:30", 0 → "00:00"
 */
export function formatMinutes(minutes: number): string {
  const negative = minutes < 0
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const formatted = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  return negative ? `-${formatted}` : formatted
}

/**
 * Format a Date object as YYYY-MM-DD string.
 */
export function formatDateToYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
