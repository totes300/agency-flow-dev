"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { BotIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceSwitch } from "@/components/workspace-switch"
import { AgentsRailEmptyState } from "@/components/agents/agents-rail-empty-state"
import { ThreadsRailEmptyState } from "@/components/agents/threads-rail-empty-state"
import { formatRelativeTime } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

function RailSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground/70">
      {children}
    </div>
  )
}

/** Content-aware loading rows for a rail section (icon + text line). */
function RailRowSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

const railRowClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm " +
  "text-sidebar-foreground hover:bg-sidebar-accent transition-colors"

/**
 * Workspace left rail — the primary navigation of the Agents workspace:
 * workspace switch on top, pinned Agents section (runnable-only per user),
 * then the user's Recent threads, newest activity first. Thread selection
 * persists in the URL (`?thread=`), per the app's URL-state convention.
 */
export function WorkspaceRail() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeThreadId = searchParams.get("thread")

  const agents = useQuery(api.agents.listRunnable)
  const threads = useQuery(api.agentThreads.listMine)
  const createThread = useMutation(api.agentThreads.create)

  function startChat(agentId: Id<"agents">) {
    void createThread({ agentId })
      .then((threadId) => router.push(`/agents?thread=${threadId}`))
      .catch((err) => toastError(err, "Couldn't start a new chat"))
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="p-2">
        <WorkspaceSwitch />
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4">
        <section>
          <RailSectionLabel>Agents</RailSectionLabel>
          {agents === undefined ? (
            <RailRowSkeletons count={2} />
          ) : agents.length === 0 ? (
            <AgentsRailEmptyState />
          ) : (
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <button
                  key={agent._id}
                  type="button"
                  onClick={() => startChat(agent._id)}
                  className={railRowClass}
                  title={agent.description}
                >
                  <BotIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
                  <span className="truncate">{agent.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section>
          <RailSectionLabel>Recent threads</RailSectionLabel>
          {threads === undefined ? (
            <RailRowSkeletons count={4} />
          ) : threads.length === 0 ? (
            <ThreadsRailEmptyState />
          ) : (
            <div className="flex flex-col gap-0.5">
              {threads.map((thread) => (
                <button
                  key={thread._id}
                  type="button"
                  onClick={() => router.push(`/agents?thread=${thread._id}`)}
                  className={cn(
                    railRowClass,
                    thread._id === activeThreadId &&
                      "bg-sidebar-accent font-medium",
                  )}
                >
                  <BotIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-xs text-sidebar-foreground/50">
                    {formatRelativeTime(thread.lastActivityAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
