"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  ChevronLeftIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  AgentBuilderForm,
  type AgentFormInitial,
} from "@/components/agents/builder/agent-builder-form"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/**
 * Manage-agents surface (`?view=agents`, slice 09) — the admin builder's home.
 * `?edit=<id|new>` swaps the list for a full-page form; without it, the list.
 * Admin-gated: members never reach the data queries (server-enforced too).
 */
export function AgentsBuilderView() {
  const { membership } = useOrganization()
  if (membership === undefined) return <BuilderSkeleton />
  if (membership?.role !== "org:admin") return <WorkspaceEmptyState />
  return <BuilderAdmin />
}

function BuilderAdmin() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const edit = searchParams.get("edit")

  function openList() {
    router.push("/agents?view=agents")
  }
  function openEdit(agentId: string) {
    router.push(`/agents?view=agents&edit=${agentId}`)
  }

  if (edit) {
    return <BuilderFormLoader key={edit} edit={edit} onClose={openList} />
  }
  return <AgentList onNew={() => openEdit("new")} onEdit={openEdit} />
}

// ─── List ─────────────────────────────────────────────────────────────────

function AgentList({
  onNew,
  onEdit,
}: {
  onNew: () => void
  onEdit: (agentId: string) => void
}) {
  const agents = useQuery(api.agents.listAll, {})
  const active = agents?.filter((a) => !a.archived) ?? []
  const archived = agents?.filter((a) => a.archived) ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <BotIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Manage agents</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onNew}>
          <PlusIcon className="size-4" />
          New agent
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {agents === undefined ? (
            <AgentListSkeleton />
          ) : agents.length === 0 ? (
            <EmptyState
              icon={BotIcon}
              title="No agents yet"
              description="Agents are configuration, not code: a name, instructions, a whitelist of vetted tools, and who's allowed to run them. Create one to get started."
              action={
                <Button variant="outline" onClick={onNew}>
                  <PlusIcon className="size-4" />
                  Create your first agent
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {active.map((agent) => (
                <AgentRow key={agent._id} agent={agent} onEdit={onEdit} />
              ))}
              {archived.length > 0 && (
                <>
                  <p className="mt-4 px-1 text-xs font-medium text-muted-foreground">
                    Archived
                  </p>
                  {archived.map((agent) => (
                    <AgentRow key={agent._id} agent={agent} onEdit={onEdit} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type AgentListItem = {
  _id: Id<"agents">
  name: string
  description: string
  runPermission: "admins" | "everyone"
  toolCount: number
  skillCount: number
  archived: boolean
}

function AgentRow({
  agent,
  onEdit,
}: {
  agent: AgentListItem
  onEdit: (agentId: string) => void
}) {
  const archive = useMutation(api.agents.archive)
  const restore = useMutation(api.agents.restore)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function confirmArchive() {
    void archive({ agentId: agent._id })
      .then(() => toast.success(`Archived “${agent.name}”`))
      .catch((err) => toastError(err, "Couldn't archive the agent"))
    setConfirmOpen(false)
  }
  function doRestore() {
    void restore({ agentId: agent._id })
      .then(() => toast.success(`Restored “${agent.name}”`))
      .catch((err) => toastError(err, "Couldn't restore the agent"))
  }

  const meta = [
    agent.runPermission === "admins" ? "Admins only" : "Everyone",
    `${agent.toolCount} ${agent.toolCount === 1 ? "tool" : "tools"}`,
    agent.skillCount > 0 &&
      `${agent.skillCount} ${agent.skillCount === 1 ? "skill" : "skills"}`,
  ].filter(Boolean)

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border p-3",
        agent.archived && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{agent.name}</p>
        {agent.description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
            {agent.description}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {meta.join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {agent.archived ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            onClick={doRestore}
            title="Restore agent"
          >
            <ArchiveRestoreIcon className="size-4" />
          </Button>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => onEdit(agent._id)}
              title="Edit agent"
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
              title="Archive agent"
            >
              <ArchiveIcon className="size-4" />
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{agent.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from everyone&apos;s rail and can&apos;t start new
              runs. Its existing threads stay readable, and you can restore it
              anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Form loader ────────────────────────────────────────────────────────────

/**
 * Loads the reference data (tool catalog + skills) and, for edit, the agent's
 * config, then mounts the keyed form once everything is present — so the form
 * initializes from real values with no effect-driven state sync.
 */
function BuilderFormLoader({
  edit,
  onClose,
}: {
  edit: string
  onClose: () => void
}) {
  const isNew = edit === "new"
  const catalog = useQuery(api.agents.toolCatalog)
  const skills = useQuery(api.skills.list)
  const agent = useQuery(
    api.agents.getForEdit,
    isNew ? "skip" : { agentId: edit },
  )

  const loading =
    catalog === undefined ||
    skills === undefined ||
    (!isNew && agent === undefined)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onClose}
          title="Back to agents"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <span className="text-sm font-medium">
          {isNew ? "New agent" : (agent?.name ?? "Edit agent")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FormSkeleton />
        ) : !isNew && agent === null ? (
          <EmptyState
            icon={BotIcon}
            title="Agent not found"
            description="It may have been removed. Go back to the list."
            action={<Button variant="outline" onClick={onClose}>Back</Button>}
          />
        ) : (
          <AgentBuilderForm
            agentId={isNew ? null : (agent!._id as Id<"agents">)}
            initial={
              isNew
                ? null
                : ({
                    name: agent!.name,
                    description: agent!.description,
                    instructions: agent!.instructions,
                    tools: agent!.tools,
                    skillIds: agent!.skillIds,
                    runPermission: agent!.runPermission,
                    model: agent!.model,
                    examplePrompts: agent!.examplePrompts,
                  } satisfies AgentFormInitial)
            }
            catalog={catalog!}
            skills={skills!.map((s) => ({
              _id: s._id,
              name: s.name,
              scope: s.scope,
              clientName: s.clientName,
            }))}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

// ─── Skeletons (content-aware) ──────────────────────────────────────────────

function AgentListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-lg border p-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

function BuilderSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <AgentListSkeleton />
      </div>
    </div>
  )
}
