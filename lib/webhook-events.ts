/**
 * Webhook event types (= activity types, docs/prd-agent-first-backlog.md W2)
 * grouped into the families the Settings → Webhooks picker shows, with a
 * short label each. Pure; `convex/__tests__/webhooks.test.ts` checks that the
 * families cover every deliverable type exactly once.
 */
import type { ActivityType } from "../convex/tasks/model"

export type WebhookEventFamily = {
  key: string
  label: string
  types: readonly ActivityType[]
}

export const WEBHOOK_EVENT_LABELS: Record<ActivityType, string> = {
  task_created: "Task created",
  subtask_created: "Sub-task created",
  subtask_completed: "Sub-task completed",
  subtask_deleted: "Sub-task deleted",
  status_changed: "Status changed",
  assignee_added: "Assignee added",
  assignee_removed: "Assignee removed",
  label_added: "Label added",
  label_removed: "Label removed",
  title_changed: "Title changed",
  category_changed: "Category changed",
  priority_changed: "Priority changed",
  due_date_changed: "Due date changed",
  start_date_changed: "Start date changed",
  estimate_changed: "Estimate changed",
  project_changed: "Project changed",
  billable_changed: "Billable changed",
  identifier_changed: "Key changed",
  task_archived: "Archived",
  task_restored: "Restored",
  comment_added: "Comment added",
  comment_resolved: "Comment resolved",
  comment_reopened: "Comment reopened",
  time_entry_logged: "Time logged",
  time_entry_edited: "Time edited",
  time_entry_deleted: "Time deleted",
  description_changed: "Description changed",
}

/** Families in picker order. `description_changed` is legacy (never written), so it is not offered. */
export const WEBHOOK_EVENT_FAMILIES: readonly WebhookEventFamily[] = [
  { key: "status", label: "Status", types: ["status_changed"] },
  { key: "comments", label: "Comments", types: ["comment_added", "comment_resolved", "comment_reopened"] },
  { key: "assignees", label: "Assignees", types: ["assignee_added", "assignee_removed"] },
  {
    key: "task",
    label: "Task details",
    types: [
      "task_created",
      "title_changed",
      "due_date_changed",
      "start_date_changed",
      "priority_changed",
      "estimate_changed",
      "label_added",
      "label_removed",
      "category_changed",
      "project_changed",
      "billable_changed",
      "identifier_changed",
      "subtask_created",
      "subtask_completed",
      "subtask_deleted",
      "task_archived",
      "task_restored",
    ],
  },
  { key: "time", label: "Time", types: ["time_entry_logged", "time_entry_edited", "time_entry_deleted"] },
]

export const WEBHOOK_PICKER_TYPES: readonly ActivityType[] = WEBHOOK_EVENT_FAMILIES.flatMap((f) => f.types)

/** A stored event type's label; "test" and unknown types fall back to readable text. */
export function webhookEventLabel(type: string): string {
  if (type === "test") return "Test event"
  return WEBHOOK_EVENT_LABELS[type as ActivityType] ?? type.replace(/_/g, " ")
}

/** "All events", or the chosen labels: up to two, then "+N". */
export function summarizeEventTypes(types: readonly string[] | null): string {
  if (types === null) return "All events"
  const labels = types.map(webhookEventLabel)
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`
}
