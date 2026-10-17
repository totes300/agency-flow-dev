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
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { CloseBudgetSummary } from "@/components/billing/close-budget-summary"
import { CloseCommitButton } from "@/components/billing/close-commit-button"
import { CloseEntryGroups } from "@/components/billing/close-entry-groups"
import {
  CloseBlockingAlert,
  CloseReviewChips,
} from "@/components/billing/close-review-chips"
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
    return BILLING_TYPE_LABEL[data.project.billingType]
  }
  const months = data.monthlyBalances.length
  if (months <= 1) {
    return data.project.rolloverEnabled
      ? "Retainer · monthly"
      : "Retainer · monthly, no rollover"
  }
  let label = `Retainer · rollover · ${months}-month cycle`
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

  // ── Rollover breakdown (cycle retainers) ────────────────────────────────
  // Open/closed state lives in the URL so it survives drawer round-trips;
  // the month lens is a transient review tool like the checklist filter.
  const breakdownOpen = searchParams.get("balance") === "open"
  const [monthLens, setMonthLens] = useState<string | null>(null)
  function setBreakdownOpen(open: boolean) {
    // Closing the breakdown must drop its lens — otherwise the ledger stays
    // filtered with the only indicator (the highlighted row) hidden.
    if (!open) setMonthLens(null)
    const params = new URLSearchParams(searchParams.toString())
    if (open) params.set("balance", "open")
    else params.delete("balance")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

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

  // Warning markers for ledger rows (missing note / long entry) — the amber
  // dot next to the note, so flagged rows are spottable while scrolling.
  const rowWarnings = useMemo(() => {
    const map = new Map<string, string>()
    for (const summary of flagSummaries) {
      if (summary.severity !== "warning") continue
      const label =
        summary.kind === "missing-note"
          ? "Missing note"
          : summary.kind === "long-entry"
            ? "Over 8h — check for a forgotten timer"
            : null
      if (!label) continue
      for (const id of summary.entryIds) {
        const existing = map.get(id.toString())
        map.set(id.toString(), existing ? `${existing} · ${label}` : label)
      }
    }
    return map
  }, [flagSummaries])

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
      rows = rows.filter(
        (row) =>
          !row.skipped &&
          (monthLens === "carried"
            ? row.carried
            : !row.carried && row.date.slice(0, 7) === monthLens),
      )
    }
    return rows
  }, [data.entries, filters, search, issueEntryIds, monthLens])

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
    rowWarnings,
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
                <span>{billingModeLabel(data)}</span>
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

        <CloseBudgetSummary
          data={data}
          breakdownOpen={breakdownOpen}
          onBreakdownOpenChange={setBreakdownOpen}
          monthLens={monthLens}
          onMonthLensChange={setMonthLens}
        />

        {/* Loud only when it must be: the blocking overage-rate condition.
            Everything else about review state lives as quiet toolbar chips. */}
        {editable && (
          <CloseBlockingAlert flags={data.flags} projectId={data.project.id} />
        )}

        {/* F5 — the period reads as closed because a DRAFT covers it; the
            entries live on the draft, not in settlement stamps, so this
            ledger would render blank. Route to the draft instead. */}
        {!editable && data.coveringDraft && (
          <Alert>
            <InfoIcon />
            <AlertDescription>
              This period is on a draft invoice — its entries are locked to
              the draft and appear there until it finalizes or is deleted.{" "}
              <Link
                href={`/invoices/${data.coveringDraft.id}`}
                className="font-medium underline underline-offset-2"
              >
                Open draft
              </Link>
            </AlertDescription>
          </Alert>
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
              // Review chips ride in the toolbar's right slot — review state
              // is a filtering tool here, so it lives with the other tools.
              actions={
                editable ? (
                  <CloseReviewChips
                    flags={data.flags}
                    activeFilter={activeIssue}
                    onToggleFilter={(kind) =>
                      setIssueFilter((prev) => (prev === kind ? null : kind))
                    }
                  />
                ) : undefined
              }
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
