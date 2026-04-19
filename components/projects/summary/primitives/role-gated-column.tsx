import { EyeOffIcon } from "lucide-react"
import { SummaryColumn } from "./summary-column"

/**
 * Placeholder column for admin-only metrics when viewed by a member.
 * Convex strips the payload for non-admins (see `computeFixedSummary` /
 * `computeTmSummary` / `computeRetainerSummary`); this component renders the
 * fallback state consistently wherever that gate applies.
 *
 * Visual weight is deliberately tuned to match a populated column (4 metric
 * rows at roughly ~28px each + header). A muted panel with a large quiet icon
 * keeps the summary card visually balanced instead of leaving a thin
 * one-line gap next to dense sibling columns.
 */
export function RoleGatedColumn({ title }: { title: string }) {
  return (
    <SummaryColumn title={title}>
      <div
        role="note"
        aria-label={`${title} hidden`}
        className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-md bg-muted/40 p-4 text-center"
      >
        <EyeOffIcon
          aria-hidden
          className="size-5 text-muted-foreground/60"
        />
        <p className="text-xs text-muted-foreground">
          {title} is hidden for your role.
        </p>
      </div>
    </SummaryColumn>
  )
}
