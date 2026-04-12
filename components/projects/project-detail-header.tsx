"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { BillingTypeBadge } from "@/components/billing-type-badge"
import { RetainerStatusBadge } from "@/components/retainer-status-badge"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { formatShortDate, formatMinutes } from "@/lib/format"
import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
} from "lucide-react"

type ProjectHeaderProps = {
  projectId: Id<"projects">
  project: {
    name: string
    code: string
    clientName: string
    currency: string
    billingType: "fixed" | "retainer" | "t_and_m" | "non_billable"
    retainerStatus?: string
    includedMinutesPerMonth?: number
    archivedAt?: number
  }
  lastLoggedDate?: string
  onTabChange: (tab: string) => void
}

export function ProjectDetailHeader({
  projectId,
  project,
  lastLoggedDate,
  onTabChange,
}: ProjectHeaderProps) {
  const router = useRouter()
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const removeProject = useMutation(api.projects.remove)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function handleArchive() {
    try {
      await archiveProject({ id: projectId })
      toast.success("Project archived")
    } catch (err) {
      toastError(err, "Failed to archive")
    }
  }

  async function handleRestore() {
    try {
      await restoreProject({ id: projectId })
      toast.info("Project restored")
    } catch (err) {
      toastError(err, "Failed to restore")
    }
  }

  async function handleDelete() {
    try {
      await removeProject({ id: projectId })
      toast.success("Project deleted")
      router.replace("/projects")
    } catch (err) {
      toastError(err, "Failed to delete")
    }
  }

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 text-muted-foreground"
          onClick={() => router.push("/projects")}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Projects
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
              <BillingTypeBadge type={project.billingType} />
              {project.billingType === "retainer" && project.retainerStatus && (
                <RetainerStatusBadge status={project.retainerStatus} />
              )}
              {project.archivedAt && (
                <Badge variant="secondary" className="text-xs">Archived</Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{project.code}</span>
              <span>&middot;</span>
              <span>{project.clientName}</span>
              <span>&middot;</span>
              <span>{project.currency}</span>
              {project.billingType === "retainer" && project.includedMinutesPerMonth && (
                <>
                  <span>&middot;</span>
                  <span className="tabular-nums">
                    {formatMinutes(project.includedMinutesPerMonth)} h/mo
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Last logged: {lastLoggedDate ? formatShortDate(lastLoggedDate) : "—"}
            </span>
            <Button variant="outline" size="sm" onClick={() => onTabChange("settings")}>
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project.archivedAt ? (
                  <DropdownMenuItem onClick={handleRestore}>
                    <ArchiveRestoreIcon /> Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleArchive}>
                    <ArchiveIcon /> Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2Icon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete project"
        description={`This will permanently delete "${project.name}" and all associated estimates. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
}
