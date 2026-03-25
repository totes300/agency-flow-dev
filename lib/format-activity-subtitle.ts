import { formatRelativeTime } from "@/lib/format";

export function formatActivitySubtitle(
  lastActivity: {
    userName: string;
    type: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  } | null
): string {
  if (!lastActivity) return "Created";
  const { userName, type, metadata, createdAt } = lastActivity;
  const first = userName.split(" ")[0];
  const time = formatRelativeTime(createdAt);

  switch (type) {
    case "status_changed":
      return `${first} changed status to ${metadata.to} \u00b7 ${time}`;
    case "comment_added":
      return `${first} commented \u00b7 ${time}`;
    case "time_entry_logged":
      return `${first} logged ${metadata.duration} \u00b7 ${time}`;
    case "subtask_completed":
      return `${first} completed ${metadata.title} \u00b7 ${time}`;
    case "subtask_created":
      return `${first} created subtask \u00b7 ${time}`;
    case "assignee_added":
      return `${first} assigned ${metadata.userName} \u00b7 ${time}`;
    case "assignee_removed":
      return `${first} unassigned ${metadata.userName} \u00b7 ${time}`;
    case "due_date_changed":
      return metadata.to
        ? `${first} set due date \u00b7 ${time}`
        : `${first} removed due date \u00b7 ${time}`;
    case "task_created":
      return `${first} created this task \u00b7 ${time}`;
    case "description_changed":
      return `${first} updated description \u00b7 ${time}`;
    default:
      return `${first} updated \u00b7 ${time}`;
  }
}
