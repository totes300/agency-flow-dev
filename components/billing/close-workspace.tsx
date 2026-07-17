"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useConvexAuth, useMutation } from "convex/react"
import { toast } from "sonner"
import { ArrowLeftIcon, ClipboardListIcon, MonitorIcon, PlusIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { CloseBudgetSummary } from "@/components/billing/close-budget-summary"
import { CloseCommitButton } from "@/components/billing/close-commit-button"
import { CloseEntryGroups } from "@/components/billing/close-entry-groups"
import { CloseReviewChecklist } from "@/components/billing/close-review-checklist"
import { CloseWorkspaceFooter } from "@/components/billing/close-workspace-footer"
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
import type { CloseWorkspaceData, CloseWorkspaceRow } from "@/convex/close"

const BILLING_TYPE_LABEL: Record<
  CloseWorkspaceData["project"]["billingType"],
  string
> = {
  retainer: "Retainer",
  t_and_m: "T&M",
  fixed: "Fixed",
}

/** Stable DOM id for a ledger row, so the review checklist can scroll to it. */
export function CLOSE_ENTRY_DOM_ID(entryId: Id<"timeEntries">): string {
  return `close-entry-${entryId}`
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
 * applied client-side over the server's scope. Narrowing NEVER changes what
 * commit covers: totals, flags, and the footer always reflect the full scope,
 * and a visible hint says so whenever rows are hidden.
 *
 * Every number is server-derived from `billingScope`; this component never
 * does date or money math. Editing is disabled for closed periods (the I4
 * settlement-stamp view is historical and read-only).
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

  const editable = !data.fromSettlementStamps

  // Skip / un-skip (slice 05). Server re-derives the stamp; totals + carried
  // lines recompute via the reactive query.
  const skipEntries = useMutation(api.close.skipEntries)
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

  // ── View narrowing — URL state, applied client-side over the scope ──────
  const groupBy = parseGrouping(searchParams.get("groupBy"))
  const { filters } = useProjectTimeFilters()
  const search = (searchParams.get("search") ?? "").trim().toLowerCase()

  const filteredEntries = useMemo(() => {
    const faceted = applyTimeEntryFilters(data.entries, filters)
    if (!search) return faceted
    return faceted.filter(
      (row) =>
        row.taskTitle.toLowerCase().includes(search) ||
        (row.note ?? "").toLowerCase().includes(search),
    )
  }, [data.entries, filters, search])

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

  // ── Checklist jump (PRD story 13) ───────────────────────────────────────
  // A jump must never silently fail: if the target row is filtered out, the
  // filters clear first (announced), the target's group force-expands
  // (`revealEntryId`), and the scroll waits until the row's DOM node exists.
  const [highlightId, setHighlightId] = useState<Id<"timeEntries"> | null>(null)
  const [, setJumpNonce] = useState(0)
  const pendingJumpRef = useRef<Id<"timeEntries"> | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function jumpToEntry(entryId: Id<"timeEntries">) {
    if (!filteredEntries.some((e) => e._id === entryId)) {
      clearViewNarrowing()
      toast("Filters cleared to show this entry")
    }
    pendingJumpRef.current = entryId
    setHighlightId(entryId)
    // Guarantees a render even when the id is already highlighted, so the
    // scroll effect below re-runs.
    setJumpNonce((n) => n + 1)
  }

  // Runs after every render while a jump is pending — the row may only
  // appear once cleared filters / expanded groups have rendered.
  useEffect(() => {
    const id = pendingJumpRef.current
    if (!id) return
    const el = document.getElementById(CLOSE_ENTRY_DOM_ID(id))
    if (!el) return
    pendingJumpRef.current = null
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1600)
  })

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
    highlightId,
    rowDomId: CLOSE_ENTRY_DOM_ID,
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

      <div className="mx-auto hidden w-full max-w-5xl flex-col gap-6 md:flex">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to Billing"
              className="size-8 shrink-0"
              asChild
            >
              <Link href={backHref}>
                <ArrowLeftIcon className="size-4" />
              </Link>
            </Button>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">
                Close · {data.period.label}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {data.project.name}
                </span>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span>{data.client.name}</span>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span>{BILLING_TYPE_LABEL[data.project.billingType]}</span>
                <span className="text-xs text-muted-foreground/70">
                  {data.project.code}
                </span>
              </div>
            </div>
          </div>

          {/* Secondary: add missed work (story 12). Primary: the commit button
              (Generate / Close & report), flipping with the budget line. */}
          {editable && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModal({ mode: "create" })}
              >
                <PlusIcon data-icon="inline-start" className="size-3.5" />
                Add time
              </Button>
              <CloseCommitButton data={data} />
            </div>
          )}
        </div>

        <CloseBudgetSummary data={data} />

        {/* Closed periods are immutable history — no review checklist ("ready
            to close" would be nonsense on an already-committed period). */}
        {editable && (
          <CloseReviewChecklist
            flags={data.flags}
            projectId={data.project.id}
            onJump={jumpToEntry}
          />
        )}

        {isEmpty ? (
          <ZeroScopeCallout data={data} />
        ) : (
          <div className="flex flex-col gap-4">
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
                {hiddenInScopeCount} in-scope{" "}
                {hiddenInScopeCount === 1 ? "entry is" : "entries are"} hidden by
                filters — totals and commit include{" "}
                {hiddenInScopeCount === 1 ? "it" : "them"}.
              </p>
            )}

            {filteredEntries.length === 0 ? (
              <EmptyStateBanner
                icon={ClipboardListIcon}
                title="No entries match your filters"
                description="The close still covers every in-scope entry."
                action={
                  <Button variant="link" size="sm" onClick={clearViewNarrowing}>
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
                revealEntryId={highlightId}
              />
            )}

            <CloseWorkspaceFooter data={data} />
          </div>
        )}
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
            invoiceId: modal.entry.invoiceId,
            settledAt: modal.entry.settledAt,
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
 * Zero-scope end state (PRD story 35 / UX Decisions § States) — a valid
 * end-state, not an error. The budget line already shows zeros above; this gray
 * callout explains that Close & report (zero usage) is still available for
 * retainers.
 */
function ZeroScopeCallout({ data }: { data: CloseWorkspaceData }) {
  return (
    <div className="rounded-lg bg-muted/50 px-4 py-6 text-center">
      <p className="text-sm font-medium">No entries in scope</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {data.billingType === "retainer"
          ? "You can still Close & report this period (zero usage)."
          : "Nothing to bill for this period."}
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
