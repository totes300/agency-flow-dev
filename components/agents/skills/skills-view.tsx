"use client"

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { OctagonXIcon, PencilIcon, PlusIcon, SparklesIcon } from "lucide-react"
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
  SkillFormModal,
  type SkillDraft,
} from "@/components/agents/skills/skill-form-modal"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/**
 * Skills admin surface (`?view=skills`, slice 04). Minimal CRUD +
 * agent-attachment — final placement polish waits for the builder area
 * (slice 09). Admin-gated: members never reach the data query.
 */
export function SkillsView() {
  const { membership } = useOrganization()
  if (membership === undefined) return <SkillsViewSkeleton />
  // Members can't build skills (US 48) — degrade to the generic state.
  if (membership?.role !== "org:admin") return <WorkspaceEmptyState />
  return <SkillsAdmin />
}

function SkillsAdmin() {
  const skills = useQuery(api.skills.list)
  const agents = useQuery(api.agents.listWithSkills)
  const clients = useQuery(api.clients.list, {})

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SkillDraft | null>(null)

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(skill: SkillDraft) {
    setEditing(skill)
    setFormOpen(true)
  }

  const clientOptions = (clients ?? []).map((c) => ({ _id: c._id, name: c.name }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Skills</span>
        </div>
        <Button size="sm" variant="ghost" onClick={openCreate}>
          <PlusIcon className="size-4" />
          New skill
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {skills === undefined ? (
            <SkillListSkeleton />
          ) : skills.length === 0 ? (
            <EmptyState
              icon={SparklesIcon}
              title="No skills yet"
              description="Skills are plain-English procedures that steer an agent's judgment — grouping, tone, and when to stop. Attach them to agents to change behavior without touching code."
              action={
                <Button variant="outline" onClick={openCreate}>
                  <PlusIcon className="size-4" />
                  Create your first skill
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map((skill) => (
                <SkillRow
                  key={skill._id}
                  skill={skill}
                  agents={agents ?? []}
                  onEdit={() =>
                    openEdit({
                      _id: skill._id,
                      name: skill.name,
                      instruction: skill.instruction,
                      scope: skill.scope,
                      clientId: skill.clientId,
                      isStopCondition: skill.isStopCondition,
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SkillFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        skill={editing}
        clients={clientOptions}
      />
    </div>
  )
}

type SkillListItem = {
  _id: Id<"skills">
  name: string
  instruction: string
  scope: "global" | "client"
  clientId: Id<"clients"> | null
  clientName: string | null
  isStopCondition: boolean
}

type AgentWithSkills = { _id: Id<"agents">; name: string; skillIds: Id<"skills">[] }

function SkillRow({
  skill,
  agents,
  onEdit,
}: {
  skill: SkillListItem
  agents: AgentWithSkills[]
  onEdit: () => void
}) {
  const setSkills = useMutation(api.agents.setSkills)
  const archive = useMutation(api.skills.archive)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function toggleAgent(agent: AgentWithSkills) {
    const attached = agent.skillIds.includes(skill._id)
    const next = attached
      ? agent.skillIds.filter((id) => id !== skill._id)
      : [...agent.skillIds, skill._id]
    void setSkills({ agentId: agent._id, skillIds: next }).catch((err) =>
      toastError(err, "Couldn't update the attachment"),
    )
  }

  function confirmArchive() {
    void archive({ skillId: skill._id })
      .then(() => toast.success(`Archived “${skill.name}”`))
      .catch((err) => toastError(err, "Couldn't archive the skill"))
    setConfirmOpen(false)
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{skill.name}</span>
            {skill.isStopCondition && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <OctagonXIcon className="size-3.5" />
                Stop-condition
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {skill.scope === "global"
              ? "Global"
              : `Client · ${skill.clientName ?? "Unknown"}`}
          </p>
          <p className="mt-1.5 line-clamp-2 text-sm text-foreground/80">
            {skill.instruction}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={onEdit}
            title="Edit skill"
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
            title="Archive skill"
          >
            <OctagonXIcon className="size-4" />
          </Button>
        </div>
      </div>

      {agents.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="text-xs text-muted-foreground">Used by</span>
          {agents.map((agent) => {
            const attached = agent.skillIds.includes(skill._id)
            return (
              <button
                key={agent._id}
                type="button"
                onClick={() => toggleAgent(agent)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs transition-colors",
                  attached
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={attached}
              >
                {agent.name}
              </button>
            )
          })}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{skill.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops loading into runs and detaches from every agent. Existing
              threads are unaffected.
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

function SkillListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-lg border p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-16" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-3 h-5 w-40" />
        </div>
      ))}
    </div>
  )
}

/** Content-aware: header bar + a few skill card skeletons. */
function SkillsViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <SkillListSkeleton />
      </div>
    </div>
  )
}
