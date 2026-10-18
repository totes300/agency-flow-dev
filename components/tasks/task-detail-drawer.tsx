/**
 * Compatibility re-export: the task drawer moved to
 * `components/task-detail/task-detail-drawer.tsx` (tasks refactor slice 6).
 * Same props (`taskIds`, `isAdmin`, optional `identifierOf`); it still opens
 * from `?detail=<taskId>` (canonicalised to `?task=<identifier>`).
 */
export { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
