"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ProjectTimeFilters } from "@/components/projects/project-time-filters"
import {
  ProjectTimeTable,
  type TimeEntryRow,
} from "@/components/projects/project-time-table"
import { ProjectTimeGrouped } from "@/components/projects/project-time-grouped"
import { ProjectTimeSelectionToolbar } from "@/components/projects/project-time-selection-toolbar"
import { ProjectTimeSkeleton } from "@/components/projects/project-time-skeleton"
import { ProjectTimeStats } from "@/components/projects/project-time-stats"
import { ProjectTimeHiddenSelectionBanner } from "@/components/projects/project-time-hidden-selection-banner"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { EmptyStateBanner } from "@/components/projects/empty-state-banner"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import {
  resolveDateRangePreset,
  type DateRangePreset,
  type Grouping,
} from "@/lib/date-buckets"
import { ClipboardListIcon, PlusIcon, ReceiptIcon } from "lucide-react"

type ProjectLite = {
  name: string
  billingType: string
  currency: string
  teamMembers?: Id<"users">[]
}

type BillingStatusFilter = "all" | "billable_uninvoiced" | "invoiced" | "non_billable"

const DEFAULT_DATE_RANGE: DateRangePreset = "this_month"

function parseBillingStatus(value: string | null): BillingStatusFilter | undefined {
  if (
    value === "billable_uninvoiced" ||
    value === "invoiced" ||
    value === "non_billable"
  ) {
    return value
  }
  return undefined
}

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

function parseDateRangePreset(value: string | null): DateRangePreset {
  if (
    value === "all" ||
    value === "this_week" ||
    value === "last_week" ||
    value === "this_month" ||
    value === "last_month" ||
    value === "this_year" ||
    value === "custom"
  ) {
    return value
  }
  return DEFAULT_DATE_RANGE
}

/**
 * Resolves the disabled state + tooltip for the "Invoice Unbilled Hours"
 * header button. The button always renders so non-admins and non-T&M
 * projects can see why invoicing-from-time isn't available here — a silent
 * hide just makes the feature undiscoverable.
 */
function getInvoiceButtonState(
  isAdmin: boolean,
  billingType: string,
  unbilledCount: number,
): { disabled: boolean; tooltip: string | null } {
  if (!isAdmin) {
    return { disabled: true, tooltip: "Only admins can create invoices" }
  }
  if (billingType === "non_billable") {
    return { disabled: true, tooltip: "This project is non-billable" }
  }
  if (billingType === "fixed") {
    return {
      disabled: true,
      tooltip: "Fixed-price project — create invoices from the Invoices tab",
    }
  }
  if (billingType === "retainer") {
    return {
      disabled: true,
      tooltip: "Retainer project — create invoices from the Invoices tab",
    }
  }
  if (unbilledCount === 0) {
    return { disabled: true, tooltip: "No unbilled hours" }
  }
  return { disabled: false, tooltip: null }
}

export function ProjectTime({
  projectId,
  project,
  onNavigateToInvoices,
}: {
  projectId: Id<"projects">
  project: ProjectLite
  onNavigateToInvoices?: () => void
}) {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() ?? false
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const memberId = (searchParams.get("member") || undefined) as Id<"users"> | undefined
  const billingStatus = parseBillingStatus(searchParams.get("billingStatus"))
  const search = searchParams.get("search") || undefined
  const groupBy = parseGrouping(searchParams.get("groupBy"))
  const dateRangePreset = parseDateRangePreset(searchParams.get("dateRange"))
  const customFrom = searchParams.get("from") || undefined
  const customTo = searchParams.get("to") || undefined

  const isTmProject = project.billingType === "t_and_m"

  // Queries
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const orgMembersData = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated ? {} : "skip",
  )
  const categories = useQuery(
    api.workCategories.list,
    isAuthenticated ? {} : "skip",
  )
  const timezone = orgSettings?.timezone ?? "UTC"

  // Resolve date range → fromDate/toDate for the query
  const { fromDate, toDate } = useMemo(() => {
    if (dateRangePreset === "all") return { fromDate: undefined, toDate: undefined }
    if (dateRangePreset === "custom") {
      // Only apply custom range if both bounds are set AND to >= from.
      // Otherwise behave as "all" to avoid empty-state flicker while the
      // user is still picking dates.
      if (customFrom && customTo && customTo >= customFrom) {
        return { fromDate: customFrom, toDate: customTo }
      }
      return { fromDate: undefined, toDate: undefined }
    }
    const resolved = resolveDateRangePreset(dateRangePreset, timezone)
    return { fromDate: resolved?.from, toDate: resolved?.to }
  }, [dateRangePreset, customFrom, customTo, timezone])

  const data = useQuery(
    api.timeEntries.listProjectEntries,
    isAuthenticated
      ? { projectId, memberId, billingStatus, search, fromDate, toDate }
      : "skip",
  )

  // Selection state — only meaningful when the toolbar can render.
  //
  // Stored as a Map (id → row) rather than a plain Set so that rows hidden
  // by the current filter stay selected with their stashed data. This is the
  // Linear/Notion pattern: a filter change shouldn't silently un-select work
  // the user deliberately picked. A banner surfaces the hidden count, and
  // bulk actions run against the full set so the user's intent is honored.
  const selectionEnabled = isAdmin && isTmProject
  const [selection, setSelection] = useState<Map<string, TimeEntryRow>>(
    () => new Map(),
  )

  // Escape clears selection (matches tasks bulk-toolbar affordance). Skip
  // while a Radix dialog is open so Esc there closes the dialog first.
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

  // Add Time / Edit modal state
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editEntryId, setEditEntryId] = useState<Id<"timeEntries"> | null>(null)

  // Invoice modal state
  type InvoiceModalMode =
    | { kind: "all" }
    | { kind: "selection"; ids: Id<"timeEntries">[]; skipped: number }
  const [invoiceModal, setInvoiceModal] = useState<InvoiceModalMode | null>(null)

  // Detect the "all billable time invoiced" sub-state for T&M empty banner.
  const tmAllInvoiced = useMemo(() => {
    if (!isTmProject || !data) return false
    const billable = data.entries.filter((e) => e.isBillable)
    if (billable.length === 0) return false
    return billable.every((e) => e.invoiceId != null)
  }, [isTmProject, data])

  const unbilledCount = useMemo(() => {
    if (!data) return 0
    return data.entries.filter((e) => e.isBillable && !e.invoiceId).length
  }, [data])

  // Default dateRange is "this_month", so treat that as "no filter applied".
  // Only wider / narrower ranges or other dimensions count as active filters.
  const hasFilters = Boolean(
    memberId ||
      billingStatus ||
      search ||
      dateRangePreset !== DEFAULT_DATE_RANGE,
  )

  if (data === undefined) return <ProjectTimeSkeleton />

  const entries = data.entries as TimeEntryRow[]
  const availableMembers = data.availableMembers

  // Phase 2: no entries at all AND no active filters → basic empty state
  if (entries.length === 0 && !hasFilters && !isAddOpen) {
    return (
      <>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-end">
            <Button onClick={() => setIsAddOpen(true)}>
              <PlusIcon data-icon="inline-start" className="size-4" />
              Add Time
            </Button>
          </div>
          <EmptyStateBanner
            icon={ClipboardListIcon}
            title="No time logged yet"
            description="Log time manually or start the timer on a task to see entries here."
          />
        </div>
        <TimeEntryModal
          mode="create"
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          projectId={projectId}
          projectTeamMembers={project.teamMembers}
          isAdmin={isAdmin}
          currentUserId={currentUser?._id}
          orgMembers={orgMembersData ?? undefined}
          categories={categories ?? undefined}
        />
      </>
    )
  }

  // Visible vs. hidden selection. Visible rows re-fetch their data fresh
  // from the current query result; hidden rows fall back to the stash.
  const visibleIds = new Set<string>(entries.map((e) => e._id))
  const selectedEntries: TimeEntryRow[] = []
  const hiddenSelectedEntries: TimeEntryRow[] = []
  for (const e of entries) {
    if (selection.has(e._id)) selectedEntries.push(e)
  }
  for (const [id, entry] of selection) {
    if (!visibleIds.has(id)) {
      hiddenSelectedEntries.push(entry)
      selectedEntries.push(entry)
    }
  }

  // Derived Set for the child tables — they still key off the simple form.
  const selectedIds = new Set(selection.keys())

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

  // Within-group secondary sort key — entries come pre-sorted by (date desc,
  // createdAt desc) from the server, so index-from-end preserves that order
  // when the grouped view re-buckets rows.
  const createdAtMap = new Map<string, number>()
  entries.forEach((e, i) => createdAtMap.set(e._id, entries.length - i))

  const invoiceBtn = getInvoiceButtonState(isAdmin, project.billingType, unbilledCount)

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
                disabled={invoiceBtn.disabled}
                onClick={() => setInvoiceModal({ kind: "all" })}
              >
                <ReceiptIcon data-icon="inline-start" className="size-4" />
                Invoice Unbilled Hours
              </Button>
            </span>
          </TooltipTrigger>
          {invoiceBtn.tooltip && (
            <TooltipContent>{invoiceBtn.tooltip}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <Button size="sm" className="h-9" onClick={() => setIsAddOpen(true)}>
        <PlusIcon data-icon="inline-start" className="size-4" />
        Add Time
      </Button>
    </>
  )

  const editEntryRow = editEntryId
    ? entries.find((e) => e._id === editEntryId)
    : undefined

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
        timezone={timezone}
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
          onCreateInvoice={(ids, skipped) =>
            setInvoiceModal({ kind: "selection", ids, skipped })
          }
        />
      )}

      <TimeEntryModal
        mode="create"
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        projectId={projectId}
        projectTeamMembers={project.teamMembers}
        isAdmin={isAdmin}
        currentUserId={currentUser?._id}
        orgMembers={orgMembersData ?? undefined}
        categories={categories ?? undefined}
      />

      {editEntryRow && (
        <TimeEntryModal
          mode="edit"
          entry={{
            _id: editEntryRow._id,
            taskId: editEntryRow.taskId,
            date: editEntryRow.date,
            durationMinutes: editEntryRow.durationMinutes,
            isBillable: editEntryRow.isBillable,
            note: editEntryRow.note,
            invoiceId: editEntryRow.invoiceId,
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
          orgMembers={orgMembersData ?? undefined}
          categories={categories ?? undefined}
        />
      )}

      {invoiceModal !== null && (
        <CreateInvoiceModal
          open={invoiceModal !== null}
          onOpenChange={(o) => {
            if (!o) setInvoiceModal(null)
          }}
          projectId={projectId}
          projectName={project.name}
          billingType={project.billingType}
          currency={project.currency}
          timeEntryIds={
            invoiceModal.kind === "selection" ? invoiceModal.ids : undefined
          }
          skippedCount={
            invoiceModal.kind === "selection" ? invoiceModal.skipped : 0
          }
          onCreated={() => {
            setInvoiceModal(null)
            setSelection(new Map())
          }}
        />
      )}
    </div>
  )
}
