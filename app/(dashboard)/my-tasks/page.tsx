"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { buildDetailUrl, parseDetailParam } from "@/lib/task-detail"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { MyTasksHeader } from "@/components/my-tasks/my-tasks-header"
import { MyTasksList } from "@/components/my-tasks/my-tasks-list"
import { MyTasksSkeleton } from "@/components/my-tasks/my-tasks-skeleton"
import { MobileFab } from "@/components/my-tasks/mobile-fab"
import { useConfetti } from "@/components/my-tasks/completion-confetti"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { MyTasksGroup } from "@/convex/lib/myTaskHelpers"

export default function MyTasksPage() {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const detailId = parseDetailParam(searchParams)

  const { triggerConfetti, confettiPortal } = useConfetti()
  const [search, setSearch] = useState("")

  // Responsive: force modal on mobile
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const rawViewPref = currentUser?.taskDetailView ?? "drawer"
  const viewPref = isMobile ? "modal" : rawViewPref

  const todayMinutes = useQuery(
    api.timeEntries.sumMyToday,
    isAuthenticated ? {} : "skip",
  )
  const myTasks = useQuery(
    api.myTasks.listMyTasks,
    isAuthenticated ? {} : "skip",
  )

  // Reference data for drawer + status picker
  const statuses = useQuery(api.statuses.list, isAuthenticated ? {} : "skip")
  const categories = useQuery(api.workCategories.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")
  const orgMembersData = useQuery(api.orgMembers.listOrgMembers, isAuthenticated ? undefined : "skip")
  const referenceData = useMemo(() => ({
    statuses,
    categories,
    projects,
    orgMembers: orgMembersData,
  }), [statuses, categories, projects, orgMembersData])

  // Client-side search filter
  const filteredGroups = useMemo(() => {
    if (!myTasks) return []
    const groups = myTasks.groups as MyTasksGroup<TaskWithJoins>[]
    if (!search.trim()) return groups

    const q = search.trim().toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((t: TaskWithJoins) =>
          t.title.toLowerCase().includes(q),
        ),
        count: group.tasks.filter((t: TaskWithJoins) =>
          t.title.toLowerCase().includes(q),
        ).length,
      }))
      .filter((g) => g.tasks.length > 0)
  }, [myTasks, search])

  // Batch time query for all visible tasks
  const allVisibleTaskIds = useMemo(() => {
    if (!myTasks) return []
    return myTasks.groups
      .flatMap((g: MyTasksGroup<TaskWithJoins>) => g.tasks.map((t: TaskWithJoins) => t._id))
      .sort()
  }, [myTasks])

  const timeMap = useQuery(
    api.timeEntries.sumByTasks,
    isAuthenticated && allVisibleTaskIds.length > 0
      ? { taskIds: allVisibleTaskIds }
      : "skip",
  )

  const activityMap = useQuery(
    api.tasks.activityIndicators,
    isAuthenticated && allVisibleTaskIds.length > 0
      ? { taskIds: allVisibleTaskIds }
      : "skip",
  )

  const updateTask = useMutation(api.tasks.update)

  // Find "Today" named status for FAB creation
  const todayStatusId = useMemo(() => {
    if (!statuses) return undefined
    const today = statuses.find((s) => s.name === "Today")
    return today?._id
  }, [statuses])

  // Single completion handler — status picker decides the destination
  const handleComplete = useCallback(async (taskId: string, statusId: Id<"statuses">) => {
    try {
      await updateTask({ id: taskId as Id<"tasks">, statusId })
      triggerConfetti()
      const status = statuses?.find((s) => s._id === statusId)
      toast.success(
        status?.type === "done"
          ? "Task completed"
          : `Sent to ${status?.name ?? "review"}`,
      )
    } catch (err) {
      toastError(err, "Failed to update task")
    }
  }, [updateTask, statuses, triggerConfetti])

  // Open task detail via URL param
  const handleOpenDetail = useCallback((taskId: string) => {
    const url = buildDetailUrl(searchParams, taskId as Id<"tasks">)
    router.push(`${pathname}${url}`, { scroll: false })
  }, [searchParams, router, pathname])

  if (!isAuthenticated || currentUser === undefined || currentUser === null || myTasks === undefined) {
    return <MyTasksSkeleton />
  }

  return (
    <TaskReferenceDataProvider value={referenceData}>
      <div className="mx-auto w-full max-w-3xl">
        <MyTasksHeader
          todayMinutes={todayMinutes ?? 0}
          todayVisibleStatuses={currentUser?.todayVisibleStatuses}
          search={search}
          onSearchChange={setSearch}
        />

        <MyTasksList
          groups={filteredGroups}
          hiddenCount={myTasks.hiddenCount}
          timeMap={timeMap ?? undefined}
          activityMap={activityMap ?? undefined}
          detailId={detailId}
          currentUserId={currentUser._id}
          onOpenDetail={handleOpenDetail}
          onComplete={handleComplete}
        />
      </div>

      {viewPref === "drawer" ? (
        <TaskDetailDrawer
          taskIds={allVisibleTaskIds as string[]}
          isAdmin={isAdmin ?? false}
        />
      ) : (
        <TaskDetailModal
          taskIds={allVisibleTaskIds as string[]}
          isAdmin={isAdmin ?? false}
        />
      )}

      <MobileFab
        todayStatusId={todayStatusId}
        currentUserId={currentUser._id}
      />

      {confettiPortal}
    </TaskReferenceDataProvider>
  )
}
