"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams, useRouter, usePathname, notFound } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ProjectDetailHeader } from "@/components/projects/project-detail-header"
import { SettingsGeneral } from "@/components/projects/settings-general"
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton"
import { SettingsBudgetEstimates } from "@/components/projects/settings-budget-estimates"
import { SettingsRates } from "@/components/projects/settings-rates"
import { SettingsRetainer } from "@/components/projects/settings-retainer"
import { ProjectTeam } from "@/components/projects/project-team"
import { ProjectInvoices } from "@/components/invoices/project-invoices"
import { ProjectTime } from "@/components/projects/project-time"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { TaskView } from "@/components/task-view/task-view"
import { TaskTableSkeleton } from "@/components/task-view/task-view-skeleton"
import { PanelNavIcon } from "@/components/icons/nav-icons"
import { ProjectBillingCard, ProjectOverviewMain } from "@/components/projects/overview/project-overview"
import { ProjectPropertiesCards } from "@/components/projects/overview/project-side-panel"
import { selectPeriod } from "@/lib/billing/period-selection"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"
import { cn } from "@/lib/utils"

const TABS = ["overview", "tasks", "time", "invoices", "settings"] as const
type Tab = (typeof TABS)[number]

/** Params the period header replaced (`?period=`, §7.1): redirected once, then dropped. */
const LEGACY_PERIOD_PARAMS = ["cycleOffset", "summaryRange", "summaryFrom", "summaryTo"]

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
  const billing = useQuery(api.billingViews.getProjectBillingPeriods, isAuthenticated ? { projectId } : "skip")

  useBreadcrumbTitle(project?.name ?? null)

  // URL is the source of truth for the active tab — keeps back button, refresh,
  // and shareable links working (CLAUDE.md: filterable views persist to URL).
  const tabParam = searchParams.get("tab")
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview"

  const navigate = useCallback(
    (next: URLSearchParams, mode: "push" | "replace" = "push") => {
      const qs = next.toString()
      const href = qs ? `${pathname}?${qs}` : pathname
      if (mode === "push") router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )

  function setTab(next: string) {
    const next_ = new URLSearchParams(searchParams.toString())
    if (next === "overview") next_.delete("tab")
    else next_.set("tab", next)
    next_.delete("section")
    navigate(next_)
  }

  const selectPeriodKey = useCallback(
    (key: string) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set("period", key)
      next.delete("tab")
      navigate(next)
    },
    [navigate, searchParams],
  )

  // If non-billable project navigated with ?tab=invoices or ?tab=time, fall back to overview
  const isBillable = project ? project.billingType !== "non_billable" : true
  const effectiveTab: Tab = (tab === "invoices" || tab === "time") && !isBillable ? "overview" : tab

  const firstMonthKey = project
    ? (project.startDate ?? new Date(project.createdAt).toISOString().slice(0, 10)).slice(0, 7)
    : ""
  const selected = useMemo(
    () =>
      project && billing
        ? selectPeriod({
            billingType: project.billingType,
            rows: billing.periods,
            todayStr: billing.timezoneToday,
            param: searchParams.get("period"),
            firstMonthKey,
          })
        : null,
    [billing, firstMonthKey, project, searchParams],
  )

  // Old period params → `?period=` once (§7.1).
  useEffect(() => {
    if (!billing || !LEGACY_PERIOD_PARAMS.some((p) => searchParams.has(p))) return
    const next = new URLSearchParams(searchParams.toString())
    const offset = Number(searchParams.get("cycleOffset"))
    if (Number.isInteger(offset) && offset < 0 && billing.periods.length > 0) {
      const target = billing.periods[Math.min(billing.periods.length - 1, -offset)]
      next.set("period", target.key)
    }
    for (const p of LEGACY_PERIOD_PARAMS) next.delete(p)
    navigate(next, "replace")
  }, [billing, navigate, searchParams])

  const projectTaskIds = useMemo(() => {
    if (!monthlyData) return []
    return Array.from(
      new Set(
        monthlyData.flatMap((month) => [
          ...month.billableCategoryGroups.flatMap((group) => group.tasks.map((task) => task.taskId)),
          ...month.nonBillableCategoryGroups.flatMap((group) => group.tasks.map((task) => task.taskId)),
        ]),
      ),
    )
  }, [monthlyData])

  // Set rate (§5.3) lands on the retainer settings section.
  const section = searchParams.get("section")
  useEffect(() => {
    if (effectiveTab !== "settings" || !section) return
    const id = requestAnimationFrame(() => {
      document.getElementById(`${section}-section`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => cancelAnimationFrame(id)
  }, [effectiveTab, section, project])

  const [sidePanelOpen, setSidePanelOpen] = useSidePanel()

  if (project === undefined) return <ProjectDetailSkeleton />
  if (project === null) notFound()

  const withSidePanel = effectiveTab === "overview"

  return (
    <div data-full-bleed className="flex min-w-0 flex-col border-t border-border/60">
      <div className="px-4 py-4 md:px-6">
        <ProjectDetailHeader
          projectId={projectId}
          project={project}
          lastLoggedDate={overview?.lastLoggedDate ?? undefined}
          onTabChange={setTab}
        />
      </div>

      <Tabs value={effectiveTab} onValueChange={setTab} className="gap-0">
        <div className="flex items-center gap-2 overflow-x-auto border-y border-border/60 px-4 py-2 md:px-6">
          <TabsList variant="pill" aria-label="Project sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            {isBillable && <TabsTrigger value="time">Time</TabsTrigger>}
            {isBillable && <TabsTrigger value="invoices">Invoices</TabsTrigger>}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <span className="flex-1" />
          {withSidePanel ? (
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label={sidePanelOpen ? "Hide side panel" : "Show side panel"}
              aria-pressed={sidePanelOpen}
              title="Toggle side panel"
              onClick={() => setSidePanelOpen(!sidePanelOpen)}
            >
              <PanelNavIcon />
            </Button>
          ) : null}
        </div>

        {/* Mount only the active tab — TabsContent + conditional render keeps
            heavy children (ProjectTime entry list) out of the tree until selected. */}
        <TabsContent value="overview" className="m-0 min-w-0">
          {effectiveTab === "overview" && (
            <div className="flex min-h-0">
              <div className="min-w-0 flex-1 px-4 pt-6 pb-16 md:px-6">
                {selected ? (
                  <ProjectOverviewMain
                    projectId={projectId}
                    projectName={project.name}
                    billingType={project.billingType}
                    model={billing ?? null}
                    selected={selected}
                    firstMonthKey={firstMonthKey}
                    onSelect={selectPeriodKey}
                    onLogTime={() => setTab("time")}
                  />
                ) : (
                  <TaskTableSkeleton rows={6} />
                )}
              </div>
              {sidePanelOpen ? (
                <aside className="flex w-[300px] shrink-0 flex-col gap-3 border-l border-border/60 bg-muted/40 px-3 py-4">
                  {billing && selected ? (
                    <ProjectBillingCard projectId={projectId} model={billing} selected={selected} onSelect={selectPeriodKey} />
                  ) : null}
                  <ProjectPropertiesCards project={project} model={billing ?? null} />
                </aside>
              ) : null}
            </div>
          )}
        </TabsContent>

        {/* The project's tasks: the task-view preset `surface: "project"`
            (views, display options, filters as on /tasks; no Client column). */}
        <TabsContent value="tasks" className="m-0 min-w-0 p-4 md:p-6">
          {effectiveTab === "tasks" && (
            <Suspense fallback={<TaskTableSkeleton />}>
              <TaskView surface="project" projectId={projectId} fromLabel={project.name} embedded />
            </Suspense>
          )}
        </TabsContent>

        {isBillable && (
          <TabsContent value="time" className="m-0 min-w-0 p-4 md:p-6">
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

        {isBillable && (
          <TabsContent value="invoices" className="m-0 min-w-0 p-4 md:p-6">
            {effectiveTab === "invoices" && <ProjectInvoices projectId={projectId} project={project} />}
          </TabsContent>
        )}

        <TabsContent value="settings" className={cn("m-0 min-w-0 p-4 md:p-6")}>
          {effectiveTab === "settings" && (
            <div className="flex flex-col gap-6">
              <SettingsGeneral projectId={projectId} project={project} />
              {project.billingType === "fixed" && (
                <SettingsBudgetEstimates
                  projectId={projectId}
                  project={project}
                  teamMembers={project.teamMembers}
                  defaultAssignees={project.defaultAssignees}
                />
              )}
              {project.billingType === "t_and_m" && (
                <SettingsRates
                  projectId={projectId}
                  project={project}
                  teamMembers={project.teamMembers}
                  defaultAssignees={project.defaultAssignees}
                />
              )}
              {project.billingType === "retainer" && <SettingsRetainer projectId={projectId} project={project} />}
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

      {/* Task detail — route-driven (?task= / ?detail=). The Tasks tab and the
          Overview's Work list mount their own (stepping through their rows). */}
      {effectiveTab !== "tasks" && effectiveTab !== "overview" && (
        <TaskDetailDrawer taskIds={projectTaskIds} isAdmin={isAdmin ?? false} />
      )}
    </div>
  )
}

const SIDE_PANEL_KEY = "project-side-panel-open"

/** The Overview side panel toggle (§7.2): remembered per browser, closed by default under 1200px. */
function useSidePanel(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem(SIDE_PANEL_KEY)
      if (stored !== null) return stored === "1"
    } catch {
      // Storage unavailable: fall through to the width default.
    }
    return typeof window === "undefined" || window.innerWidth >= 1200
  })
  const update = useCallback((next: boolean) => {
    setOpen(next)
    try {
      window.localStorage.setItem(SIDE_PANEL_KEY, next ? "1" : "0")
    } catch {
      // Storage unavailable: the toggle still works for this visit.
    }
  }, [])
  return [open, update]
}
