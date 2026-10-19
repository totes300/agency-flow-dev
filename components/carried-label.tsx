/**
 * Inline "carried · May 2026" label — dot + muted text, never a pill.
 *
 * Marks a time entry that belongs to an earlier month but is billed in the
 * current close (skipped forward, or logged after that month closed). Shared
 * by the Close workspace ledger rows and its group headers (label promotion).
 */
export function CarriedLabel({
  reason,
  monthLabel,
}: {
  reason: "skipped" | "logged-late"
  monthLabel: string
}) {
  const title =
    reason === "skipped"
      ? `Skipped from ${monthLabel} — carried into this close`
      : `Logged after ${monthLabel} closed — carried into this close`
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
      title={title}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />
      carried · {monthLabel}
    </span>
  )
}
