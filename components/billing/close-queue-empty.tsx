import Link from "next/link"
import { CheckCircle2Icon, SearchXIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

/**
 * Close-tab end states (PRD UX Decisions → States):
 *   - `caught-up`: nothing to close this month — the celebratory reward state,
 *     no primary CTA, just a quiet link to Drafts.
 *   - `no-matches`: facet filters hid every row — offers a clear-filters path.
 */
export function CloseQueueEmpty({
  reason,
  onClearFilters,
}: {
  reason: "caught-up" | "no-matches"
  onClearFilters?: () => void
}) {
  return (
    <div className="flex items-center justify-center py-16">
      {reason === "caught-up" ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title="All caught up"
          description="Nothing to close this month. New closable periods appear here as they end."
          action={
            <Button variant="ghost" asChild>
              <Link href="/billing?status=draft">View drafts</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title="No periods match your filters"
          description="Try clearing or adjusting the filters to see more periods."
          action={
            onClearFilters ? (
              <Button variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
