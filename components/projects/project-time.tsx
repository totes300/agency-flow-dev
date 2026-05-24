"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { ClipboardListIcon, PlusIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  ProjectTimeContent,
} from "@/components/projects/project-time-content"
import type { TimeEntryRow } from "@/components/projects/project-time-table"
import { ProjectTimeSkeleton } from "@/components/projects/project-time-skeleton"
import { TimeEntryModal } from "@/components/projects/time-entry-modal"
import { EmptyStateBanner } from "@/components/projects/empty-state-banner"
import { Button } from "@/components/ui/button"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import {
  resolveDateRangePreset,
  type DateRangePreset,
} from "@/lib/date-buckets"

// ─── Types ──────────────────────────────────────────────────────────────────

type ProjectLite = {
  name: string
  billingType: string
  currency: string
  teamMembers?: Id<"users">[]
}

// Phase 8 — Vocabulary aligned with `entryStatus()` in
// `convex/lib/settleEntries.ts`. Old values (`billable_uninvoiced`,
// `invoiced`) were renamed; `invoiced` collapses into the broader
// `closed` bucket because the row badge no longer splits invoiced /
// settled (that detail lives in the period drill-down — Slice 4).
type BillingStatusFilter = "all" | "open" | "draft" | "closed" | "non_billable"

const DEFAULT_DATE_RANGE: DateRangePreset = "all"

function parseBillingStatus(value: string | null): BillingStatusFilter | undefined {
  if (
    value === "open" ||
    value === "draft" ||
    value === "closed" ||
    value === "non_billable"
  ) {
    return value
  }
  return undefined
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

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Project Time tab — orchestrator.
 *
 * Three-phase flow per CLAUDE.md ("Consistent loading → empty → content"):
 *   1. data === undefined  → ProjectTimeSkeleton
 *   2. no entries + no filters  → empty banner with Add Time CTA
 *   3. entries present  → ProjectTimeContent
 *
 * Why split: the previous monolith called hooks below the early returns,
 * which violates the Rules of Hooks and triggered "Rendered more hooks
 * than during the previous render" whenever a user transitioned between
 * phases (e.g. opened Add Time from empty state). Decomposition makes the
 * branch decision live HERE; ProjectTimeContent's hooks then always run
 * unconditionally because it's only mounted on the content branch.
 *
 * Modal ownership:
 *   - Create modal lives here so empty + content phases share one trigger.
 *   - Edit / Invoice modals live in ProjectTimeContent — they only make
 *     sense when there are rows to act on.
 */
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

  const memberId = (searchParams.get("member") || undefined) as Id<"users"> | undefined
  const billingStatus = parseBillingStatus(searchParams.get("billingStatus"))
  const search = searchParams.get("search") || undefined
  const dateRangePreset = parseDateRangePreset(searchParams.get("dateRange"))
  const customFrom = searchParams.get("from") || undefined
  const customTo = searchParams.get("to") || undefined

  // Identity + reference data (modals + content both consume).
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

  // Tz fallback must match the server-side fallback so date-range queries
  // don't shift across the boundary if `orgSettings` is loading. See
  // `lib/hooks/use-org-timezone.ts`.
  const timezone = orgSettings?.timezone ?? "America/New_York"

  // Resolve date range → fromDate/toDate for the entries query.
  const { fromDate, toDate } = useMemo(() => {
    if (dateRangePreset === "all") return { fromDate: undefined, toDate: undefined }
    if (dateRangePreset === "custom") {
      // Only apply custom range if both bounds set AND to >= from. Otherwise
      // behave as "all" to avoid empty-state flicker while picking dates.
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

  // Add-Time modal state lives here so both empty + content branches share
  // one trigger source. Without this, the empty branch had to render its
  // own modal (the previous duplication is gone).
  const [isAddOpen, setIsAddOpen] = useState(false)

  // Same "any filter active?" signal Content uses — kept in sync with the
  // helper there. Drives the empty-vs-no-match copy decision below.
  const hasFilters = Boolean(
    memberId ||
      billingStatus ||
      search ||
      dateRangePreset !== DEFAULT_DATE_RANGE,
  )

  // ─── Phase 1: Loading ──────────────────────────────────────────────────
  if (data === undefined) return <ProjectTimeSkeleton />

  const entries = data.entries as TimeEntryRow[]
  const availableMembers = data.availableMembers

  // ─── Phase 2: Empty (no data, no filters) ──────────────────────────────
  // The "no entries match filters" copy is rendered INSIDE Content (it
  // needs the filter UI to be visible so the user can clear filters). This
  // branch is only the truly-empty state: project has zero logged time.
  if (entries.length === 0 && !hasFilters) {
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
        <CreateModal
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          projectId={projectId}
          project={project}
          isAdmin={isAdmin}
          currentUserId={currentUser?._id}
          orgMembers={orgMembersData ?? undefined}
          categories={categories ?? undefined}
        />
      </>
    )
  }

  // ─── Phase 3: Content ──────────────────────────────────────────────────
  return (
    <>
      <ProjectTimeContent
        entries={entries}
        availableMembers={availableMembers}
        project={project}
        projectId={projectId}
        isAdmin={isAdmin}
        currentUser={currentUser}
        orgMembers={orgMembersData ?? undefined}
        categories={categories ?? undefined}
        timezone={timezone}
        onOpenAdd={() => setIsAddOpen(true)}
        onNavigateToInvoices={onNavigateToInvoices}
      />
      <CreateModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        projectId={projectId}
        project={project}
        isAdmin={isAdmin}
        currentUserId={currentUser?._id}
        orgMembers={orgMembersData ?? undefined}
        categories={categories ?? undefined}
      />
    </>
  )
}

// ─── Subcomponent: shared create modal ──────────────────────────────────────

/**
 * Thin wrapper so the create-TimeEntryModal call site stays identical
 * across the empty + content branches. The original 530-line monolith
 * duplicated this block; the wrapper lets the orchestrator render it once.
 */
function CreateModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  project: ProjectLite
  isAdmin: boolean
  currentUserId: Id<"users"> | undefined
  orgMembers: Parameters<typeof TimeEntryModal>[0]["orgMembers"]
  categories: Parameters<typeof TimeEntryModal>[0]["categories"]
}) {
  return (
    <TimeEntryModal
      mode="create"
      open={props.open}
      onOpenChange={props.onOpenChange}
      projectId={props.projectId}
      projectTeamMembers={props.project.teamMembers}
      isAdmin={props.isAdmin}
      currentUserId={props.currentUserId}
      orgMembers={props.orgMembers}
      categories={props.categories}
    />
  )
}
