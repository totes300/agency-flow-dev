"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { CheckIcon, ChevronDownIcon, InboxIcon } from "lucide-react"
import type { TriageRow as TriageRowData, TriageView } from "@/convex/email/triageView"
import { updatedLabel, type TriageTone } from "@/lib/agents/triageState"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatRowTime, formatSnoozeUntil, senderLabel } from "@/components/triage/format"

export const TRIAGE_VIEWS: ReadonlyArray<{ value: TriageView; label: string; menuLabel: string }> = [
  { value: "open", label: "Triage", menuLabel: "Needs you" },
  { value: "snoozed", label: "Snoozed", menuLabel: "Snoozed" },
  { value: "done", label: "Done", menuLabel: "Done · last 30 days" },
  { value: "filtered", label: "Filtered", menuLabel: "Filtered" },
]

/** The dot of a row state: amber = waits on you, grey = in progress, green = done. */
export const TONE_DOT: Record<TriageTone, string> = {
  waiting: "bg-warning",
  progress: "bg-muted-foreground/40",
  done: "bg-success",
}

const TONE_TEXT: Record<TriageTone, string> = {
  waiting: "text-warning",
  progress: "text-muted-foreground",
  done: "text-success",
}

/**
 * The Triage list (docs/prd-email-triage.md §7.2, D24, D26; B8b): one row per
 * item — client · sender and the time, the title (bold while nothing is
 * prepared yet), the state with its dot, "Updated · N emails". The views sit
 * behind the quiet header control; Filtered rows carry "Move to Triage".
 */
export function TriageList({
  className,
  view,
  onViewChange,
  rows,
  selectedId,
  onSelect,
  onPromote,
  gmailConnected,
  more = null,
}: {
  className?: string
  view: TriageView
  onViewChange: (view: TriageView) => void
  rows: readonly TriageRowData[] | undefined
  selectedId: string | null
  onSelect: (id: string) => void
  onPromote: (id: string) => void
  gmailConnected: boolean
  /** More rows on the server: "Showing 50 · Show more" (the next page by cursor). */
  more?: { loading: boolean; load: () => void } | null
}) {
  const current = TRIAGE_VIEWS.find((v) => v.value === view) ?? TRIAGE_VIEWS[0]
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the selected row in view while J/K move it.
  useEffect(() => {
    if (!selectedId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView?.({ block: "nearest" })
  }, [selectedId])

  return (
    <nav
      aria-label="Triage list"
      className={cn("flex w-[296px] shrink-0 flex-col border-r border-border/60 bg-muted/30 max-md:w-full", className)}
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 pl-4 pr-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 gap-1 px-2 text-sm font-medium" aria-label={`View: ${current.menuLabel}`}>
              {current.label}
              <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {TRIAGE_VIEWS.map((v) => (
              <DropdownMenuItem key={v.value} onSelect={() => onViewChange(v.value)}>
                <span className="flex-1">{v.menuLabel}</span>
                {v.value === view && <CheckIcon className="size-3.5" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {rows && rows.length > 0 && <span className="text-[13px] tabular-nums text-muted-foreground">{rows.length}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {rows === undefined ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <ListEmpty view={view} gmailConnected={gmailConnected} />
        ) : (
          <ul ref={listRef} className="flex flex-col gap-px" aria-label={current.menuLabel}>
            {rows.map((row) => (
              <li key={row._id}>
                <TriageRow
                  row={row}
                  selected={row._id === selectedId}
                  onSelect={() => onSelect(row._id)}
                  onPromote={view === "filtered" ? () => onPromote(row._id) : undefined}
                />
              </li>
            ))}
            {more && (
              <li className="flex items-center gap-1 px-2.5 py-2 text-xs text-muted-foreground">
                <span>Showing {rows.length}</span>
                <span aria-hidden>·</span>
                <Button variant="ghost" size="xs" className="-ml-1 text-muted-foreground" disabled={more.loading} onClick={more.load}>
                  {more.loading ? "Loading…" : "Show more"}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
      <p className="px-4 pb-3 pt-2 text-xs text-muted-foreground/70">J / K to move · ? for shortcuts</p>
    </nav>
  )
}

export function TriageRow({
  row,
  selected,
  onSelect,
  onPromote,
}: {
  row: TriageRowData
  selected: boolean
  onSelect: () => void
  onPromote?: () => void
}) {
  const who = [row.clientName ?? (row.kind === "new_sender" ? "New sender" : null), row.sender ? senderLabel(row.sender) : null]
    .filter(Boolean)
    .join(" · ")
  const updated = updatedLabel(row.messageCount)
  const label = row.status === "snoozed" && row.snoozedUntil ? `Snoozed until ${formatSnoozeUntil(row.snoozedUntil)}` : row.state.label
  return (
    <div
      data-item-id={row._id}
      data-selected={selected || undefined}
      className={cn("group relative rounded-lg transition-colors", selected ? "bg-accent" : "hover:bg-accent/60")}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{who || "Unknown sender"}</span>
          <span className="flex-1" />
          {row.urgent && <span className="shrink-0 text-destructive">Urgent</span>}
          {row.unverifiedSender && <span className="shrink-0 text-amber-600 dark:text-amber-500">Unverified sender</span>}
          <span className="shrink-0 tabular-nums">{formatRowTime(row.at)}</span>
        </span>
        <span className={cn("w-full truncate text-[13px]", row.state.fresh ? "font-semibold" : "font-medium")}>{row.title}</span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[12.5px]">
          {row.state.live ? (
            <LiveDots />
          ) : (
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[row.state.tone])} />
          )}
          <span className={cn("min-w-0 truncate", TONE_TEXT[row.state.tone])} data-tone={row.state.tone}>
            {label}
          </span>
          {updated && <span className="shrink-0 text-muted-foreground">· {updated}</span>}
        </span>
      </button>
      {onPromote && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onPromote}
          className="absolute bottom-1.5 right-1.5 text-muted-foreground"
        >
          Move to Triage
        </Button>
      )}
    </div>
  )
}

/** "Preparing…" — three soft pulsing dots instead of the state dot. */
function LiveDots() {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[2px]">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-[3px] animate-pulse rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

function ListEmpty({ view, gmailConnected }: { view: TriageView; gmailConnected: boolean }) {
  if (view !== "open") {
    const text = view === "snoozed" ? "Nothing snoozed." : view === "done" ? "Nothing done in the last 30 days." : "Nothing filtered."
    return <p className="px-2.5 py-6 text-[13px] text-muted-foreground">{text}</p>
  }
  return (
    <div className="flex flex-col gap-6 px-2 py-12">
      <EmptyState icon={InboxIcon} title="Nothing needs you" description="Client emails that need a decision show up here." />
      {!gmailConnected && (
        <p className="text-center text-[13px] text-muted-foreground">
          No admin mailbox is connected yet —{" "}
          <Link href="/agents?view=connectors" className="text-foreground underline-offset-2 hover:underline">
            connect Gmail in Connectors
          </Link>
          .
        </p>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1 pt-1" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-lg px-2 py-2.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}
