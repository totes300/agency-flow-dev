"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectDetailHeader } from "@/components/projects/project-detail-header"
import dynamic from "next/dynamic"
import { SettingsGeneral } from "@/components/projects/settings-general"

import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton"
import { ProjectInvoicesSkeleton } from "@/components/invoices/project-invoices-skeleton"
import { ProjectTimeSkeleton } from "@/components/projects/project-time-skeleton"

const FixedOverview = dynamic(() => import("@/components/projects/fixed-overview").then(m => ({ default: m.FixedOverview })))
const TmOverview = dynamic(() => import("@/components/projects/tm-overview").then(m => ({ default: m.TmOverview })))
const RetainerOverview = dynamic(() => import("@/components/projects/retainer-overview").then(m => ({ default: m.RetainerOverview })))
const SettingsBudgetEstimates = dynamic(() => import("@/components/projects/settings-budget-estimates").then(m => ({ default: m.SettingsBudgetEstimates })))
const SettingsRates = dynamic(() => import("@/components/projects/settings-rates").then(m => ({ default: m.SettingsRates })))
const SettingsRetainer = dynamic(() => import("@/components/projects/settings-retainer").then(m => ({ default: m.SettingsRetainer })))
const ProjectTeam = dynamic(() => import("@/components/projects/project-team").then(m => ({ default: m.ProjectTeam })))
// Content-aware `loading` fallbacks prevent the blank flash between chunk
// load and the component's internal Convex skeleton taking over. Matches the
// real layouts in `project-invoices.tsx` and `project-time.tsx`.
const ProjectInvoices = dynamic(
  () => import("@/components/invoices/project-invoices").then(m => ({ default: m.ProjectInvoices })),
  { loading: () => <ProjectInvoicesSkeleton /> },
)
const ProjectTime = dynamic(
  () => import("@/components/projects/project-time").then(m => ({ default: m.ProjectTime })),
  { loading: () => <ProjectTimeSkeleton /> },
)
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"

export default function ProjectDetailPage() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin()
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
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

  useBreadcrumbTitle(project?.name ?? null)

  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  // URL is the source of truth for the active tab — keeps back button, refresh,
  // and shareable links working (CLAUDE.md: filterable views persist to URL).
  const tabParam = searchParams.get("tab")
  const tab =
    tabParam === "settings" || tabParam === "invoices" || tabParam === "time"
      ? tabParam
      : "overview"

  function setTab(next: string) {
    const next_ = new URLSearchParams(searchParams.toString())
    if (next === "overview") next_.delete("tab")
    else next_.set("tab", next)
    const qs = next_.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  // If non-billable project navigated with ?tab=invoices or ?tab=time, fall back to overview
  const isBillable = project ? project.billingType !== "non_billable" : true
  const effectiveTab =
    ((tab === "invoices" || tab === "time") && !isBillable) ? "overview" : tab

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

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div className="flex w-full flex-col gap-6">
      <ProjectDetailHeader
        projectId={projectId}
        project={project}
        lastLoggedDate={overview?.lastLoggedDate ?? undefined}
        onTabChange={setTab}
      />

      {/* Tabs */}
      <Tabs value={effectiveTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {project.billingType !== "non_billable" && (
            <TabsTrigger value="time">Time</TabsTrigger>
          )}
          {project.billingType !== "non_billable" && (
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          )}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {project.billingType === "fixed" && (
            <FixedOverview
              projectId={projectId}
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
            <RetainerOverview
              projectId={projectId}
              projectName={project.name}
              currency={project.currency}
            />
          )}
          {project.billingType === "non_billable" && (
            <div className="rounded-lg border bg-muted/30 p-8">
              <div className="flex flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-medium">Non-billable project</p>
                <p className="text-xs text-muted-foreground">
                  This project has no billing configuration. Time logged here is tracked for internal reporting only.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {project.billingType !== "non_billable" && (
          <TabsContent value="time" className="mt-6">
            <ProjectTime
              projectId={projectId}
              project={{
                name: project.name,
                billingType: project.billingType,
                currency: project.currency,
                teamMembers: project.teamMembers,
              }}
              onNavigateToInvoices={() => setTab("invoices")}
            />
          </TabsContent>
        )}

        {project.billingType !== "non_billable" && (
          <TabsContent value="invoices" className="mt-6">
            <ProjectInvoices projectId={projectId} project={project} />
          </TabsContent>
        )}

        <TabsContent value="settings" className="mt-6">
          <div className="flex flex-col gap-6">
            <SettingsGeneral projectId={projectId} project={project} />
            {project.billingType === "fixed" && (
              <SettingsBudgetEstimates projectId={projectId} project={project} teamMembers={project.teamMembers} defaultAssignees={project.defaultAssignees} />
            )}
            {project.billingType === "t_and_m" && (
              <SettingsRates projectId={projectId} project={project} teamMembers={project.teamMembers} defaultAssignees={project.defaultAssignees} />
            )}
            {project.billingType === "retainer" && (
              <SettingsRetainer projectId={projectId} project={project} />
            )}
            <ProjectTeam
              projectId={projectId}
              teamMembers={project.teamMembers}
              defaultAssignees={project.defaultAssignees}
              isAdmin={isAdmin ?? false}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Task detail modal — route-driven via ?detail=taskId */}
      <TaskDetailModal
        taskIds={projectTaskIds}
        isAdmin={isAdmin ?? false}
      />
    </div>
    </TaskReferenceDataProvider>
  )
}
