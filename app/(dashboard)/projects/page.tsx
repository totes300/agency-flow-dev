"use client"

import { useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  DirectoryView,
  DirectoryEmpty,
  DirectorySkeleton,
} from "@/components/directory/directory-view"
import {
  DirectoryDisplayMenu,
  DirectoryMenuOptions,
} from "@/components/directory/directory-menu"
import {
  FacetFilterButton,
  FacetFilterChips,
  type FacetFilterContext,
} from "@/components/filters/facet-filter"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ProjectsTable } from "@/components/projects/projects-table"
import {
  PROJECT_FILTER_FIELDS,
  type ProjectFilterKey,
} from "@/components/projects/project-filter-fields"
import dynamic from "next/dynamic"
const ProjectFormModal = dynamic(() =>
  import("@/components/projects/project-form-modal").then((m) => ({
    default: m.ProjectFormModal,
  })),
)
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import {
  applyFacetFilters,
  hasActiveFacets,
  type FacetSelection,
} from "@/lib/facet-filter"
import { toast } from "sonner"
import { toastArchiveSuccess } from "@/lib/toast-helpers"
import type { Doc } from "@/convex/_generated/dataModel"

type SortBy = "name" | "client"
type ProjectRow = Doc<"projects"> & { clientName: string; currency: string }

export default function ProjectsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  // One subscription for both tabs: Active/All re-filters loaded rows, so a
  // switch never drops back to the skeleton (or loses keyboard focus).
  const projects = useQuery(api.projects.list, { includeArchived: true })
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const removeProject = useMutation(api.projects.remove)

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [filters, setFilters] = useState<FacetSelection<ProjectFilterKey>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Doc<"projects"> | null>(null)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const { trigger: triggerUndo } = useUndoAction()

  // The tab's rows (minus optimistically archived ones), narrowed by search;
  // the filter facets count over these.
  const tabProjects = useMemo(() => {
    if (!projects) return []
    const q = deferredSearch.toLowerCase()
    return projects.filter(
      (p) =>
        !hiddenIds.has(p._id) &&
        (includeArchived || !p.archivedAt) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q)),
    )
  }, [projects, hiddenIds, includeArchived, deferredSearch])

  const processedProjects = useMemo(() => {
    const result = applyFacetFilters(tabProjects, PROJECT_FILTER_FIELDS, filters)
    result.sort((a, b) => {
      if (sortBy === "client") {
        const diff = a.clientName.localeCompare(b.clientName)
        if (diff !== 0) return diff
      }
      return a.name.localeCompare(b.name)
    })
    return result
  }, [tabProjects, filters, sortBy])

  const filterCtx: FacetFilterContext<ProjectRow, ProjectFilterKey> = {
    items: tabProjects,
    fields: PROJECT_FILTER_FIELDS,
    selection: filters,
    onChange: setFilters,
  }

  if (!projects) return <DirectorySkeleton />

  function handleArchive(project: ProjectRow) {
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
          <FacetFilterButton ctx={filterCtx} label="Filter projects" />
          <DirectoryDisplayMenu
            label="Project display options"
            modified={sortBy !== "name"}
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
          </DirectoryDisplayMenu>
        </>
      }
      filters={<FacetFilterChips ctx={filterCtx} />}
    >
      {/* Table */}
      {processedProjects.length === 0 ? (
        <DirectoryEmpty
          name="projects"
          filtered={
            !!search || hasActiveFacets(PROJECT_FILTER_FIELDS, filters)
          }
          hasArchived={
            !includeArchived && projects.some((p) => p.archivedAt)
          }
          onReset={() => {
            setSearch("")
            setFilters({})
          }}
          onShowAll={() => setIncludeArchived(true)}
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
