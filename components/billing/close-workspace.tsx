"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useConvexAuth, useMutation } from "convex/react"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  ClipboardListIcon,
  InfoIcon,
  MonitorIcon,
  PlusIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PeriodStateChip } from "@/components/billing/period-state-chip"
import { closeWorkspaceHref } from "@/components/billing/period-actions"
import { CloseEntryGroups } from "@/components/billing/close-entry-groups"
import { ClosePeriodMonths } from "@/components/billing/close-period-months"
import { CloseSummaryCard } from "@/components/billing/close-summary-card"
import { EmptyStateBanner } from "@/components/projects/empty-state-banner"
import { ProjectTimeFilters } from "@/components/projects/project-time-filters"
import {
  ProjectTimeTable,
  type CloseTableConfig,
} from "@/components/projects/project-time-table"
import { useProjectTimeFilters } from "@/lib/hooks/use-project-time-filters"
import {
  applyTimeEntryFilters,
  type TimeEntryFacet,
} from "@/lib/time-entry-filters"
import type { TimeEntryGroupAxis } from "@/lib/time-entry-grouping"
import {
  summarizeCloseFlags,
  type CloseFlagKind,
} from "@/convex/lib/closeFlags"
import type { CloseWorkspaceData, CloseWorkspaceRow } from "@/convex/billingViews"

const BILLING_TYPE_LABEL: Record<
  CloseWorkspaceData["project"]["billingType"],
  string
> = {
  retainer: "Retainer",
  t_and_m: "T&M",
  fixed: "Fixed",
}

/**
 * Retainer mode is always stated — "am I in rollover?" must never be inferred
 * from the period label alone. In-progress cycles also say where the cycle
 * stands ("month 2 of 3"), which pre-empts the "why is my balance negative,
 * we're only halfway" read of a mid-cycle number.
 */
function billingModeLabel(data: CloseWorkspaceData): string {
  if (data.project.billingType !== "retainer") {
    return data.project.billingType === "t_and_m" ? "Hourly" : BILLING_TYPE_LABEL[data.project.billingType]
  }
  const months = data.monthlyBalances.length
  if (months <= 1) return "Monthly retainer"
  let label = `${months}-month rollover retainer`
  if (!data.periodElapsed && !data.isClosed) {
    const started = data.monthlyBalances.filter((row) => !row.pending).length
    label += ` · month ${Math.max(1, started)} of ${months}`
  }
  return label
}

/** The close offers member + category facets — never status (every in-scope
 *  row of an open close is "open") and never a date range (the period IS the
 *  scope; hiding part of it would misrepresent what commit covers). */
const CLOSE_FACETS: readonly TimeEntryFacet[] = ["member", "category"]

// The close ledger has no row selection — stable no-op table props.
const NO_SELECTION = new Set<string>()
const noop = () => {}

/** Modal state — closed, adding a new entry, or editing an existing one. */
type ModalState =
  | { mode: "create" }
  | { mode: "edit"; entry: CloseWorkspaceRow }
  | null

/**
 * Close workspace — the review surface for one project + period.
 *
 * The ledger renders through the SAME table stack as the project Time tab
 * (`ProjectTimeTable` in close mode, `CloseEntryGroups` for grouped axes,
 * `ProjectTimeFilters` for search/facets/group-by) so the two surfaces never
 * drift visually. Close-specific review mechanics — skip/unskip, carried
 * labels, the checklist jump, the budget line, commit — stay here.
 *
 * View narrowing (search, member/category facets, group axis) is URL-state
 * applied client-side over the server's scope; the review checklist adds a
 * transient issue lens on top (click "26 entries are missing a note" → the
 * ledger shows exactly those rows). Narrowing NEVER changes what commit
 * covers: totals, flags, and the footer always reflect the full scope, and a
 * visible hint says so whenever rows are hidden.
 *
 * Every number is server-derived (`lib/billing/scope` + `pricing`); this
 * component never does date or money math. Editing is disabled for closed
 * periods (a close's snapshot is historical and read-only).
 */
export function CloseWorkspace({
  data,
  backHref,
}: {
  data: CloseWorkspaceData
  backHref: string
}) {
  const { isAuthenticated } = useConvexAuth()
  const openTask = useTaskDetailNav()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [modal, setModal] = useState<ModalState>(null)

  const editable = !data.isClosed

  // Skip / un-skip (slice 05). Server re-derives the stamp; totals + carried
  // lines recompute via the reactive query.
  const skipEntries = useMutation(api.billingCloses.skipEntries)
  async function onSkip(entryIds: Id<"timeEntries">[], nextLabel: string) {
    try {
      await skipEntries({ entryIds })
      toast(`Skipped → ${nextLabel}`, {
        action: {
          label: "Undo",
          onClick: () => void skipEntries({ entryIds, clear: true }),
        },
      })
    } catch (err) {
      toastError(err, "Couldn't skip")
    }
  }
  async function onUnskip(entryIds: Id<"timeEntries">[]) {
    try {
      await skipEntries({ entryIds, clear: true })
    } catch (err) {
      toastError(err, "Couldn't undo skip")
    }
  }

  // Month lens (cycle retainers): a transient review tool — clicking a month
  // tile narrows the ledger to that month's entries.
  const [monthLens, setMonthLens] = useState<string | null>(null)
  const firstMonthKey = data.monthlyBalances[0]?.monthKey

  // ── Review-issue filter (checklist click-to-filter) ─────────────────────
  // Local, transient state — a review lens, not a saved view. Auto-degrades:
  // once every entry of the selected kind is fixed, the summary line
  // disappears and the lens clears itself.
  const [issueFilter, setIssueFilter] = useState<CloseFlagKind | null>(null)
  const flagSummaries = useMemo(
    () => summarizeCloseFlags(data.flags),
    [data.flags],
  )
  const activeIssue = useMemo(() => {
    if (!issueFilter) return null
    const summary = flagSummaries.find((s) => s.kind === issueFilter)
    return summary && summary.entryIds.length > 0 ? issueFilter : null
  }, [issueFilter, flagSummaries])
  const issueEntryIds = useMemo(() => {
    if (!activeIssue) return null
    const summary = flagSummaries.find((s) => s.kind === activeIssue)
    return new Set<string>(summary?.entryIds ?? [])
  }, [activeIssue, flagSummaries])

  // ── View narrowing — URL state, applied client-side over the scope ──────
  const groupBy = parseGrouping(searchParams.get("groupBy"))
  const { filters } = useProjectTimeFilters()
  const search = (searchParams.get("search") ?? "").trim().toLowerCase()

  const filteredEntries = useMemo(() => {
    let rows = applyTimeEntryFilters(data.entries, filters)
    if (search) {
      rows = rows.filter(
        (row) =>
          row.taskTitle.toLowerCase().includes(search) ||
          (row.note ?? "").toLowerCase().includes(search),
      )
    }
    if (issueEntryIds) rows = rows.filter((row) => issueEntryIds.has(row._id))
    if (monthLens) {
      // Carried-in work reports on the period's first month.
      rows = rows.filter(
        (row) =>
          !row.skipped &&
          (row.carried ? monthLens === firstMonthKey : row.date.slice(0, 7) === monthLens),
      )
    }
    return rows
  }, [data.entries, filters, search, issueEntryIds, monthLens, firstMonthKey])

  // Facet options derive from the scope itself — they can't drift from it.
  const availableMembers = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; name: string; imageUrl: string | undefined }
    >()
    for (const row of data.entries) {
      const key = row.userId.toString()
      if (!seen.has(key)) {
        seen.set(key, { id: key, name: row.userName, imageUrl: row.userImageUrl })
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data.entries])

  // Narrowing must never quietly misrepresent the commit — count the hidden
  // in-scope rows and say so (skipped rows are already out of the totals).
  const hiddenInScopeCount = useMemo(() => {
    const inScope = (rows: CloseWorkspaceRow[]) =>
      rows.reduce((n, r) => n + (r.skipped ? 0 : 1), 0)
    return inScope(data.entries) - inScope(filteredEntries)
  }, [data.entries, filteredEntries])

  function clearViewNarrowing() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("filters")
    params.delete("search")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  // ── Reference data ──────────────────────────────────────────────────────
  // includeArchived: an entry under a since-archived category must keep
  // displaying its name (rows + edit modal). Facet options re-filter to
  // active below.
  const categories = useQuery(
    api.workCategories.list,
    isAuthenticated ? { includeArchived: true } : "skip",
  )
  const orgMembers = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated && editable ? {} : "skip",
  )
  const currentUser = useQuery(
    api.users.current,
    isAuthenticated && editable ? {} : "skip",
  )

  const taskIds = useMemo(
    () => [...new Set(data.entries.map((row) => row.taskId.toString()))],
    [data.entries],
  )
  const isEmpty = data.entries.length === 0
  const showAmounts = data.billingType === "t_and_m"

  function handleEditById(entryId: Id<"timeEntries">) {
    const row = data.entries.find((e) => e._id === entryId)
    if (row) setModal({ mode: "edit", entry: row })
  }

  const closeMode: CloseTableConfig = {
    nextPeriodLabel: editable ? data.nextPeriodLabel : null,
    onSkip,
    onUnskip,
    inlineNoteEdit: editable,
  }

  const sharedModalProps = {
    projectId: data.project.id,
    projectTeamMembers: data.project.teamMembers,
    isAdmin: true, // getCloseWorkspace is admin-only.
    currentUserId: currentUser?._id,
    orgMembers,
    categories,
  }

  return (
    <>
      {/* Desktop-first: the editable ledger is not usable on a phone. */}
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center md:hidden">
        <MonitorIcon className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Best reviewed on desktop</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The close workspace is designed for a wider screen. Open it on desktop
          to review and edit the ledger.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>Back to Billing</Link>
        </Button>
      </div>

      <div className="mx-auto hidden w-full max-w-6xl flex-col gap-6 md:flex">
        {/* Header: what this is, in one title and one quiet line. */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" aria-label="Back to Billing" className="mt-0.5 size-8 shrink-0" asChild>
              <Link href={backHref}>
                <ArrowLeftIcon />
              </Link>
            </Button>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">{data.period.label}</h1>
                {data.periodRow ? <PeriodStateChip state={data.periodRow.state} /> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground">{data.project.name}</span>
                {" · "}
                {data.client.name}
                {" · "}
                {billingModeLabel(data)}
              </p>
            </div>
          </div>
          {editable && (
            <Button variant="ghost" size="sm" onClick={() => setModal({ mode: "create" })}>
              <PlusIcon data-icon="inline-start" />
              Add time
            </Button>
          )}
        </div>

        {data.periodRow?.blockedBy && !data.isClosed ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Close {data.periodRow.blockedBy.label} first</AlertTitle>
            <AlertDescription>
              Periods close oldest first. This one can be committed once {data.periodRow.blockedBy.label} is closed.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" asChild>
                <Link href={closeWorkspaceHref(data.project.id, data.periodRow.blockedBy.key)}>
                  Go to {data.periodRow.blockedBy.label}
                </Link>
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Decision panel — first on narrow screens, sticky on the right on wide ones. */}
          <div className="lg:sticky lg:top-6 lg:order-2">
            <CloseSummaryCard
              data={data}
              activeIssue={activeIssue}
              onToggleIssue={(kind) => setIssueFilter((prev) => (prev === kind ? null : kind))}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:order-1">
            <ClosePeriodMonths data={data} activeMonth={monthLens} onMonthChange={setMonthLens} />

            {isEmpty ? (
              <ZeroScopeCallout data={data} />
            ) : (
              <>
                <ProjectTimeFilters
                  availableMembers={availableMembers}
                  // Facet options stay active-only — the incoming list includes
                  // archived categories for display lookups only.
                  categories={categories?.filter((c) => !c.archivedAt) ?? undefined}
                  showDateRange={false}
                  facets={CLOSE_FACETS}
                />

                {hiddenInScopeCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredEntries.length} of {data.entries.length} entries — the close
                    still covers all of them.
                  </p>
                )}

                {filteredEntries.length === 0 ? (
                  <EmptyStateBanner
                    icon={ClipboardListIcon}
                    title="No entries match your filters"
                    description="The close still covers every in-scope entry."
                    action={
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setIssueFilter(null)
                          setMonthLens(null)
                          clearViewNarrowing()
                        }}
                      >
                        Show all entries
                      </Button>
                    }
                  />
                ) : groupBy === "none" ? (
                  <ProjectTimeTable
                    entries={filteredEntries}
                    selectedIds={NO_SELECTION}
                    onToggle={noop}
                    onSelectAllVisible={noop}
                    selectable={false}
                    showAmounts={showAmounts}
                    currency={data.currency}
                    timezone={data.timezone}
                    isAdmin
                    projectId={data.project.id}
                    currentUserId={currentUser?._id}
                    onEdit={handleEditById}
                    onOpenTask={openTask}
                    statusColumn={false}
                    closeMode={closeMode}
                  />
                ) : (
                  <CloseEntryGroups
                    entries={filteredEntries}
                    grouping={groupBy}
                    timezone={data.timezone}
                    showAmounts={showAmounts}
                    currency={data.currency}
                    projectId={data.project.id}
                    currentUserId={currentUser?._id}
                    onEdit={handleEditById}
                    onOpenTask={openTask}
                    closeMode={closeMode}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Task peek (side drawer, no scrim) — opened by task titles via ?detail. */}
      {taskIds.length > 0 && <TaskDetailDrawer taskIds={taskIds} isAdmin />}

      {/* Shared entry modal — add (create) or full editor (edit). */}
      {modal?.mode === "create" && (
        <TimeEntryModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          mode="create"
          {...sharedModalProps}
        />
      )}
      {modal?.mode === "edit" && (
        <TimeEntryModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          mode="edit"
          entry={{
            _id: modal.entry._id,
            taskId: modal.entry.taskId,
            date: modal.entry.date,
            startedAt: modal.entry.startedAt,
            durationMinutes: modal.entry.durationMinutes,
            isBillable: modal.entry.isBillable,
            note: modal.entry.note,
            closed: modal.entry.closeStatus !== undefined,
            invoiceId: modal.entry.invoiceId,
            userId: modal.entry.userId,
            snapshotCategoryId: modal.entry.workCategoryId,
          }}
          {...sharedModalProps}
        />
      )}
    </>
  )
}

/**
 * Zero-scope end state — valid, not an error: a retainer period with no time
 * still closes (a zero-usage report).
 */
function ZeroScopeCallout({ data }: { data: CloseWorkspaceData }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-10 text-center">
      <p className="text-sm font-medium">No time logged in this period</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {data.billingType === "retainer"
          ? "You can still close it — the monthly report will show zero usage."
          : "There is nothing to bill for this period."}
      </p>
    </div>
  )
}

/**
 * Group axis from `?groupBy` — must mirror the Time tab's parser (default
 * By Task) so the toolbar's Group by select and the rendered view agree.
 */
function parseGrouping(value: string | null): TimeEntryGroupAxis | "none" {
  if (
    value === "none" ||
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "member"
  ) {
    return value
  }
  return "task"
}
