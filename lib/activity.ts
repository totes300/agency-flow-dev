/**
 * Pure utility functions for activity feed rendering.
 * Extracted for testability.
 */

// ─── Activity event display ─────────────────────────────────────────────────────

export type ActivityEventType =
  | "task_created"
  | "status_changed"
  | "assignee_added"
  | "assignee_removed"
  | "category_changed"
  | "due_date_changed"
  | "project_changed"
  | "billable_changed"
  | "subtask_created"
  | "subtask_completed"
  | "subtask_deleted"
  | "time_entry_logged"
  | "time_entry_edited"
  | "time_entry_deleted"
  | "comment_added"

/**
 * Format an activity event into a human-readable description.
 * Returns { text, highlight } where highlight is the key changed value (for badges/bold).
 */
export function formatActivityText(
  type: ActivityEventType,
  userName: string,
  metadata: Record<string, unknown>
): { text: string; highlight?: string } {
  switch (type) {
    case "task_created":
      return { text: `${userName} created this task` }

    case "status_changed":
      return {
        text: `${userName} changed status to`,
        highlight: metadata.to as string,
      }

    case "assignee_added":
      return {
        text: `${userName} assigned`,
        highlight: metadata.userName as string,
      }

    case "assignee_removed":
      return {
        text: `${userName} unassigned`,
        highlight: metadata.userName as string,
      }

    case "category_changed":
      return {
        text: `${userName} changed category to`,
        highlight: metadata.to as string,
      }

    case "due_date_changed": {
      const to = metadata.to as string | null
      if (!to) return { text: `${userName} removed the due date` }
      // Format YYYY-MM-DD to readable date
      const formatted = formatDueDate(to)
      return { text: `${userName} set due date to`, highlight: formatted }
    }

    case "project_changed": {
      const to = metadata.to as string | null
      if (!to) return { text: `${userName} removed from project` }
      return { text: `${userName} moved to project`, highlight: to }
    }

    case "billable_changed":
      return {
        text: `${userName} marked as`,
        highlight: metadata.to ? "Billable" : "Non-billable",
      }

    case "subtask_created":
      return {
        text: `${userName} created subtask`,
        highlight: metadata.title as string,
      }

    case "subtask_completed":
      return {
        text: `${userName} completed`,
        highlight: metadata.title as string,
      }

    case "subtask_deleted":
      return {
        text: `${userName} deleted subtask`,
        highlight: metadata.title as string,
      }

    case "time_entry_logged":
      return {
        text: `${userName} logged`,
        highlight: metadata.duration as string,
      }

    case "time_entry_edited":
      return {
        text: `${userName} edited time entry`,
        highlight: `${metadata.oldDuration} → ${metadata.newDuration}`,
      }

    case "time_entry_deleted":
      return {
        text: `${userName} deleted time entry`,
        highlight: metadata.duration as string,
      }

    case "comment_added":
      return { text: `${userName} commented` }

    default:
      return { text: `${userName} updated the task` }
  }
}

/**
 * Get the icon type for an activity event.
 */
export function getActivityIcon(type: ActivityEventType): "status" | "user" | "check" | "time" | "comment" | "default" {
  switch (type) {
    case "status_changed":
      return "status"
    case "assignee_added":
    case "assignee_removed":
      return "user"
    case "subtask_completed":
    case "subtask_created":
    case "subtask_deleted":
      return "check"
    case "time_entry_logged":
    case "time_entry_edited":
    case "time_entry_deleted":
      return "time"
    case "comment_added":
      return "comment"
    default:
      return "default"
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Format a YYYY-MM-DD string to a readable date like "Mar 23" */
function formatDueDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00")
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  } catch {
    return dateStr
  }
}
