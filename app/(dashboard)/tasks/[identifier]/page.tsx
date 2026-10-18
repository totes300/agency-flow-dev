import { TaskDetailPage } from "@/components/task-detail/task-detail-page"

/**
 * The full task page (docs/prd-tasks-refactor.md §6.1): `/tasks/ARLO-21`.
 * Old identifiers resolve through the alias table and are rewritten to the
 * current one on the client (the task is read through Convex auth there).
 */
export default async function TaskPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return <TaskDetailPage identifier={decodeURIComponent(identifier)} />
}
