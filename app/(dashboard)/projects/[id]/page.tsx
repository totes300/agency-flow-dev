"use client"

import { Suspense, useState, useEffect, useMemo } from "react"
import { useParams, useSearchParams, useRouter, usePathname, notFound } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectDetailHeader } from "@/components/projects/project-detail-header"
import { SettingsGeneral } from "@/components/projects/settings-general"
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton"
import { FixedOverview } from "@/components/projects/fixed-overview"
import { TmOverview } from "@/components/projects/tm-overview"
import { RetainerOverview } from "@/components/projects/retainer-overview"
import { SettingsBudgetEstimates } from "@/components/projects/settings-budget-estimates"
import { SettingsRates } from "@/components/projects/settings-rates"
import { SettingsRetainer } from "@/components/projects/settings-retainer"
import { ProjectTeam } from "@/components/projects/project-team"
import { ProjectInvoices } from "@/components/invoices/project-invoices"
import { ProjectTime } from "@/components/projects/project-time"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { TaskView } from "@/components/task-view/task-view"
import { TaskTableSkeleton } from "@/components/task-view/task-view-skeleton"
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


  useBreadcrumbTitle(project?.name ?? null)

  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  // URL is the source of truth for the active tab — keeps back button, refresh,
  // and shareable links working (CLAUDE.md: filterable views persist to URL).
  const tabParam = searchParams.get("tab")
  const tab =
    tabParam === "tasks" || tabParam === "settings" || tabParam === "invoices" || tabParam === "time"
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

  if (project === undefined) return <ProjectDetailSkeleton />
  if (project === null) notFound()

  return (
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
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          {project.billingType !== "non_billable" && (
            <TabsTrigger value="time">Time</TabsTrigger>
          )}
          {project.billingType !== "non_billable" && (
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          )}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Mount only the active tab — TabsContent + conditional render keeps
            heavy children (ProjectTime entry list, FixedOverview metrics) out of
            the tree until selected. */}
        <TabsContent value="overview" className="mt-6">
          {effectiveTab === "overview" && project.billingType === "fixed" && (
            <FixedOverview
              projectId={projectId}
              currency={project.currency}
              onNavigateToEstimates={() => {
                setTab("settings")
                setScrollTarget("budget-estimates-section")
              }}
            />
          )}
          {effectiveTab === "overview" && project.billingType === "t_and_m" && (
            <TmOverview projectId={projectId} project={project} />
          )}
          {effectiveTab === "overview" && project.billingType === "retainer" && (
            <RetainerOverview
              projectId={projectId}
              currency={project.currency}
            />
          )}
          {effectiveTab === "overview" && project.billingType === "non_billable" && (
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

        {/* The project's tasks: the task-view preset `surface: "project"`
            (views, display options, filters as on /tasks; no Client column). */}
        <TabsContent value="tasks" className="mt-6">
          {effectiveTab === "tasks" && (
            <Suspense fallback={<TaskTableSkeleton />}>
              <TaskView surface="project" projectId={projectId} fromLabel={project.name} embedded />
            </Suspense>
          )}
        </TabsContent>

        {project.billingType !== "non_billable" && (
          <TabsContent value="time" className="mt-6">
            {effectiveTab === "time" && (
              <ProjectTime
                projectId={projectId}
                project={{
                  name: project.name,
                  billingType: project.billingType,
                  currency: project.currency,
                  teamMembers: project.teamMembers,
                  startDate: project.startDate,
                }}
                onNavigateToInvoices={() => setTab("invoices")}
              />
            )}
          </TabsContent>
        )}

        {project.billingType !== "non_billable" && (
          <TabsContent value="invoices" className="mt-6">
            {effectiveTab === "invoices" && (
              <ProjectInvoices projectId={projectId} project={project} />
            )}
          </TabsContent>
        )}

        <TabsContent value="settings" className="mt-6">
          {effectiveTab === "settings" && (
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
          )}
        </TabsContent>
      </Tabs>

      {/* Task detail — route-driven (?task= / ?detail=); the full page when that is
          the user's mode. The Tasks tab mounts its own (stepping through its rows). */}
      {effectiveTab !== "tasks" && <TaskDetailDrawer taskIds={projectTaskIds} isAdmin={isAdmin ?? false} />}
    </div>
  )
}
