import type { Metadata } from "next"
import { CheckSquareIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = {
  title: "Tasks",
}

export default function TasksPage() {
  return (
    <EmptyState
      icon={CheckSquareIcon}
      title="No tasks yet"
      description="Tasks will appear here once projects are set up."
    />
  )
}
