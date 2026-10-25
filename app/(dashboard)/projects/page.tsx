"use client"

import { useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  DirectoryView,
  DirectoryEmpty,
} from "@/components/directory/directory-view"
import {
  DirectoryMenu,
  DirectoryMenuOptions,
} from "@/components/directory/directory-menu"
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ProjectsListSkeleton } from "@/components/projects/projects-list-skeleton"
import { ProjectsTable } from "@/components/projects/projects-table"
import dynamic from "next/dynamic"
const ProjectFormModal = dynamic(() =>
  import("@/components/projects/project-form-modal").then((m) => ({
    default: m.ProjectFormModal,
  })),
)
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { ListFilterIcon } from "lucide-react"
import { toast } from "sonner"
import { toastArchiveSuccess } from "@/lib/toast-helpers"
import type { Doc } from "@/convex/_generated/dataModel"

type SortBy = "name" | "client"
type FilterClient = "all" | string
type FilterType = "all" | "fixed" | "t_and_m" | "retainer" | "non_billable"

export default function ProjectsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const projects = useQuery(api.projects.list, { includeArchived })
  const clientsList = useQuery(api.clients.list, { includeArchived: false })
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const removeProject = useMutation(api.projects.remove)

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [filterClient, setFilterClient] = useState<FilterClient>("all")
  const [filterType, setFilterType] = useState<FilterType>("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Doc<"projects"> | null>(null)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const { trigger: triggerUndo } = useUndoAction()

  const processedProjects = useMemo(() => {
    if (!projects) return []
    const result = []
    for (const p of projects) {
      if (hiddenIds.has(p._id)) continue
      if (filterClient !== "all" && p.clientId !== filterClient) continue
      if (filterType !== "all" && p.billingType !== filterType) continue
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase()
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.code.toLowerCase().includes(q) &&
          !p.clientName.toLowerCase().includes(q)
        )
          continue
      }
      result.push(p)
    }
    result.sort((a, b) => {
      if (sortBy === "client") {
        const diff = a.clientName.localeCompare(b.clientName)
        if (diff !== 0) return diff
      }
      return a.name.localeCompare(b.name)
    })
    return result
  }, [projects, hiddenIds, deferredSearch, sortBy, filterClient, filterType])

  if (!projects) return <ProjectsListSkeleton />

  function handleArchive(project: Doc<"projects"> & { clientName: string }) {
    const projectId = project._id
    setHiddenIds((prev) => new Set(prev).add(projectId))

    const unhide = () => {
      setHiddenIds((prev) => {
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
    }

    triggerUndo({
      key: projectId,
      message: `"${project.name}" archived`,
      action: async () => {
        const result = await archiveProject({ id: projectId })
        // The undo toast already says "<name>" archived — only add noise when
        // a running timer was rescued (or couldn't be).
        if (
          result.autoSavedTimers.length > 0 ||
          result.timerSaveFailures.length > 0
        ) {
          toastArchiveSuccess(result, `"${project.name}" archived`)
        }
        unhide()
      },
      onUndo: unhide,
      onError: unhide,
    })
  }

  async function handleRestore(project: Doc<"projects">) {
    try {
      await restoreProject({ id: project._id })
      toast.info(
        "Project restored. Tasks are still archived — restore them individually.",
      )
    } catch {
      toast.error("Failed to restore project")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await removeProject({ id: deleteTarget._id })
      setDeleteTarget(null)
      toast.success(`"${deleteTarget.name}" deleted`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete project",
      )
    }
  }

  return (
    <DirectoryView
      name="projects"
      includeArchived={includeArchived}
      onIncludeArchivedChange={setIncludeArchived}
      search={search}
      onSearchChange={setSearch}
      onCreate={() => setCreateOpen(true)}
      controls={
        <>
          <DirectoryMenu
            label="Filter projects"
            active={filterClient !== "all" || filterType !== "all"}
            icon={<ListFilterIcon />}
          >
            <DirectoryMenuOptions
              label="Client"
              value={filterClient}
              onChange={setFilterClient}
              options={[
                { value: "all", label: "All clients" },
                ...(clientsList ?? []).map((client) => ({
                  value: client._id,
                  label: client.name,
                })),
              ]}
            />
            <DropdownMenuSeparator />
            <DirectoryMenuOptions<FilterType>
              label="Billing type"
              value={filterType}
              onChange={setFilterType}
              options={[
                { value: "all", label: "All types" },
                { value: "fixed", label: "Fixed" },
                { value: "t_and_m", label: "Time & materials" },
                { value: "retainer", label: "Retainer" },
                { value: "non_billable", label: "Non-billable" },
              ]}
            />
          </DirectoryMenu>
          <DirectoryMenu
            label="Project display options"
            active={sortBy !== "name"}
          >
            <DirectoryMenuOptions<SortBy>
              label="Sort by"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "name", label: "Name" },
                { value: "client", label: "Client" },
              ]}
            />
          </DirectoryMenu>
        </>
      }
    >
      {/* Table */}
      {processedProjects.length === 0 ? (
        <DirectoryEmpty
          name="projects"
          filtered={!!search || filterClient !== "all" || filterType !== "all"}
          onReset={() => {
            setSearch("")
            setFilterClient("all")
            setFilterType("all")
          }}
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <ProjectsTable
          projects={processedProjects}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onDelete={setDeleteTarget}
        />
      )}

      {/* Create modal */}
      <ProjectFormModal open={createOpen} onOpenChange={setCreateOpen} />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete project"
        description={`This will permanently delete "${deleteTarget?.name}" and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </DirectoryView>
  )
}
