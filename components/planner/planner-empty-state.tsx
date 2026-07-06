import { CalendarRangeIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export function PlannerEmptyState({
  title = "Nothing planned yet",
  description = "The Planner shows who works on what, on which day. Scheduled tasks will appear here as bars.",
}: {
  title?: string
  description?: string
} = {}) {
  return (
    <div className="flex min-h-[280px] items-center justify-center px-4 py-10">
      <EmptyState icon={CalendarRangeIcon} title={title} description={description} />
    </div>
  )
}
