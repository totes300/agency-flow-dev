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
import { ProjectTimeSelectionToolbar } from "@/components/projects/project-time-selection-toolbar"
import { ProjectTimeSkeleton } from "@/components/projects/project-time-skeleton"
import { ClipboardListIcon, ReceiptIcon } from "lucide-react"

type ProjectLite = {
  billingType: string
  currency: string
}

type BillingStatusFilter = "all" | "billable_uninvoiced" | "invoiced" | "non_billable"

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

function EmptyStateBanner({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof ClipboardListIcon
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/30 p-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
        <Icon className="size-5 text-muted-foreground/60" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const memberId = (searchParams.get("member") || undefined) as Id<"users"> | undefined
  const billingStatus = parseBillingStatus(searchParams.get("billingStatus"))
  const search = searchParams.get("search") || undefined
  const hasFilters = Boolean(memberId || billingStatus || search)

  const isTmProject = project.billingType === "t_and_m"

  const data = useQuery(
    api.timeEntries.listProjectEntries,
    isAuthenticated ? { projectId, memberId, billingStatus, search } : "skip",
  )
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const timezone = orgSettings?.timezone ?? "UTC"

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Reset selection when filters change — selected IDs may no longer be visible.
  const filterKey = `${memberId ?? ""}::${billingStatus ?? ""}::${search ?? ""}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setSelectedIds(new Set())
  }

  // Escape clears selection (matches tasks bulk-toolbar affordance)
  useEffect(() => {
    if (selectedIds.size === 0) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedIds(new Set())
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedIds.size])

  // Detect the "all billable time invoiced" sub-state for T&M empty banner.
  // Requires: at least one billable entry exists AND all billable entries are invoiced.
  // A project with only non-billable entries must NOT trigger this banner.
  const tmAllInvoiced = useMemo(() => {
    if (!isTmProject || !data) return false
    const billable = data.entries.filter((e) => e.isBillable)
    if (billable.length === 0) return false
    return billable.every((e) => e.invoiceId != null)
  }, [isTmProject, data])

  if (data === undefined) return <ProjectTimeSkeleton />

  const entries = data.entries as TimeEntryRow[]
  const availableMembers = data.availableMembers

  // Phase 2: no entries at all AND no active filters → basic empty state
  if (entries.length === 0 && !hasFilters) {
    return (
      <EmptyStateBanner
        icon={ClipboardListIcon}
        title="No time logged yet"
        description="Assign tasks and start tracking to see entries here."
      />
    )
  }

  function handleToggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelectAllVisible(selectAll: boolean) {
    setSelectedIds((prev) => {
      if (!selectAll) {
        const next = new Set(prev)
        for (const row of entries) {
          if (row.isBillable && !row.invoiceId) next.delete(row._id)
        }
        return next
      }
      const next = new Set(prev)
      for (const row of entries) {
        if (row.isBillable && !row.invoiceId) next.add(row._id)
      }
      return next
    })
  }

  function switchToInvoicesTab() {
    // Clear Time-tab-only filters from the URL before switching.
    const params = new URLSearchParams(searchParams.toString())
    params.delete("member")
    params.delete("billingStatus")
    params.delete("search")
    params.set("tab", "invoices")
    router.push(`${pathname}?${params.toString()}`)
    // Parent owns the authoritative tab state — keep it in sync.
    onNavigateToInvoices?.()
  }

  return (
    <div className="flex flex-col gap-4">
      <ProjectTimeFilters
        availableMembers={availableMembers}
        billingType={project.billingType}
      />

      {/* T&M-specific: all billable time invoiced */}
      {tmAllInvoiced && !hasFilters && (
        <EmptyStateBanner
          icon={ReceiptIcon}
          title="All billable time has been invoiced."
          description="New billable entries will appear here automatically."
          action={
            <button
              type="button"
              onClick={switchToInvoicesTab}
              className="text-sm font-medium text-primary hover:underline"
            >
              View invoices
            </button>
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
      ) : (
        <ProjectTimeTable
          entries={entries}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onSelectAllVisible={handleSelectAllVisible}
          selectable={isTmProject}
          showAmounts={isTmProject}
          currency={project.currency}
          timezone={timezone}
        />
      )}

      {isTmProject && (
        <ProjectTimeSelectionToolbar
          selectedIds={selectedIds}
          entries={entries}
          currency={project.currency}
          projectId={projectId}
          onDeselectAll={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  )
}
