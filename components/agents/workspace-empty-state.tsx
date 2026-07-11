import { BotIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

/** Center-pane empty state when no thread is open (first-run, slice 00). */
export function WorkspaceEmptyState() {
  return (
    <EmptyState
      icon={BotIcon}
      title="Agents workspace"
      description="Pick an agent in the rail to start a conversation. Your recent threads will live there too."
    />
  )
}
