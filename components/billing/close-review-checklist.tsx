"use client"

import Link from "next/link"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import {
  hasBlockingOrWarning,
  reviewFlagCount,
  summarizeCloseFlags,
  type CloseFlag,
  type CloseFlagKind,
  type CloseFlagSummary,
} from "@/convex/lib/closeFlags"
import { cn } from "@/lib/utils"

/**
 * Review checklist callout (PRD stories 13–15) — turns closing into a finite
 * checklist. One line PER FLAG KIND with a count (never one row per entry):
 * thirty missing notes read as "30 entries are missing a note", and clicking
 * the line filters the ledger to exactly those rows (click again — or "Show
 * all" — to clear). Non-entry flags keep their own affordances: the blocking
 * overage-rate line links to Settings, the running-timer line is informational.
 * When no warning/blocker remains it flips to "All clear — ready to close".
 *
 * All derivation lives in the pure `closeFlags` module; this component only
 * renders `summarizeCloseFlags` output.
 */
export function CloseReviewChecklist({
  flags,
  projectId,
  activeFilter,
  onToggleFilter,
}: {
  flags: CloseFlag[]
  projectId: Id<"projects">
  /** Flag kind the ledger is currently filtered to — null when unfiltered. */
  activeFilter: CloseFlagKind | null
  onToggleFilter: (kind: CloseFlagKind) => void
}) {
  if (flags.length === 0) {
    return (
      <Callout>
        <AllClearHeader />
      </Callout>
    )
  }

  const summaries = summarizeCloseFlags(flags)
  const count = reviewFlagCount(flags)
  const allClear = !hasBlockingOrWarning(flags)

  return (
    <Callout>
      {allClear ? (
        <AllClearHeader />
      ) : (
        <p className="text-sm font-medium">
          {count} {count === 1 ? "thing" : "things"} to review
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-0.5">
        {summaries.map((summary) => (
          <SummaryRow
            key={summary.kind}
            summary={summary}
            projectId={projectId}
            active={activeFilter === summary.kind}
            onToggleFilter={onToggleFilter}
          />
        ))}
      </ul>
    </Callout>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-muted/50 px-4 py-3">{children}</div>
}

function AllClearHeader() {
  return (
    <p className="flex items-center gap-2 text-sm font-medium">
      <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
      All clear — ready to close
    </p>
  )
}

function SummaryRow({
  summary,
  projectId,
  active,
  onToggleFilter,
}: {
  summary: CloseFlagSummary
  projectId: Id<"projects">
  active: boolean
  onToggleFilter: (kind: CloseFlagKind) => void
}) {
  // Only entry-backed lines can filter the ledger; the overage-rate and
  // running-timer lines have no rows to show.
  const filterable = summary.entryIds.length > 0

  const content = (
    <span className="flex min-w-0 items-center gap-2">
      <FlagIcon severity={summary.severity} />
      <span
        className={cn(
          "truncate text-sm",
          summary.severity === "info" && "text-muted-foreground",
        )}
      >
        {summaryLabel(summary)}
      </span>
      {summary.kind === "missing-overage-rate" && (
        <Link
          href={`/projects/${projectId}?tab=settings`}
          className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Set rate
        </Link>
      )}
    </span>
  )

  if (!filterable) return <li className="px-1 py-0.5">{content}</li>

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggleFilter(summary.kind)}
        aria-pressed={active}
        className={cn(
          "group flex w-full min-w-0 items-center justify-between gap-3 rounded px-1 py-0.5 text-left",
          "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          active && "bg-accent/60",
        )}
      >
        {content}
        <span className="shrink-0 text-xs text-muted-foreground">
          {active ? (
            <span className="font-medium text-foreground">Show all</span>
          ) : (
            <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Show only
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function FlagIcon({ severity }: { severity: CloseFlagSummary["severity"] }) {
  if (severity === "blocking") {
    return <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
  }
  if (severity === "warning") {
    return (
      <TriangleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
    )
  }
  return (
    <span
      aria-hidden
      className="ml-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
    />
  )
}

function summaryLabel(summary: CloseFlagSummary): string {
  const n = summary.count
  switch (summary.kind) {
    case "missing-overage-rate":
      return "Over budget with no overage rate"
    case "running-timer":
      return n === 1
        ? "A timer is still running in this period"
        : `${n} timers are still running in this period`
    case "long-entry":
      return n === 1
        ? "1 entry over 8h — check for a forgotten timer"
        : `${n} entries over 8h — check for forgotten timers`
    case "missing-note":
      return n === 1
        ? "1 entry is missing a note"
        : `${n} entries are missing a note`
    case "carried-in":
      return n === 1
        ? "1 entry carried in from an earlier month"
        : `${n} entries carried in from earlier months`
  }
}
