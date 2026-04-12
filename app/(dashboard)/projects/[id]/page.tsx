"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectDetailHeader } from "@/components/projects/project-detail-header"
import dynamic from "next/dynamic"
import { SettingsGeneral } from "@/components/projects/settings-general"

const FixedOverview = dynamic(() => import("@/components/projects/fixed-overview").then(m => ({ default: m.FixedOverview })))
const TmOverview = dynamic(() => import("@/components/projects/tm-overview").then(m => ({ default: m.TmOverview })))
const RetainerOverview = dynamic(() => import("@/components/projects/retainer-overview").then(m => ({ default: m.RetainerOverview })))
const SettingsBudgetEstimates = dynamic(() => import("@/components/projects/settings-budget-estimates").then(m => ({ default: m.SettingsBudgetEstimates })))
const SettingsRates = dynamic(() => import("@/components/projects/settings-rates").then(m => ({ default: m.SettingsRates })))
const SettingsRetainer = dynamic(() => import("@/components/projects/settings-retainer").then(m => ({ default: m.SettingsRetainer })))
const ProjectTeam = dynamic(() => import("@/components/projects/project-team").then(m => ({ default: m.ProjectTeam })))
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"

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

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div className="mx-auto w-full max-w-5xl flex flex-col gap-6">
      <ProjectDetailHeader
        projectId={projectId}
        project={project}
        lastLoggedDate={overview?.lastLoggedDate ?? undefined}
        onTabChange={setTab}
      />

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
