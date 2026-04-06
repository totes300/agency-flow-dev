"use client"

import { useCallback, useMemo, useState, useEffect, useRef } from "react"
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
import { DailyNotesPanel, type SaveStatus } from "@/components/my-tasks/daily-notes-panel"
import { useConfetti } from "@/components/my-tasks/completion-confetti"
import { getTodayString } from "@/lib/daily-notes-helpers"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
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

  // Admin viewing another user's notes via ?user=<userId>
  const viewingUserId = searchParams.get("user") as Id<"users"> | null

  const { triggerConfetti, confettiPortal } = useConfetti()
  const [mobileTab, setMobileTab] = useState<"tasks" | "notes">("tasks")
  const isMobile = useIsMobile()

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
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const categories = useQuery(api.workCategories.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")
  const orgMembersData = useQuery(api.orgMembers.listOrgMembers, isAuthenticated ? undefined : "skip")
  const referenceData = useMemo(() => ({
    statuses,
    categories,
    projects,
    orgMembers: orgMembersData,
  }), [statuses, categories, projects, orgMembersData])

  // Resolve completion default based on role
  const completionDefaultStatusId = useMemo(() => {
    if (!orgSettings || !statuses) return undefined
    const roleDefault = isAdmin
      ? orgSettings.completionDefaultAdminStatusId
      : orgSettings.completionDefaultMemberStatusId
    if (roleDefault) return roleDefault
    // Fallback: first "done" type status
    return statuses.find((s) => s.type === "done")?._id
  }, [orgSettings, statuses, isAdmin])

  // ─── Daily Notes ────────────────────────────────────────────────────────
  const today = useMemo(() => getTodayString(), [])
  const [noteDate, setNoteDate] = useState(() => getTodayString())
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Admin can view another user's notes via ?user= param
  const noteTargetUserId = (isAdmin && viewingUserId) ? viewingUserId : currentUser?._id
  const viewingOtherUser = isAdmin && viewingUserId && currentUser && viewingUserId !== currentUser._id

  // Resolve target user name from org members
  const viewingUserName = useMemo(() => {
    if (!viewingOtherUser || !orgMembersData) return null
    const member = orgMembersData.find((m) => m._id === viewingUserId)
    return member?.name ?? "Team member"
  }, [viewingOtherUser, orgMembersData, viewingUserId])

  const upsertNote = useMutation(api.dailyNotes.upsert)
  const noteData = useQuery(
    api.dailyNotes.get,
    isAuthenticated && noteTargetUserId
      ? { userId: noteTargetUserId, date: noteDate }
      : "skip",
  )

  const handleNoteChange = useCallback((json: string) => {
    if (!noteTargetUserId) return
    setSaveStatus("saving")

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)

    debounceRef.current = setTimeout(async () => {
      try {
        await upsertNote({ userId: noteTargetUserId, date: noteDate, content: json })
        setSaveStatus("saved")
        savedTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000)
      } catch {
        setSaveStatus("error")
      }
    }, 500)
  }, [noteTargetUserId, noteDate, upsertNote])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
    }
  }, [])

  // ─── Tasks ──────────────────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    if (!myTasks) return []
    return myTasks.groups as MyTasksGroup<TaskWithJoins>[]
  }, [myTasks])

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

  // Refs for stable callbacks — avoid defeating React.memo on child rows
  const myTasksRef = useRef(myTasks)
  myTasksRef.current = myTasks
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams

  // Use first visible status for FAB creation
  const primaryStatusId = useMemo(() => {
    if (!myTasks?.visibleStatusIds?.length) return undefined
    return myTasks.visibleStatusIds[0] as Id<"statuses">
  }, [myTasks?.visibleStatusIds])

  // Completion handler with undo support (reads myTasks via ref for stable identity)
  const handleComplete = useCallback(async (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => {
    const currentMyTasks = myTasksRef.current
    const allTasks = currentMyTasks?.groups.flatMap((g: MyTasksGroup<TaskWithJoins>) => g.tasks) ?? []
    const task = allTasks.find((t: TaskWithJoins) => t._id === taskId)
    const previousStatusId = task?.statusId as Id<"statuses"> | undefined

    try {
      await updateTask({ id: taskId as Id<"tasks">, statusId })
      triggerConfetti(coords?.x, coords?.y)
      const status = statuses?.find((s) => s._id === statusId)
      const message = status?.type === "done"
        ? "Task completed"
        : `Sent to ${status?.name ?? "review"}`

      toast.success(message, {
        duration: 5000,
        action: previousStatusId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await updateTask({ id: taskId as Id<"tasks">, statusId: previousStatusId })
                } catch (err) {
                  toastError(err, "Failed to undo")
                }
              },
            }
          : undefined,
      })
    } catch (err) {
      toastError(err, "Failed to update task")
    }
  }, [updateTask, statuses, triggerConfetti])

  // Open task detail via URL param (reads searchParams via ref for stable identity)
  const handleOpenDetail = useCallback((taskId: string) => {
    const url = buildDetailUrl(searchParamsRef.current, taskId as Id<"tasks">)
    router.push(`${pathname}${url}`, { scroll: false })
  }, [router, pathname])

  if (!isAuthenticated || currentUser === undefined || currentUser === null || myTasks === undefined) {
    return <MyTasksSkeleton />
  }

  return (
    <TaskReferenceDataProvider value={referenceData}>
      {/* Admin banner when viewing another user's notes */}
      {viewingOtherUser && (
        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm">
          <Link
            href="/my-tasks"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to my tasks
          </Link>
          <span className="text-muted-foreground">|</span>
          <span>
            Viewing <strong>{viewingUserName}</strong>&apos;s notes
          </span>
        </div>
      )}

      {/* ─── Mobile: tab switcher (<lg) ─── */}
      <div className="flex gap-1 border-b border-border/40 lg:hidden">
        <button
          type="button"
          className={cn(
            "px-3 py-2 text-sm font-medium transition-colors",
            mobileTab === "tasks"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setMobileTab("tasks")}
        >
          My Tasks
        </button>
        <button
          type="button"
          className={cn(
            "px-3 py-2 text-sm font-medium transition-colors",
            mobileTab === "notes"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setMobileTab("notes")}
        >
          Notes
        </button>
      </div>

      {/* ─── Desktop: split view (lg+) ─── */}
      <div className="mt-8 hidden min-h-0 flex-1 gap-0 lg:flex">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="max-w-3xl lg:pl-6">
            <MyTasksHeader
              todayMinutes={todayMinutes ?? 0}
              visibleStatusIds={myTasks.visibleStatusIds ?? []}
              orgDefaultStatusIds={orgSettings?.defaultMyTasksStatusIds?.map(String)}
            />

            <MyTasksList
              groups={filteredGroups}
              timeMap={timeMap ?? undefined}
              activityMap={activityMap ?? undefined}
              detailId={detailId}
              currentUserId={currentUser._id}
              onOpenDetail={handleOpenDetail}
              onComplete={handleComplete}
              defaultStatusId={completionDefaultStatusId}
            />
          </div>
        </div>

        <div className="w-[480px] shrink-0 border-l border-border/20">
          <DailyNotesPanel
            today={today}
            content={noteData?.content ?? null}
            onContentChange={handleNoteChange}
            saveStatus={saveStatus}
            selectedDate={noteDate}
            onDateChange={setNoteDate}
            userName={viewingOtherUser ? viewingUserName ?? undefined : currentUser.name}
            userImageUrl={viewingOtherUser ? undefined : currentUser.imageUrl ?? undefined}
            lastUpdatedAt={noteData?.updatedAt}
          />
        </div>
      </div>

      {/* ─── Mobile: content area (<lg) ─── */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto lg:hidden">
        {mobileTab === "tasks" ? (
          <>
            <MyTasksHeader
              todayMinutes={todayMinutes ?? 0}
              visibleStatusIds={myTasks.visibleStatusIds ?? []}
              orgDefaultStatusIds={orgSettings?.defaultMyTasksStatusIds?.map(String)}
            />

            <MyTasksList
              groups={filteredGroups}
              timeMap={timeMap ?? undefined}
              activityMap={activityMap ?? undefined}
              detailId={detailId}
              currentUserId={currentUser._id}
              onOpenDetail={handleOpenDetail}
              onComplete={handleComplete}
              defaultStatusId={completionDefaultStatusId}
            />
          </>
        ) : (
          <DailyNotesPanel
            today={today}
            content={noteData?.content ?? null}
            onContentChange={handleNoteChange}
            saveStatus={saveStatus}
            selectedDate={noteDate}
            onDateChange={setNoteDate}
            userName={viewingOtherUser ? viewingUserName ?? undefined : currentUser.name}
            userImageUrl={viewingOtherUser ? undefined : currentUser.imageUrl ?? undefined}
            lastUpdatedAt={noteData?.updatedAt}
          />
        )}
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
        todayStatusId={primaryStatusId}
        currentUserId={currentUser._id}
      />

      {confettiPortal}
    </TaskReferenceDataProvider>
  )
}
