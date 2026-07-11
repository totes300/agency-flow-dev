"use client"

import { useSearchParams } from "next/navigation"
import { ThreadView } from "@/components/agents/thread-view"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"

/** Center pane: the URL (`?thread=`) decides empty state vs thread. */
export function ThreadPane() {
  const threadId = useSearchParams().get("thread")
  if (!threadId) return <WorkspaceEmptyState />
  // Remount per thread — no state bleed between conversations.
  return <ThreadView key={threadId} threadId={threadId} />
}
