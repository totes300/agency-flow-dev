"use client"

import { useSearchParams } from "next/navigation"
import { ThreadView } from "@/components/agents/thread-view"
import { NewChatView } from "@/components/agents/new-chat-view"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"

/**
 * Center pane: the URL decides. `?thread=` resumes a conversation,
 * `?agent=` shows the new-chat state (thread created on first send),
 * neither → the generic workspace empty state.
 */
export function ThreadPane() {
  const searchParams = useSearchParams()
  const threadId = searchParams.get("thread")
  const agentId = searchParams.get("agent")
  // Remount per thread/agent — no state bleed between conversations.
  if (threadId) return <ThreadView key={threadId} threadId={threadId} />
  if (agentId) return <NewChatView key={agentId} agentId={agentId} />
  return <WorkspaceEmptyState />
}
