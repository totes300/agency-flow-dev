import { Suspense } from "react"
import { TaskView } from "@/components/task-view/task-view"
import { TaskViewSkeleton } from "@/components/task-view/task-view-skeleton"

export default function TasksPage() {
  // The view state lives in the URL (useSearchParams), so the client tree
  // renders below a Suspense boundary.
  return (
    <Suspense fallback={<TaskViewSkeleton />}>
      <TaskView surface="tasks" />
    </Suspense>
  )
}
