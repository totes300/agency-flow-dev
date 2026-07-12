"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import {
  BotIcon,
  ClipboardListIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceSwitch } from "@/components/workspace-switch"
import { AgentsRailEmptyState } from "@/components/agents/agents-rail-empty-state"
import { ThreadsRailEmptyState } from "@/components/agents/threads-rail-empty-state"
import { formatRelativeTime } from "@/lib/format"
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
 * Workspace left rail (final form, slice 02): workspace switch on top,
 * pinned Agents section (runnable-only per user), title-search over the
 * user's Recent threads, and an admin-only "+ New agent" placeholder in
 * the footer (the builder page arrives in slice 09). Clicking an agent
 * opens the new-chat state (`?agent=`); threads are only created on the
 * first send. Selection persists in the URL per the app convention;
 * the search text is ephemeral rail chrome, so it stays local.
 */
export function WorkspaceRail() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeThreadId = searchParams.get("thread")
  const activeAgentId = searchParams.get("agent")
  const activeView = searchParams.get("view")

  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"

  const agents = useQuery(api.agents.listRunnable)
  const threads = useQuery(api.agentThreads.listMine)

  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const filteredThreads = threads?.filter(
    (t) => query === "" || t.title.toLowerCase().includes(query),
  )

  function openAgent(agentId: Id<"agents">) {
    router.push(`/agents?agent=${agentId}`)
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
            <AgentsRailEmptyState
              onCreate={
                isAdmin
                  ? () => router.push("/agents?view=agents&edit=new")
                  : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <button
                  key={agent._id}
                  type="button"
                  onClick={() => openAgent(agent._id)}
                  className={cn(
                    railRowClass,
                    agent._id === activeAgentId &&
                      !activeThreadId &&
                      "bg-sidebar-accent font-medium",
                  )}
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
          {threads === undefined || filteredThreads === undefined ? (
            <RailRowSkeletons count={4} />
          ) : threads.length === 0 ? (
            <ThreadsRailEmptyState />
          ) : (
            <>
              <div className="relative mb-1">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search threads…"
                  className="h-7 border-none bg-sidebar-accent/50 pl-7 text-sm shadow-none placeholder:text-sidebar-foreground/40"
                />
              </div>
              {filteredThreads.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-sidebar-foreground/50">
                  No matching threads.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredThreads.map((thread) => (
                    <button
                      key={thread._id}
                      type="button"
                      onClick={() =>
                        router.push(`/agents?thread=${thread._id}`)
                      }
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
            </>
          )}
        </section>
      </div>
      {/* Footer: Connectors is per-user (everyone); the builder/skills
          entries are admin-only. */}
      <div className="flex flex-col gap-0.5 border-t p-2">
        <button
          type="button"
          onClick={() => router.push("/agents?view=connectors")}
          className={cn(
            railRowClass,
            activeView === "connectors" && "bg-sidebar-accent font-medium",
          )}
        >
          <PlugIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
          Connectors
        </button>
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => router.push("/agents?view=agents")}
              className={cn(
                railRowClass,
                activeView === "agents" && "bg-sidebar-accent font-medium",
              )}
            >
              <BotIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
              Manage agents
            </button>
            <button
              type="button"
              onClick={() => router.push("/agents?view=skills")}
              className={cn(
                railRowClass,
                activeView === "skills" && "bg-sidebar-accent font-medium",
              )}
            >
              <SparklesIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
              Skills
            </button>
            <button
              type="button"
              onClick={() => router.push("/agents?view=audit")}
              className={cn(
                railRowClass,
                activeView === "audit" && "bg-sidebar-accent font-medium",
              )}
            >
              <ClipboardListIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
              Audit
            </button>
            <button
              type="button"
              onClick={() => router.push("/agents?view=agents&edit=new")}
              className={railRowClass}
            >
              <PlusIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
              New agent
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
