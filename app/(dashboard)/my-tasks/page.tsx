import { Suspense } from "react"
import type { Metadata } from "next"
import { TaskView } from "@/components/task-view/task-view"
import { TaskViewSkeleton } from "@/components/task-view/task-view-skeleton"

export const metadata: Metadata = {
  title: "My Tasks",
}

export default function MyTasksPage() {
  // My Tasks = the task view on the "myTasks" surface: Today | Assigned |
  // Created + saved views, `?tab=` in the URL (docs/prd-tasks-refactor.md §6.1).
  return (
    <Suspense fallback={<TaskViewSkeleton />}>
      <TaskView surface="myTasks" />
    </Suspense>
  )
}
