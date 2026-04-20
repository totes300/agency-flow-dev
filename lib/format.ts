/** Check if two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

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
 * Return the currency key with the largest summed value in a `{ [currency]: sum }`
 * map, or `undefined` if the map is empty. Used to decide which currency to
 * show as the "headline" when a metric bucket spans multiple currencies.
 */
export function pickPrimaryCurrency(sums: Record<string, number>): string | undefined {
  let best: string | undefined
  let bestSum = -Infinity
  for (const [currency, sum] of Object.entries(sums)) {
    if (sum > bestSum) {
      best = currency
      bestSum = sum
    }
  }
  return best
}

/**
 * Format a metric bucket that aggregates sums across one or more currencies.
 * Returns `undefined` when the bucket is empty (let the caller decide whether
 * to hide the detail slot or show a fallback). Single-currency buckets show
 * just the formatted amount; multi-currency buckets show the primary amount
 * plus a "+N more" suffix. Used by the invoices metric cards today and any
 * future reporting surface with the same shape.
 */
export function formatCurrencyBucketDetail(
  sums: Record<string, number>,
): string | undefined {
  const currencies = Object.keys(sums)
  const primary = pickPrimaryCurrency(sums)
  if (!primary) return undefined
  const main = formatCurrency(sums[primary], primary)
  if (currencies.length === 1) return main
  return `${main} · +${currencies.length - 1} more`
}

/**
 * Format minutes as compact "Xh Ym" (e.g., for stats rows).
 *   0 → "0h 0m", 90 → "1h 30m", 60 → "1h 0m", 59 → "0h 59m"
 */
export function formatHoursCompact(minutes: number): string {
  const negative = minutes < 0
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${negative ? "-" : ""}${h}h ${m}m`
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
 * Format an invoice number with prefix and zero-padded number.
 * e.g., ("INV-", 3) → "INV-003"
 */
export function formatInvoiceNumber(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(3, "0")}`
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

/**
 * Nullable overload of `formatDateToYMD` — most date-picker bindings accept
 * `Date | undefined`, so this saves the caller from writing the ternary.
 */
export function formatDateToYMDOrUndefined(date: Date | undefined): string | undefined {
  return date ? formatDateToYMD(date) : undefined
}

/**
 * Parse a YYYY-MM-DD string into a local-timezone Date (midnight local).
 * Returns `undefined` for empty/undefined input. Counterpart to
 * `formatDateToYMDOrUndefined` for date-picker value round-trips.
 */
export function parseYMDToLocalDate(str: string | undefined): Date | undefined {
  if (!str) return undefined
  const [y, m, d] = str.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Format a YYYY-MM-DD string as US-style MM/DD/YYYY (table cell display).
 */
export function formatDateToUS(dateStr: string): string {
  const [y, m, d] = dateStr.split("-")
  return `${m}/${d}/${y}`
}

/** Format a timestamp as relative time (e.g., "2m ago", "3h ago", "5d ago"). */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Format a YYYY-MM-DD date string as short display (e.g., "Mar 20"). */
export function formatShortDate(dateStr: string, locale = "en-US"): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" })
}

/** Format a YYYY-MM-DD date string for invoice display (e.g., "Mar 20, 2026"). */
export function formatInvoiceDate(dateStr: string, locale = "en-US"): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Format a date range for time log task rows.
 * Same day: "Mar 15". Same month: "Mar 8–15". Cross-month: "Feb 28 – Mar 5".
 */
export function formatDateRange(firstDate: string, lastDate: string, locale = "en-US"): string {
  if (firstDate === lastDate) return formatShortDate(firstDate, locale)

  const f = new Date(firstDate + "T00:00:00")
  const l = new Date(lastDate + "T00:00:00")

  if (f.getMonth() === l.getMonth() && f.getFullYear() === l.getFullYear()) {
    // Same month: "Mar 8–15"
    const month = f.toLocaleDateString(locale, { month: "short" })
    return `${month} ${f.getDate()}–${l.getDate()}`
  }

  // Cross-month: "Feb 28 – Mar 5"
  return `${formatShortDate(firstDate, locale)} – ${formatShortDate(lastDate, locale)}`
}

/** Extract up to 2 initials from a name string. Returns "?" for empty/missing names. */
export function getInitials(name: string | undefined | null): string {
  if (!name) return "?"
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  return initials || "?"
}

/** Extract the first name from a full name string. */
export function firstName(name: string): string {
  return name.split(/\s+/)[0]
}

/** Check if a YYYY-MM-DD date string is before today. */
export function isOverdue(dueDate: string | undefined | null, now: Date = new Date()): boolean {
  if (!dueDate) return false
  return dueDate < formatDateToYMD(now)
}

/**
 * Format a timestamp in ClickUp style:
 * < 1 min:   "Just now"
 * < 60 min:  "5 mins"
 * Today:     "Today at 2:30 pm"
 * Yesterday: "Yesterday at 8:36 pm"
 * Older:     "Mar 15 at 10:00 am"
 */
export function formatActivityTimestamp(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`

  const eventDate = new Date(timestamp)
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)

  const timeStr = eventDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase()

  if (isSameDay(eventDate, today)) return `Today at ${timeStr}`
  if (isSameDay(eventDate, yesterday)) return `Yesterday at ${timeStr}`

  const dateStr = eventDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${dateStr} at ${timeStr}`
}

/**
 * Get the Monday–Sunday bounds of a week, offset by N weeks from current.
 * offset=0 → this week, offset=-1 → last week
 */
export function getWeekBounds(offset: number, now: Date = new Date()): { start: string; end: string } {
  now = new Date(now) // clone to avoid mutation
  const day = now.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: formatDateToYMD(monday), end: formatDateToYMD(sunday) }
}

/** Simple pluralization: returns singular when n===1, plural otherwise. */
export function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/**
 * Format a time range for activity batches.
 * Same minute: "Mar 22 at 8:30 am"
 * Same day:    "Mar 22, 8:30–9:21 am" (or "8:30 am–12:08 pm" if am/pm differs)
 * Cross-day:   "Mar 22, 8:30 am – Mar 23, 2:15 pm"
 */
export function formatBatchTimeRange(startMs: number, endMs: number): string {
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true }
  const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }

  const s = new Date(startMs)
  const e = new Date(endMs)

  const sTime = s.toLocaleTimeString("en-US", timeFmt).toLowerCase()
  const eTime = e.toLocaleTimeString("en-US", timeFmt).toLowerCase()
  const sDate = s.toLocaleDateString("en-US", dateFmt)
  const eDate = e.toLocaleDateString("en-US", dateFmt)

  // Same minute → single timestamp
  if (Math.abs(endMs - startMs) < 60_000) {
    return `${sDate} at ${sTime}`
  }

  // Different days
  if (!isSameDay(s, e)) {
    return `${sDate}, ${sTime} – ${eDate}, ${eTime}`
  }

  // Same day — check if am/pm matches to omit the first one
  const sPeriod = sTime.slice(-2) // "am" or "pm"
  const ePeriod = eTime.slice(-2)
  if (sPeriod === ePeriod) {
    // Strip period from start: "8:30 am" → "8:30"
    const sTimeShort = sTime.slice(0, -3)
    return `${sDate}, ${sTimeShort}–${eTime}`
  }

  return `${sDate}, ${sTime}–${eTime}`
}

/** Return the client's prefix or full name depending on the `usePrefix` setting. */
export function getClientDisplayName(client: { name: string; prefix?: string; usePrefix?: boolean }): string {
  return client.usePrefix && client.prefix ? client.prefix : client.name
}

// Re-export duration formatters for discoverability
export { formatDuration, formatTimerDisplay } from "@/lib/duration"
