"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import dynamic from "next/dynamic"
import { SettingsGeneral } from "@/components/projects/settings-general"

const FixedOverview = dynamic(() => import("@/components/projects/fixed-overview").then(m => ({ default: m.FixedOverview })))
const TmOverview = dynamic(() => import("@/components/projects/tm-overview").then(m => ({ default: m.TmOverview })))
const RetainerOverview = dynamic(() => import("@/components/projects/retainer-overview").then(m => ({ default: m.RetainerOverview })))
const SettingsBudgetEstimates = dynamic(() => import("@/components/projects/settings-budget-estimates").then(m => ({ default: m.SettingsBudgetEstimates })))
const SettingsRates = dynamic(() => import("@/components/projects/settings-rates").then(m => ({ default: m.SettingsRates })))
const SettingsRetainer = dynamic(() => import("@/components/projects/settings-retainer").then(m => ({ default: m.SettingsRetainer })))
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton"
import { DefaultAssigneesPlaceholder } from "@/components/projects/default-assignees-placeholder"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { toast } from "sonner"
import { formatShortDate } from "@/lib/format"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
} from "lucide-react"

export default function ProjectDetailPage() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin()
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = params.id as Id<"projects">
  const project = useQuery(api.projects.get, isAuthenticated ? { id: projectId } : "skip")
  const overview = useQuery(api.timeEntries.projectOverview, isAuthenticated ? { projectId } : "skip")
  const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, isAuthenticated ? { projectId } : "skip")

  const statuses = useQuery(api.statuses.list, isAuthenticated ? {} : "skip")
  const categories = useQuery(api.workCategories.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")
  const orgMembersData = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated ? {} : "skip",
  )

  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const removeProject = useMutation(api.projects.remove)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const tabParam = searchParams.get("tab")
  const defaultTab = tabParam === "settings" ? "settings" : tabParam === "invoices" ? "invoices" : "overview"
  const [tab, setTab] = useState(defaultTab)

  const referenceData = useMemo(
    () => ({
      statuses,
      categories,
      projects,
      orgMembers: orgMembersData,
    }),
    [statuses, categories, projects, orgMembersData],
  )

  const projectTaskIds = useMemo(() => {
    if (!monthlyData) return []
    return Array.from(
      new Set(
        monthlyData.flatMap((month) => [
          ...month.billableCategoryGroups.flatMap((group) =>
            group.tasks.map((task) => task.taskId),
          ),
          ...month.nonBillableCategoryGroups.flatMap((group) =>
            group.tasks.map((task) => task.taskId),
          ),
        ]),
      ),
    )
  }, [monthlyData])

  // Scroll to target element after tab switch
  useEffect(() => {
    if (!scrollTarget || tab !== "settings") return
    const id = requestAnimationFrame(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" })
      setScrollTarget(null)
    })
    return () => cancelAnimationFrame(id)
  }, [scrollTarget, tab])

  useEffect(() => {
    if (project === null) {
      router.replace("/projects")
    }
  }, [project, router])

  if (project === undefined || project === null) return <ProjectDetailSkeleton />

  async function handleArchive() {
    try {
      await archiveProject({ id: projectId })
      toast.success("Project archived")
    } catch {
      toast.error("Failed to archive")
    }
  }

  async function handleRestore() {
    try {
      await restoreProject({ id: projectId })
      toast.info("Project restored")
    } catch {
      toast.error("Failed to restore")
    }
  }

  async function handleDelete() {
    try {
      await removeProject({ id: projectId })
      toast.success("Project deleted")
      router.replace("/projects")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    }
  }

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div className="mx-auto w-full max-w-5xl flex flex-col gap-6">
      {/* Header */}
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
                    {String(Math.floor(project.includedMinutesPerMonth / 60)).padStart(2, "0")}:
                    {String(project.includedMinutesPerMonth % 60).padStart(2, "0")} h/mo
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Last logged: {overview?.lastLoggedDate ? formatShortDate(overview.lastLoggedDate) : "—"}
            </span>
            <Button variant="outline" size="sm" onClick={() => setTab("settings")}>
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

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {project.billingType === "fixed" && (
            <FixedOverview
              projectId={projectId}
              project={project}
              onNavigateToEstimates={() => {
                setTab("settings")
                setScrollTarget("budget-estimates-section")
              }}
            />
          )}
          {project.billingType === "t_and_m" && (
            <TmOverview projectId={projectId} project={project} />
          )}
          {project.billingType === "retainer" && (
            <RetainerOverview projectId={projectId} />
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-6">
          <div className="rounded-lg border bg-muted/30 p-8">
            <div className="flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium">Invoices coming soon</p>
              <p className="text-xs text-muted-foreground">
                Invoice creation and tracking will be available in a future update.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <div className="flex flex-col gap-6">
            <SettingsGeneral projectId={projectId} project={project} />
            {project.billingType === "fixed" && (
              <SettingsBudgetEstimates projectId={projectId} currency={project.currency} />
            )}
            {project.billingType === "t_and_m" && (
              <SettingsRates projectId={projectId} project={project} />
            )}
            {project.billingType === "retainer" && (
              <SettingsRetainer projectId={projectId} project={project} />
            )}
            <DefaultAssigneesPlaceholder />
          </div>
        </TabsContent>
      </Tabs>

      {/* Task detail modal — route-driven via ?detail=taskId */}
      <TaskDetailModal
        taskIds={projectTaskIds}
        isAdmin={isAdmin ?? false}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete project"
        description={`This will permanently delete "${project.name}" and all associated estimates. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
    </TaskReferenceDataProvider>
  )
}
