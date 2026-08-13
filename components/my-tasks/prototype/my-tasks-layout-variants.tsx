"use client"

// PROTOTYPE — throwaway code, not production.
// Three structurally different answers to "how are the non-Today parts of My
// Tasks demoted?", switchable via ?variant= on the real /my-tasks route with
// real data (wayfinder ticket 01, .scratch/my-tasks-revamp).
//   a — Collapsed stack: Today hero; everything else collapses to quiet
//       one-line headers below a divider. Earlier/status groups deduped.
//   b — Dimmed inline: everything stays visible, but the non-Today zone is
//       genuinely dimmed until hovered; deduped; compact Today empty state.
//   c — Today / All work: navigation-based demotion — a quiet toggle; Today
//       tab holds only the plan (+ a one-line Earlier nudge), All work holds
//       the full current truth (duplicates and all).
// No drag-reorder and no per-group inline add in variants — not the question.

import { useMemo, useState } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HistoryIcon,
  SunIcon,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { MyTasksList } from "@/components/my-tasks/my-tasks-list"
import { MyTasksGroup } from "@/components/my-tasks/my-tasks-group"
import { MyTaskRow } from "@/components/my-tasks/my-task-row"
import { MyTasksInlineAdd } from "@/components/my-tasks/my-tasks-inline-add"
import { MyTasksEmptyState } from "@/components/my-tasks/my-tasks-empty-state"
import { TodayEarlierSection, type EarlierTask } from "@/components/my-tasks/today-earlier-section"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { MyTasksGroup as MyTasksGroupType } from "@/convex/lib/myTaskHelpers"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { StatusType } from "@/convex/lib/constants"
import type { Id } from "@/convex/_generated/dataModel"
import { usePrototypeVariant } from "./prototype-switcher"

// Same prop surface as MyTasksList — the gate swaps only the rendering.
type ListProps = {
  groups: MyTasksGroupType<TaskWithJoins>[]
  timeMap?: Record<string, number>
  activityMap?: Record<string, ActivityIndicator>
  detailId: string | null
  currentUserId: Id<"users">
  todayStr: string
  onOpenDetail: (taskId: string) => void
  onComplete: (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => void
  defaultStatusId?: Id<"statuses">
}

/** Drop-in replacement for MyTasksList: renders a variant when ?variant= is set. */
export function MyTasksListWithPrototype(props: ListProps) {
  const variant = usePrototypeVariant()
  // Keep hook order stable across variants
  const searchParams = useSearchParams()
  void searchParams
  if (variant === "a") return <VariantACollapsedStack {...props} />
  if (variant === "b") return <VariantBDimmedInline {...props} />
  if (variant === "c") return <VariantCTodayAllWork {...props} />
  if (variant === "d") return <VariantDSectionTabs {...props} />
  if (variant === "e") return <VariantETabsCollapsible {...props} />
  if (variant === "f") return <VariantFTodayEarlierAll {...props} />
  return <MyTasksList {...props} />
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

function splitGroups(groups: MyTasksGroupType<TaskWithJoins>[]) {
  const todayGroup = groups.find((g) => g.key === "today")
  const completedGroup = groups.find((g) => g.key === "completed_today")
  const statusGroups = groups.filter(
    (g) => g.key !== "today" && g.key !== "completed_today",
  )
  const earlier = (todayGroup?.earlierTasks ?? []) as EarlierTask[]
  return { todayGroup, completedGroup, statusGroups, earlier }
}

/** Whole-day difference between two YYYY-MM-DD strings (copied from today-earlier-section — throwaway). */
function ageLabel(endDate: string | undefined, todayStr: string): string | undefined {
  if (!endDate) return undefined
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const days = Math.round((utc(todayStr) - utc(endDate)) / 86_400_000)
  return days <= 0 ? undefined : `${days}d`
}

/** The Today hero: sun header, rows, inline add. Empty state is a single quiet line, not an illustration. */
function TodaySection({
  todayGroup,
  compactEmpty,
  hideHeader,
  ...rest
}: ListProps & {
  todayGroup?: MyTasksGroupType<TaskWithJoins>
  compactEmpty?: boolean
  /** In tabbed variants the tab already says "Today" — skip the double header. */
  hideHeader?: boolean
}) {
  const tasks = todayGroup?.tasks ?? []
  return (
    <div className="mt-2">
      {!hideHeader && (
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-sm font-medium">
          <SunIcon className="size-4 text-amber-500" />
          <span>Today</span>
          <span className="text-xs text-muted-foreground/60">{tasks.length}</span>
          <span className="truncate text-xs font-normal text-muted-foreground/50">
            the Planner&apos;s plan for today
          </span>
        </div>
      )}
      {tasks.length === 0 &&
        (compactEmpty ? (
          <p className="px-3 py-3 text-sm text-muted-foreground/60">
            Nothing planned for today — add a task below, or schedule one in the
            Planner.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <SunIcon className="size-6 text-muted-foreground/30" />
            <p className="text-sm font-medium">Nothing planned for today</p>
            <p className="max-w-sm text-xs text-muted-foreground/60">
              Add a task with the sun icon, or schedule it in the Planner.
            </p>
          </div>
        ))}
      <ul className="list-none">
        {tasks.map((task) => (
          <li key={task._id} className="list-none">
            <MyTaskRow
              task={task}
              totalMinutes={rest.timeMap?.[task._id]}
              activity={rest.activityMap?.[task._id]}
              isTodayRow
              currentUserId={rest.currentUserId}
              onOpenDetail={rest.onOpenDetail}
              onComplete={rest.onComplete}
              defaultStatusId={rest.defaultStatusId}
              isDetailOpen={rest.detailId === task._id}
            />
          </li>
        ))}
      </ul>
      <MyTasksInlineAdd currentUserId={rest.currentUserId} today />
    </div>
  )
}

/**
 * Earlier rows: age chip + "move to today" sun kept. `undimmed` kills the
 * production opacity-55 demotion (needed when Earlier is its own tab — a
 * dedicated tab must not render half-faded; the dimming was an inline-section
 * device). No gutter spacer: every row starts on the same left line as the
 * headers.
 */
function EarlierRows({
  tasks,
  todayStr,
  undimmed,
  ...rest
}: ListProps & { tasks: EarlierTask[]; undimmed?: boolean }) {
  return (
    <ul className="list-none">
      {tasks.map((task) => (
        <li
          key={task._id}
          className={cn("list-none", undimmed && "[&_[role=button]]:opacity-100!")}
        >
          <MyTaskRow
            task={task}
            totalMinutes={rest.timeMap?.[task._id]}
            activity={rest.activityMap?.[task._id]}
            isEarlierRow
            earlierAgeLabel={ageLabel(task.plannedEndDate, todayStr)}
            onOpenDetail={rest.onOpenDetail}
            onComplete={rest.onComplete}
            defaultStatusId={rest.defaultStatusId}
            isDetailOpen={rest.detailId === task._id}
          />
        </li>
      ))}
    </ul>
  )
}

/** Quiet demoted section: muted one-line header, collapsed by default. */
function QuietSection({
  label,
  count,
  hint,
  icon,
  defaultOpen = false,
  children,
}: {
  label: string
  count: number
  hint?: string
  icon?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {icon}
        <span>{label}</span>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        {hint ? (
          <span className="truncate text-xs text-muted-foreground/50">{hint}</span>
        ) : null}
        <span className="ml-auto">
          {open ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground/50" />
          )}
        </span>
      </button>
      {open && children}
    </div>
  )
}

/** Status-group rows shared by the variants (plain rows, no drag). */
function StatusGroupRows({
  tasks,
  isCompletedToday,
  ...rest
}: ListProps & { tasks: TaskWithJoins[]; isCompletedToday?: boolean }) {
  return (
    <ul className="list-none">
      {tasks.map((task) => (
        <li key={task._id} className="list-none">
          <MyTaskRow
            task={task}
            totalMinutes={rest.timeMap?.[task._id]}
            activity={rest.activityMap?.[task._id]}
            isCompletedToday={isCompletedToday}
            onOpenDetail={rest.onOpenDetail}
            onComplete={rest.onComplete}
            defaultStatusId={rest.defaultStatusId}
            isDetailOpen={rest.detailId === task._id}
          />
        </li>
      ))}
    </ul>
  )
}

function useHasAnyTasks(groups: MyTasksGroupType<TaskWithJoins>[]) {
  return useMemo(
    () =>
      groups.some((g) => g.tasks.length > 0) ||
      groups.some((g) => (g.earlierTasks?.length ?? 0) > 0),
    [groups],
  )
}

// ─── Variant A — Collapsed stack ────────────────────────────────────────────

function VariantACollapsedStack(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const earlierIds = new Set(earlier.map((t) => t._id as string))
  if (!hasAny) return <MyTasksEmptyState />

  return (
    <div>
      <TodaySection {...props} todayGroup={todayGroup} compactEmpty />

      {/* Demoted zone: one divider, then quiet collapsed one-liners. */}
      <div className="mt-10 space-y-0.5 border-t border-border/40 pt-3">
        {earlier.length > 0 && (
          <QuietSection
            label="Earlier"
            count={earlier.length}
            hint="move or let go"
            icon={<HistoryIcon className="size-4 text-muted-foreground/50" />}
          >
            <EarlierRows {...props} tasks={earlier} />
          </QuietSection>
        )}

        {statusGroups.map((group) => {
          const tasks = group.tasks.filter((t) => !earlierIds.has(t._id as string))
          const inEarlier = group.tasks.length - tasks.length
          if (tasks.length === 0 && inEarlier === 0) return null
          const hints = [
            group.inTodayCount ? `${group.inTodayCount} in Today` : null,
            inEarlier ? `${inEarlier} in Earlier` : null,
          ].filter(Boolean)
          return (
            <QuietSection
              key={group.key}
              label={group.label}
              count={tasks.length}
              hint={hints.length ? `· ${hints.join(" · ")}` : undefined}
            >
              <StatusGroupRows {...props} tasks={tasks} />
            </QuietSection>
          )
        })}

        {completedGroup && completedGroup.count > 0 && (
          <QuietSection label="Completed today" count={completedGroup.count}>
            <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
          </QuietSection>
        )}
      </div>
    </div>
  )
}

// ─── Variant B — Dimmed inline ──────────────────────────────────────────────

function VariantBDimmedInline(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const earlierIds = new Set(earlier.map((t) => t._id as string))
  if (!hasAny) return <MyTasksEmptyState />

  const sectionHeader = (label: string, count: number, hint?: string) => (
    <div className="flex items-baseline gap-2 border-b border-border/40 px-3 pb-1.5 pt-6">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="text-[11px] text-muted-foreground/50">{count}</span>
      {hint ? <span className="text-[11px] text-muted-foreground/40">{hint}</span> : null}
    </div>
  )

  return (
    <div>
      <TodaySection {...props} todayGroup={todayGroup} compactEmpty />

      {/* Everything below stays visible but genuinely demoted: dimmed until
          the section is hovered. Duplicates removed — a leftover lives in
          Earlier only. */}
      <div className="mt-6">
        {earlier.length > 0 && (
          <section className="opacity-55 transition-opacity duration-200 hover:opacity-100">
            {sectionHeader("Earlier", earlier.length, "move or let go")}
            <EarlierRows {...props} tasks={earlier} />
          </section>
        )}

        {statusGroups.map((group) => {
          const tasks = group.tasks.filter((t) => !earlierIds.has(t._id as string))
          if (tasks.length === 0) return null
          const inEarlier = group.tasks.length - tasks.length
          const hints = [
            group.inTodayCount ? `${group.inTodayCount} in Today` : null,
            inEarlier ? `${inEarlier} in Earlier` : null,
          ].filter(Boolean)
          return (
            <section
              key={group.key}
              className="opacity-55 transition-opacity duration-200 hover:opacity-100"
            >
              {sectionHeader(group.label, tasks.length, hints.length ? `· ${hints.join(" · ")}` : undefined)}
              <StatusGroupRows {...props} tasks={tasks} />
            </section>
          )
        })}

        {completedGroup && completedGroup.count > 0 && (
          <section className="opacity-55 transition-opacity duration-200 hover:opacity-100">
            {sectionHeader("Completed today", completedGroup.count)}
            <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
          </section>
        )}
      </div>
    </div>
  )
}

// ─── Variant C — Today / All work ───────────────────────────────────────────

function VariantCTodayAllWork(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const [tab, setTab] = useState<"today" | "all">("today")
  const { statuses } = useTaskReferenceData()
  const statusColorMap = useMemo(() => {
    if (!statuses) return new Map<string, string>()
    return new Map(statuses.map((s) => [s._id as string, getStatusColor(s.color).dot]))
  }, [statuses])
  if (!hasAny) return <MyTasksEmptyState />

  const allCount =
    statusGroups.reduce((sum, g) => sum + g.tasks.length, 0) + earlier.length

  return (
    <div>
      {/* Quiet ghost toggle, counts as muted text (no pills). */}
      <div className="flex items-center gap-1 px-3 pt-1">
        {(
          [
            { key: "today", label: "Today", count: todayGroup?.tasks.length ?? 0 },
            { key: "all", label: "All work", count: allCount },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
              tab === t.key
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-xs text-muted-foreground/60">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "today" ? (
        <div>
          <TodaySection {...props} todayGroup={todayGroup} />
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("all")}
              className="mt-6 flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HistoryIcon className="size-4 text-muted-foreground/50" />
              <span>
                {earlier.length} planned earlier still open — review in All work
              </span>
              <ChevronRightIcon className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div>
          <TodayEarlierSection
            tasks={earlier}
            todayStr={props.todayStr}
            timeMap={props.timeMap}
            activityMap={props.activityMap}
            detailId={props.detailId}
            onOpenDetail={props.onOpenDetail}
            onComplete={props.onComplete}
            defaultStatusId={props.defaultStatusId}
          />
          {statusGroups.map((group) => (
            <MyTasksGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              count={group.count}
              statusType={(group.statusType as StatusType) ?? "backlog"}
              statusColor={
                group.statusId
                  ? (statusColorMap.get(group.statusId as string) ?? "gray")
                  : "gray"
              }
              inTodayCount={group.inTodayCount}
            >
              <StatusGroupRows {...props} tasks={group.tasks} />
            </MyTasksGroup>
          ))}
          {completedGroup && completedGroup.count > 0 && (
            <MyTasksGroup
              groupKey={completedGroup.key}
              label={completedGroup.label}
              count={completedGroup.count}
              statusType="done"
              statusColor="teal"
              defaultOpen={completedGroup.count <= 10}
            >
              <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
            </MyTasksGroup>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Variant D — Section tabs ───────────────────────────────────────────────
// C's follow-up question made concrete: every section (Earlier, Backlog,
// In progress, Review, …) is its OWN tab, so the separation is total.
// Duplicates across tabs are kept (Earlier vs its status tab) — react to that.

function VariantDSectionTabs(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const [tab, setTab] = useState<string>("today")
  if (!hasAny) return <MyTasksEmptyState />

  const tabs = [
    { key: "today", label: "Today", count: todayGroup?.tasks.length ?? 0 },
    ...(earlier.length > 0
      ? [{ key: "earlier", label: "Earlier", count: earlier.length }]
      : []),
    ...statusGroups
      .filter((g) => g.tasks.length > 0)
      .map((g) => ({ key: g.key, label: g.label, count: g.tasks.length })),
    ...(completedGroup && completedGroup.count > 0
      ? [{ key: "completed_today", label: "Done today", count: completedGroup.count }]
      : []),
  ]
  const active = tabs.some((t) => t.key === tab) ? tab : "today"
  const activeStatusGroup = statusGroups.find((g) => g.key === active)

  return (
    <div>
      {/* Quiet ghost tabs, counts as muted text (no pills). */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-3 pb-2 pt-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
              active === t.key
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-xs text-muted-foreground/60">{t.count}</span>
          </button>
        ))}
      </div>

      {active === "today" && (
        <div>
          <TodaySection {...props} todayGroup={todayGroup} />
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("earlier")}
              className="mt-6 flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HistoryIcon className="size-4 text-muted-foreground/50" />
              <span>{earlier.length} planned earlier still open — review</span>
              <ChevronRightIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {active === "earlier" && (
        <div className="mt-2">
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground/60">
            planned earlier, still open — move to today or let go
          </div>
          <EarlierRows {...props} tasks={earlier} />
        </div>
      )}

      {activeStatusGroup && (
        <div className="mt-2">
          <StatusGroupRows {...props} tasks={activeStatusGroup.tasks} />
        </div>
      )}

      {active === "completed_today" && completedGroup && (
        <div className="mt-2">
          <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
        </div>
      )}
    </div>
  )
}

// ─── Variant E — C's two tabs + collapsible All work sections ───────────────
// The owner-requested hybrid: keep C's Today / All work toggle, but inside
// All work every section is a quiet, collapsible header (borrowed from A).
// Sections default open (All work stays an overview); Done today defaults
// closed. Duplicates kept for now (Earlier vs status group) — still open.

function VariantETabsCollapsible(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const [tab, setTab] = useState<"today" | "all">("today")
  if (!hasAny) return <MyTasksEmptyState />

  const allCount =
    statusGroups.reduce((sum, g) => sum + g.tasks.length, 0) + earlier.length

  return (
    <div>
      <div className="flex items-center gap-1 px-3 pt-1">
        {(
          [
            { key: "today", label: "Today", count: todayGroup?.tasks.length ?? 0 },
            { key: "all", label: "All work", count: allCount },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
              tab === t.key
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-xs text-muted-foreground/60">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "today" ? (
        <div>
          <TodaySection {...props} todayGroup={todayGroup} />
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("all")}
              className="mt-6 flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HistoryIcon className="size-4 text-muted-foreground/50" />
              <span>
                {earlier.length} planned earlier still open — review in All work
              </span>
              <ChevronRightIcon className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-0.5">
          {earlier.length > 0 && (
            <QuietSection
              label="Earlier"
              count={earlier.length}
              hint="move or let go"
              icon={<HistoryIcon className="size-4 text-muted-foreground/50" />}
              defaultOpen
            >
              <EarlierRows {...props} tasks={earlier} />
            </QuietSection>
          )}

          {statusGroups.map((group) => {
            if (group.tasks.length === 0) return null
            return (
              <QuietSection
                key={group.key}
                label={group.label}
                count={group.tasks.length}
                hint={
                  group.inTodayCount ? `· ${group.inTodayCount} in Today` : undefined
                }
                defaultOpen
              >
                <StatusGroupRows {...props} tasks={group.tasks} />
              </QuietSection>
            )
          })}

          {completedGroup && completedGroup.count > 0 && (
            <QuietSection label="Done today" count={completedGroup.count}>
              <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
            </QuietSection>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Variant F — Today / Earlier / All work ─────────────────────────────────
// Owner-proposed round 3: Earlier is promoted to its OWN tab — it is
// semantically different from a status group ("we already started these";
// the move-or-let-go triage ritual). All work becomes the pure status
// overview with E's collapsible quiet sections. Duplication is resolved by
// meaning: Earlier tab = plan leftovers, All work = status truth; overlap is
// flagged on section headers as "· N in Earlier".

function VariantFTodayEarlierAll(props: ListProps) {
  const { todayGroup, completedGroup, statusGroups, earlier } = splitGroups(props.groups)
  const hasAny = useHasAnyTasks(props.groups)
  const [tab, setTab] = useState<"today" | "earlier" | "all">("today")
  const earlierIds = new Set(earlier.map((t) => t._id as string))
  if (!hasAny) return <MyTasksEmptyState />

  const allCount = statusGroups.reduce((sum, g) => sum + g.tasks.length, 0)

  const tabs = [
    { key: "today", label: "Today", count: todayGroup?.tasks.length ?? 0 },
    { key: "earlier", label: "Earlier", count: earlier.length },
    { key: "all", label: "All work", count: allCount },
  ] as const

  return (
    <div>
      <div className="flex items-center gap-1 px-3 pt-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
              tab === t.key
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-xs text-muted-foreground/60">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "today" && (
        <div>
          {/* No section header — the tab already says Today. */}
          <TodaySection {...props} todayGroup={todayGroup} hideHeader />
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setTab("earlier")}
              className="mt-6 flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HistoryIcon className="size-4 text-muted-foreground/50" />
              <span>
                {earlier.length} planned earlier still open — move or let go
              </span>
              <ChevronRightIcon className="size-3.5" />
            </button>
          )}
          {/* Completing a Today task drops it into a Done block right here —
              the ceremony stays on the tab where the work happened. */}
          {completedGroup && completedGroup.count > 0 && (
            <div className="mt-8">
              <QuietSection label="Done" count={completedGroup.count} defaultOpen>
                <StatusGroupRows {...props} tasks={completedGroup.tasks} isCompletedToday />
              </QuietSection>
            </div>
          )}
        </div>
      )}

      {tab === "earlier" && (
        <div className="mt-2">
          <div className="px-3 py-2 text-xs text-muted-foreground/60">
            planned earlier, still open — move to today or let go
          </div>
          {earlier.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground/60">
              Nothing left over — everything you planned is done or moved. 🎉
            </p>
          ) : (
            <EarlierRows {...props} tasks={earlier} undimmed />
          )}
        </div>
      )}

      {tab === "all" && (
        <div className="mt-3 space-y-0.5">
          {statusGroups.map((group) => {
            if (group.tasks.length === 0) return null
            const inEarlier = group.tasks.filter((t) =>
              earlierIds.has(t._id as string),
            ).length
            const hints = [
              group.inTodayCount ? `${group.inTodayCount} in Today` : null,
              inEarlier ? `${inEarlier} in Earlier` : null,
            ].filter(Boolean)
            return (
              <QuietSection
                key={group.key}
                label={group.label}
                count={group.tasks.length}
                hint={hints.length ? `· ${hints.join(" · ")}` : undefined}
                defaultOpen
              >
                <StatusGroupRows {...props} tasks={group.tasks} />
              </QuietSection>
            )
          })}
          {/* No Done section here — done-today lives on the Today tab. */}
        </div>
      )}
    </div>
  )
}
