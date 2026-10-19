"use client"

import { useQuery } from "convex/react"
import { CheckIcon, CircleDashedIcon, MinusIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { RequestChecklistView } from "@/convex/agentWidgets"
import type { RequestChecklistRef } from "@/lib/agents/widgets"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useOpenWidgetTask } from "./use-open-task"

type Row = RequestChecklistView["rows"][number]

/**
 * Request checklist (email-triage B8a; PRD §7.1, from T15
 * `getThreadRequests`): "Kovács Réka asked 5 things", one row per ledger row
 * — the request in the client's words and where it stands (in a subtask →
 * link · answered · waiting on the client · dismissed with the reason). LIVE
 * from `agentWidgets.requestChecklist` by the conversation id: a row flips to
 * "answered" when the reply is sent. Unreadable (a member, the feature off,
 * the conversation gone) → one muted line.
 */
export function RequestChecklistBlock({ checklistRef }: { checklistRef: RequestChecklistRef }) {
  const view = useQuery(api.agentWidgets.requestChecklist, checklistRef)
  if (view === undefined) return <Skeleton className="h-24 w-full rounded-xl" />
  if (view === null) {
    return <p className="text-[13px] text-muted-foreground">These requests are no longer available.</p>
  }

  const who = view.askedBy ?? "The client"
  return (
    <Card size="sm" role="region" aria-label="Client requests" className="gap-0 px-3.5">
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className="text-sm font-medium">
          {who} asked {view.total} thing{view.total === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <span className={cn("text-xs text-muted-foreground", DETERMINISTIC_VALUE_CLASS)}>
          {view.open > 0 ? `${view.open} open` : "all placed"}
        </span>
      </div>
      <ul className="flex flex-col">
        {view.rows.map((row) => (
          <ChecklistRow key={row.id} row={row} />
        ))}
      </ul>
      {view.truncated && <p className="pt-1.5 text-xs text-muted-foreground">Older requests not shown.</p>}
    </Card>
  )
}

function ChecklistRow({ row }: { row: Row }) {
  const openTask = useOpenWidgetTask()
  const amber = row.state === "open" || row.state === "waiting"
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-2.5 border-t border-border/60 py-1.5 text-[13.5px]">
      {row.state === "dismissed" || row.state === "replaced" ? (
        <MinusIcon className="size-3.5 self-center text-muted-foreground/60" aria-label="Set aside" role="img" />
      ) : amber ? (
        <CircleDashedIcon className="size-3.5 self-center text-warning" aria-label="Waiting" role="img" />
      ) : (
        <CheckIcon className="size-3.5 self-center text-success" aria-label="Handled" role="img" />
      )}
      <span className={cn("text-foreground/90", row.state === "replaced" && "text-muted-foreground line-through")}>
        „{row.text}”
      </span>
      <span className={cn("max-w-56 truncate whitespace-nowrap text-xs", amber ? "text-warning" : "text-muted-foreground", DETERMINISTIC_VALUE_CLASS)}>
        {row.state === "covered" && row.covering ? (
          <button
            type="button"
            onClick={() => openTask({ id: row.covering!.taskId, identifier: row.covering!.identifier })}
            className="underline-offset-2 hover:text-foreground hover:underline"
            title={row.covering.title ?? undefined}
          >
            {row.covering.identifier ?? "in a subtask"}
          </button>
        ) : (
          stateLabel(row)
        )}
      </span>
    </li>
  )
}

function stateLabel(row: Row): string {
  switch (row.state) {
    case "covered":
      return "in a subtask"
    case "answered":
      return "answered"
    case "waiting":
      return "waiting on the client"
    case "dismissed":
      return row.reason ? `dismissed · ${row.reason}` : "dismissed"
    case "replaced":
      return "replaced"
    case "planned":
      return "in the plan"
    case "open":
      return "open"
  }
}
