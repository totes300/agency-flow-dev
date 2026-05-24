"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import type { FunctionReturnType } from "convex/server"
import {
  ClipboardListIcon,
  PlusIcon,
  ReceiptIcon,
} from "lucide-react"
import type { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { ProjectTimeFilters } from "@/components/projects/project-time-filters"
import {
  ProjectTimeTable,
  type TimeEntryRow,
} from "@/components/projects/project-time-table"
import { ProjectTimeGrouped } from "@/components/projects/project-time-grouped"
import { ProjectTimeSelectionToolbar } from "@/components/projects/project-time-selection-toolbar"
import { ProjectTimeStats } from "@/components/projects/project-time-stats"
import { ProjectTimeHiddenSelectionBanner } from "@/components/projects/project-time-hidden-selection-banner"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { EmptyStateBanner } from "@/components/projects/empty-state-banner"
import { useGenerateInvoice } from "@/lib/hooks/use-generate-invoice"
import type { Id as IdType } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Grouping } from "@/lib/date-buckets"

// ─── Types ──────────────────────────────────────────────────────────────────

type OrgMember = {
  _id: Id<"users">
  name: string
  imageUrl: string | undefined
}

type ProjectLite = {
  name: string
  billingType: string
  currency: string
  teamMembers?: Id<"users">[]
}

// Derive from the query return type so the shape can never drift from what
// the backend actually emits — see convex/timeEntries.ts:listProjectEntries.
type ProjectEntriesData = NonNullable<
  FunctionReturnType<typeof api.timeEntries.listProjectEntries>
>
type AvailableMember = ProjectEntriesData["availableMembers"][number]

/**
 * Disabled-state + tooltip for the "Invoice Unbilled Hours" header button.
 * The button always renders so non-admins and non-T&M projects can see why
 * invoicing-from-time isn't available here — a silent hide just makes the
 * feature undiscoverable.
 *
 * Lives here (not in the orchestrator) because `unbilledCount` is content-
 * phase-only and the button itself is a header action of the content view.
 */
function getInvoiceButtonState(
  isAdmin: boolean,
  billingType: string,
  unbilledCount: number,
): { disabled: boolean; tooltip: string | null } {
  if (!isAdmin) return { disabled: true, tooltip: "Only admins can create invoices" }
  if (billingType === "non_billable") return { disabled: true, tooltip: "This project is non-billable" }
  if (billingType === "fixed") {
    return { disabled: true, tooltip: "Fixed-price project — create invoices from the Invoices tab" }
  }
  if (billingType === "retainer") {
    return { disabled: true, tooltip: "Retainer project — create invoices from the Invoices tab" }
  }
  if (unbilledCount === 0) return { disabled: true, tooltip: "No unbilled hours" }
  return { disabled: false, tooltip: null }
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Content phase of the Project Time tab.
 *
 * Rendered ONLY when the parent `ProjectTime` orchestrator has loaded data.
 * Owns selection + edit + invoice modal state because those are meaningless
 * outside the content phase (no rows to select / edit / invoice). The
 * loading / empty branches live in the orchestrator and never mount this
 * component, so its hooks always run in the same order — that's the
 * structural fix for the Rules of Hooks bug we hit in the monolithic
 * ancestor.
 *
 * Add-Time concerns stay with the parent (it owns `isAddOpen` + the create
 * modal) so both empty and content branches share one trigger source.
 */
export function ProjectTimeContent({
  entries,
  availableMembers,
  project,
  projectId,
  isAdmin,
  currentUser,
  orgMembers,
  categories,
  timezone,
  onOpenAdd,
  onNavigateToInvoices,
}: {
  entries: TimeEntryRow[]
  availableMembers: AvailableMember[]
  project: ProjectLite
  projectId: Id<"projects">
  isAdmin: boolean
  currentUser: { _id: Id<"users"> } | null | undefined
  orgMembers: OrgMember[] | undefined
  categories: Doc<"workCategories">[] | undefined
  timezone: string
  onOpenAdd: () => void
  onNavigateToInvoices?: () => void
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const groupBy = parseGrouping(searchParams.get("groupBy"))
  const isTmProject = project.billingType === "t_and_m"
  const selectionEnabled = isAdmin && isTmProject

  // ─── State ────────────────────────────────────────────────────────────────

  // Selection stored as Map (id → row) so rows hidden by the current filter
  // stay selected with their stashed data — same Linear/Notion pattern: a
  // filter change shouldn't silently un-select work the user picked.
  const [selection, setSelection] = useState<Map<string, TimeEntryRow>>(
    () => new Map(),
  )

  const [editEntryId, setEditEntryId] = useState<Id<"timeEntries"> | null>(null)
  const { generate, pending: isGenerating } = useGenerateInvoice()

  function handleGenerateAll() {
    void generate({ projectId })
  }

  function handleGenerateSelection(ids: IdType<"timeEntries">[]) {
    void generate({
      projectId,
      timeEntryIds: ids,
      navigateTo: (identifier) => `/invoices/${identifier}`,
    })
    setSelection(new Map())
  }

  // ─── Effects ──────────────────────────────────────────────────────────────

  // Esc clears selection (matches tasks bulk-toolbar). Skip while a Radix
  // dialog is open so Esc there closes the dialog first.
  useEffect(() => {
    if (selection.size === 0) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      setSelection(new Map())
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selection.size])

  // ─── Derived ──────────────────────────────────────────────────────────────

  const tmAllInvoiced = useMemo(() => {
    if (!isTmProject) return false
    const billable = entries.filter((e) => e.isBillable)
    if (billable.length === 0) return false
    return billable.every((e) => e.invoiceId != null)
  }, [isTmProject, entries])

  const unbilledCount = useMemo(
    () => entries.filter((e) => e.isBillable && !e.invoiceId).length,
    [entries],
  )

  // Visible vs. hidden selection. Convex returns a fresh `entries` ref on
  // every backend tick — without this useMemo, every websocket update
  // rebuilds these collections O(N+M).
  const { selectedEntries, hiddenSelectedEntries, selectedIds } = useMemo(() => {
    const visibleIds = new Set<string>(entries.map((e) => e._id))
    const sel: TimeEntryRow[] = []
    const hidden: TimeEntryRow[] = []
    for (const e of entries) {
      if (selection.has(e._id)) sel.push(e)
    }
    for (const [id, entry] of selection) {
      if (!visibleIds.has(id)) {
        hidden.push(entry)
        sel.push(entry)
      }
    }
    return {
      selectedEntries: sel,
      hiddenSelectedEntries: hidden,
      selectedIds: new Set(selection.keys()),
    }
  }, [entries, selection])

  // Within-group secondary sort key — server pre-sorts by (date desc,
  // createdAt desc); index-from-end preserves that order when grouped view
  // re-buckets rows.
  const createdAtMap = useMemo(() => {
    const m = new Map<string, number>()
    entries.forEach((e, i) => m.set(e._id, entries.length - i))
    return m
  }, [entries])

  const hasFilters = useHasFilters()

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleToggle(row: TimeEntryRow) {
    setSelection((prev) => {
      const next = new Map(prev)
      if (next.has(row._id)) next.delete(row._id)
      else next.set(row._id, row)
      return next
    })
  }

  // Scoped to the rows the child passes in — in grouped view that's the
  // rows of one group, so "Select all" in a collapsed/expanded group only
  // touches that group and leaves other groups' selections alone.
  function handleSelectAllVisible(selectAll: boolean, rows: TimeEntryRow[]) {
    setSelection((prev) => {
      const next = new Map(prev)
      for (const row of rows) {
        if (!row.isBillable || row.invoiceId) continue
        if (selectAll) next.set(row._id, row)
        else next.delete(row._id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelection(new Map())
  }

  function switchToInvoicesTab() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("member")
    params.delete("billingStatus")
    params.delete("search")
    params.set("tab", "invoices")
    router.push(`${pathname}?${params.toString()}`)
    onNavigateToInvoices?.()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const invoiceBtn = getInvoiceButtonState(isAdmin, project.billingType, unbilledCount)
  const editEntryRow = editEntryId ? entries.find((e) => e._id === editEntryId) : undefined

  const headerActions = (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span needed so the tooltip tracks hover even when the button is disabled */}
            <span>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={invoiceBtn.disabled || isGenerating}
                onClick={handleGenerateAll}
              >
                <ReceiptIcon data-icon="inline-start" className="size-4" />
                Invoice Unbilled Hours
              </Button>
            </span>
          </TooltipTrigger>
          {invoiceBtn.tooltip && <TooltipContent>{invoiceBtn.tooltip}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <Button size="sm" className="h-9" onClick={onOpenAdd}>
        <PlusIcon data-icon="inline-start" className="size-4" />
        Add Time
      </Button>
    </>
  )

  const sharedTableProps = {
    selectedIds,
    onToggle: handleToggle,
    onSelectAllVisible: handleSelectAllVisible,
    selectable: selectionEnabled,
    showAmounts: isTmProject,
    currency: project.currency,
    timezone,
    isAdmin,
    currentUserId: currentUser?._id,
    onEdit: setEditEntryId,
  }

  return (
    <div className="flex flex-col gap-4">
      <ProjectTimeStats
        entries={entries}
        billingType={project.billingType}
        currency={project.currency}
      />

      <ProjectTimeFilters
        availableMembers={availableMembers}
        billingType={project.billingType}
        actions={headerActions}
      />

      <ProjectTimeHiddenSelectionBanner
        hiddenCount={hiddenSelectedEntries.length}
        totalCount={selection.size}
        onClearSelection={clearSelection}
      />

      {tmAllInvoiced && !hasFilters && (
        <EmptyStateBanner
          icon={ReceiptIcon}
          title="All billable time has been invoiced."
          description="New billable entries will appear here automatically."
          action={
            <Button variant="link" size="sm" onClick={switchToInvoicesTab}>
              View invoices
            </Button>
          }
        />
      )}

      {entries.length === 0 ? (
        <EmptyStateBanner
          icon={ClipboardListIcon}
          title="No entries match your filters"
          description="Try removing a filter or adjusting your search."
          action={
            <Link
              href={pathname + "?tab=time"}
              className="text-sm font-medium text-primary hover:underline"
            >
              Clear filters
            </Link>
          }
        />
      ) : groupBy === "none" ? (
        <ProjectTimeTable entries={entries} {...sharedTableProps} />
      ) : (
        <ProjectTimeGrouped
          entries={entries}
          grouping={groupBy}
          createdAtMap={createdAtMap}
          {...sharedTableProps}
        />
      )}

      {selectionEnabled && (
        <ProjectTimeSelectionToolbar
          selectedEntries={selectedEntries}
          currency={project.currency}
          onDeselectAll={clearSelection}
          onCreateInvoice={(ids) => handleGenerateSelection(ids)}
        />
      )}

      {editEntryRow && (
        <TimeEntryModal
          mode="edit"
          entry={{
            _id: editEntryRow._id,
            taskId: editEntryRow.taskId,
            date: editEntryRow.date,
            startedAt: editEntryRow.startedAt,
            durationMinutes: editEntryRow.durationMinutes,
            isBillable: editEntryRow.isBillable,
            note: editEntryRow.note,
            invoiceId: editEntryRow.invoiceId,
            settledAt: editEntryRow.settledAt,
            userId: editEntryRow.userId,
          }}
          open={editEntryId !== null}
          onOpenChange={(o) => {
            if (!o) setEditEntryId(null)
          }}
          projectId={projectId}
          projectTeamMembers={project.teamMembers}
          isAdmin={isAdmin}
          currentUserId={currentUser?._id}
          orgMembers={orgMembers ?? undefined}
          categories={categories ?? undefined}
        />
      )}

    </div>
  )
}

// ─── Local helpers ──────────────────────────────────────────────────────────

function parseGrouping(value: string | null): Grouping {
  if (
    value === "none" ||
    value === "week" ||
    value === "month" ||
    value === "member" ||
    value === "task"
  ) {
    return value
  }
  return "day"
}

/**
 * Whether ANY filter is active. Drives the "all invoiced" banner suppression
 * (we don't celebrate inbox-zero when the user is just looking at a filtered
 * view). The orchestrator computes the same signal for its empty branch —
 * keep both implementations in sync if one changes.
 */
function useHasFilters(): boolean {
  const searchParams = useSearchParams()
  const memberId = searchParams.get("member")
  const billingStatus = searchParams.get("billingStatus")
  const search = searchParams.get("search")
  const dateRange = searchParams.get("dateRange")
  return Boolean(
    memberId || billingStatus || search || (dateRange && dateRange !== "all"),
  )
}
