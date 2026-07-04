import { ArchiveIcon, InboxIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export function InboxEmptyState({
  view = "inbox",
}: {
  view?: "inbox" | "archived"
}) {
  if (view === "archived") {
    return (
      <EmptyState
        icon={ArchiveIcon}
        title="Nothing archived"
        description="Notifications you archive will be kept here."
      />
    )
  }
  return (
    <EmptyState
      icon={InboxIcon}
      title="You're all caught up"
      description="Mentions, assignments, and comments on your tasks will show up here."
    />
  )
}
