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
  type CloseFlag,
} from "@/convex/lib/closeFlags"
import { cn } from "@/lib/utils"

/**
 * Review checklist callout (PRD stories 13–15) — turns closing into a finite
 * checklist. Renders the pure `closeFlags` output: blocking + warnings first
 * (each jumps to and flash-highlights its row), then informational carried-in
 * lines. When no warning/blocker remains it flips to "All clear — ready to
 * close" (info carried lines may persist). This component only renders — all
 * derivation lives in `closeFlags`.
 */
export function CloseReviewChecklist({
  flags,
  projectId,
  onJump,
}: {
  flags: CloseFlag[]
  projectId: Id<"projects">
  onJump: (entryId: Id<"timeEntries">) => void
}) {
  if (flags.length === 0) {
    return (
      <Callout>
        <AllClearHeader />
      </Callout>
    )
  }

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
      <ul className="mt-2 flex flex-col gap-1.5">
        {flags.map((flag, i) => (
          <FlagRow
            key={`${flag.kind}-${flag.entryId ?? i}`}
            flag={flag}
            projectId={projectId}
            onJump={onJump}
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

function FlagRow({
  flag,
  projectId,
  onJump,
}: {
  flag: CloseFlag
  projectId: Id<"projects">
  onJump: (entryId: Id<"timeEntries">) => void
}) {
  const jumpable = flag.entryId !== undefined

  const content = (
    <span className="flex min-w-0 items-center gap-2">
      <FlagIcon severity={flag.severity} />
      <span
        className={cn(
          "truncate text-sm",
          flag.severity === "info" && "text-muted-foreground",
        )}
      >
        {flagLabel(flag)}
      </span>
      {flag.kind === "missing-overage-rate" && (
        <Link
          href={`/projects/${projectId}?tab=settings`}
          className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Set rate
        </Link>
      )}
    </span>
  )

  if (!jumpable) return <li>{content}</li>

  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(flag.entryId!)}
        className="flex w-full min-w-0 rounded px-1 py-0.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {content}
      </button>
    </li>
  )
}

function FlagIcon({ severity }: { severity: CloseFlag["severity"] }) {
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

function flagLabel(flag: CloseFlag): string {
  switch (flag.kind) {
    case "missing-overage-rate":
      return "Over budget with no overage rate"
    case "running-timer":
      return "A timer is still running in this period"
    case "long-entry":
      return "Entry over 8h — check for a forgotten timer"
    case "missing-note":
      return "Entry is missing a note"
    case "carried-in": {
      const month = flag.carried ? monthLabel(flag.carried.originMonthKey) : ""
      const reason =
        flag.carried?.reason === "logged-late"
          ? `Logged after ${month} closed`
          : `Skipped from ${month}`
      return `Carried in · ${reason}`
    }
  }
}

/** "2026-05" → "May 2026". */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}
