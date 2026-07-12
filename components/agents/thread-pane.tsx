"use client"

import { useSearchParams } from "next/navigation"
import { ThreadView } from "@/components/agents/thread-view"
import { NewChatView } from "@/components/agents/new-chat-view"
import { SkillsView } from "@/components/agents/skills/skills-view"
import { AgentsBuilderView } from "@/components/agents/builder/agents-builder-view"
import { ConnectorsView } from "@/components/agents/connectors/connectors-view"
import { AgentAuditView } from "@/components/agents/audit/agent-audit-view"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"

/**
 * Center pane: the URL decides. `?thread=` resumes a conversation,
 * `?agent=` shows the new-chat state (thread created on first send),
 * `?view=skills` opens the admin skills surface, `?view=agents` the admin
 * builder, `?view=connectors` the per-user connectors surface, neither → the
 * generic workspace empty state.
 */
export function ThreadPane() {
  const searchParams = useSearchParams()
  const threadId = searchParams.get("thread")
  const agentId = searchParams.get("agent")
  const view = searchParams.get("view")
  // Remount per thread/agent — no state bleed between conversations.
  if (threadId) return <ThreadView key={threadId} threadId={threadId} />
  if (agentId) return <NewChatView key={agentId} agentId={agentId} />
  if (view === "skills") return <SkillsView />
  if (view === "agents") return <AgentsBuilderView />
  if (view === "connectors") return <ConnectorsView />
  if (view === "audit") return <AgentAuditView />
  return <WorkspaceEmptyState />
}
