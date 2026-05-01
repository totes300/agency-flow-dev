import { CalendarDaysIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export function WorkdayEmptyState({
  title = "No work logged this week",
  description = "Time entries logged this week will appear here.",
}: {
  title?: string
  description?: string
} = {}) {
  return (
    <div className="flex min-h-[280px] items-center justify-center px-4 py-10">
      <EmptyState icon={CalendarDaysIcon} title={title} description={description} />
    </div>
  )
}
