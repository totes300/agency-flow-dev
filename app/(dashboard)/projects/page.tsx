"use client"

import { useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { BillingTypeBadge } from "@/components/billing-type-badge"
import dynamic from "next/dynamic"
const ProjectFormModal = dynamic(() => import("@/components/projects/project-form-modal").then(m => ({ default: m.ProjectFormModal })))
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import {
  FolderIcon,
  PlusIcon,
  SearchIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  ArrowUpDownIcon,
  ListFilterIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Doc } from "@/convex/_generated/dataModel"

type SortBy = "name" | "client"
type FilterClient = "all" | string
type FilterType = "all" | "fixed" | "t_and_m" | "retainer"

function ProjectsListSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center divide-x">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 first:pl-0">
              <Skeleton className="mb-1 h-3 w-16" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28 rounded-full" />
          ))}
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="w-24">Code</TableHead>
              <TableHead className="w-20">Type</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="w-20">Currency</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16 font-mono" /></TableCell>
                <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-5 w-10 rounded-md" /></TableCell>
                <TableCell><Skeleton className="size-7" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const projects = useQuery(api.projects.list, { includeArchived })
  const clientsList = useQuery(api.clients.list, { includeArchived: false })
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const removeProject = useMutation(api.projects.remove)
  const router = useRouter()

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
        ) continue
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

  const stats = useMemo(() => {
    if (!projects) return { active: 0, fixed: 0, t_and_m: 0, retainer: 0 }
    let active = 0, fixed = 0, t_and_m = 0, retainer = 0
    for (const p of projects) {
      if (hiddenIds.has(p._id) || p.archivedAt) continue
      active++
      if (p.billingType === "fixed") fixed++
      else if (p.billingType === "t_and_m") t_and_m++
      else if (p.billingType === "retainer") retainer++
    }
    return { active, fixed, t_and_m, retainer }
  }, [projects, hiddenIds])

  if (!projects) return <ProjectsListSkeleton />

  function handleArchive(project: Doc<"projects"> & { clientName: string }) {
    const projectId = project._id
    setHiddenIds((prev) => new Set(prev).add(projectId))

    triggerUndo({
      message: `"${project.name}" archived`,
      action: async () => {
        await archiveProject({ id: projectId })
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(projectId)
          return next
        })
      },
      onUndo: () => {
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(projectId)
          return next
        })
      },
      onError: () => {
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(projectId)
          return next
        })
      },
    })
  }

  async function handleRestore(project: Doc<"projects">) {
    try {
      await restoreProject({ id: project._id })
      toast.info("Project restored. Tasks are still archived — restore them individually.")
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
      toast.error(err instanceof Error ? err.message : "Failed to delete project")
    }
  }

  if (projects.length === 0 && !includeArchived) {
    return (
      <>
        <EmptyState
          icon={FolderIcon}
          title="No projects yet"
          description="Create a project to start tracking time and budgets for your clients."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Create your first project
            </Button>
          }
        />
        <ProjectFormModal open={createOpen} onOpenChange={setCreateOpen} />
      </>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Manage your projects</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-64 pl-9"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New Project
          </Button>
        </div>
      </div>

      {/* Stats + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center divide-x">
          <div className="pr-4">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-lg font-semibold">{stats.active}</p>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">Fixed</p>
            <p className="text-lg font-semibold">{stats.fixed}</p>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">T&M</p>
            <p className="text-lg font-semibold">{stats.t_and_m}</p>
          </div>
          <div className="pl-4">
            <p className="text-xs text-muted-foreground">Retainer</p>
            <p className="text-lg font-semibold">{stats.retainer}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Client filter */}
          <Select value={filterClient} onValueChange={(v) => setFilterClient(v as FilterClient)}>
            <SelectTrigger className="h-9 w-fit rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ListFilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Client:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="py-2 pl-2.5">All</SelectItem>
              {clientsList?.map((c) => (
                <SelectItem key={c._id} value={c._id} className="py-2 pl-2.5">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Type filter */}
          <Select value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
            <SelectTrigger className="h-9 w-fit rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ListFilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Type:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="py-2 pl-2.5">All</SelectItem>
              <SelectItem value="fixed" className="py-2 pl-2.5">Fixed</SelectItem>
              <SelectItem value="t_and_m" className="py-2 pl-2.5">T&M</SelectItem>
              <SelectItem value="retainer" className="py-2 pl-2.5">Retainer</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 w-fit rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ArrowUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Sort:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name" className="py-2 pl-2.5">Name</SelectItem>
              <SelectItem value="client" className="py-2 pl-2.5">Client</SelectItem>
            </SelectContent>
          </Select>

          {/* Archived toggle */}
          <div className="flex h-9 items-center gap-2.5 rounded-full border border-input px-3.5">
            <Switch
              id="show-archived-projects"
              size="sm"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="show-archived-projects" className="whitespace-nowrap text-sm font-normal text-muted-foreground">
              Archived
            </Label>
          </div>
        </div>
      </div>

      {/* Table */}
      {processedProjects.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {deferredSearch ? "No projects match your search." : "No projects found."}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="w-24">Code</TableHead>
                <TableHead className="w-20">Type</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="w-20">Currency</TableHead>
                <TableHead className="w-20">Last activity</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {processedProjects.map((project) => (
                <TableRow
                  key={project._id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => router.push(`/projects/${project._id}`)}
                >
                  <TableCell>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{project.name}</span>
                        {project.archivedAt && (
                          <Badge variant="secondary" className="shrink-0 text-[10px] leading-tight">Archived</Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
                  </TableCell>
                  <TableCell>
                    <BillingTypeBadge type={project.billingType} />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{project.clientName}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{project.currency}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">&mdash;</span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontalIcon className="size-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => router.push(`/projects/${project._id}?tab=settings`)}>
                          <PencilIcon className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {project.archivedAt ? (
                          <DropdownMenuItem onClick={() => handleRestore(project)}>
                            <ArchiveRestoreIcon className="size-4" />
                            Restore
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleArchive(project)}>
                            <ArchiveIcon className="size-4" />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(project)}
                        >
                          <Trash2Icon className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create modal */}
      <ProjectFormModal open={createOpen} onOpenChange={setCreateOpen} />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete project"
        description={`This will permanently delete "${deleteTarget?.name}" and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
