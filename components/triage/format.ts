/** Small display helpers of the Triage screen (B8b). */

const DAY_MS = 24 * 60 * 60 * 1000

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** List time: "9:42" today, "Yesterday", else "Oct 18" (the year when not this year). */
export function formatRowTime(ms: number, now: number = Date.now()): string {
  const d = new Date(ms)
  const today = new Date(now)
  if (sameDay(d, today)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (sameDay(d, new Date(now - DAY_MS))) return "Yesterday"
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  })
}

/** Email header time: "Today, 9:42 AM", "Yesterday, 5:20 PM", "Sat, Oct 18, 9:42 AM". */
export function formatEmailTime(ms: number, now: number = Date.now()): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (sameDay(d, new Date(now))) return `Today, ${time}`
  if (sameDay(d, new Date(now - DAY_MS))) return `Yesterday, ${time}`
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time}`
}

/** "Mon, Oct 20, 9:00 AM" for a snooze end. */
export function formatSnoozeUntil(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

/** A sender as shown: the name, else the address. */
export function senderLabel(sender: { name: string | null; email: string } | null): string {
  if (!sender) return "Unknown sender"
  return sender.name ?? sender.email
}
