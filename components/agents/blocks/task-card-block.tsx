"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import { firstName, formatRelativeTime, formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusIcon } from "@/components/icons/status-icon"
import { UserAvatar } from "@/components/user-avatar"
import { useOpenWidgetTask } from "./use-open-task"

/**
 * Task status card (email-triage B8a; PRD §7.1, from T14 `getTaskBundle`):
 * key + title, status, "3/5 subtasks", owners, due, the last event and the
 * open client questions; Open shows the task. LIVE: the block stores only the
 * task id and reads `agentWidgets.taskCard` with the viewer's access, so it
 * shows the current state whenever it is on screen — or one muted line when
 * the task is gone or no longer readable.
 */
export function TaskCardBlock({ taskId }: { taskId: string }) {
  const card = useQuery(api.agentWidgets.taskCard, { taskId })
  const openTask = useOpenWidgetTask()

  if (card === undefined) return <Skeleton className="h-[88px] w-full rounded-xl" />
  if (card === null) {
    return <p className="text-[13px] text-muted-foreground">This task is no longer available.</p>
  }

  const questions = card.openQuestions
  return (
    <Card size="sm" role="region" aria-label="Task status" className="gap-1.5 px-3.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("shrink-0 text-xs text-muted-foreground", DETERMINISTIC_VALUE_CLASS)}>{card.identifier}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{card.title}</span>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={() => openTask({ id: card.id, identifier: card.identifier })}
        >
          Open
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-foreground/80">
        {card.status && (
          <span className="flex items-center gap-1.5">
            <StatusIcon icon={card.status.icon} color={card.status.color} />
            {card.status.name}
          </span>
        )}
        {card.subtaskCount > 0 && (
          <span className={DETERMINISTIC_VALUE_CLASS}>
            {card.subtaskDoneCount}/{card.subtaskCount} subtasks
          </span>
        )}
        {card.owners.length > 0 && (
          <span className="flex min-w-0 items-center gap-1.5">
            <UserAvatar name={card.owners[0].name} imageUrl={card.owners[0].imageUrl} className="size-[18px] text-[8px]" />
            <span className="truncate">{card.owners.map((o) => firstName(o.name)).join(", ")}</span>
          </span>
        )}
        {card.dueDate && (
          <span className={cn("text-muted-foreground", DETERMINISTIC_VALUE_CLASS)}>due {formatShortDate(card.dueDate)}</span>
        )}
      </div>
      {(card.lastEvent || (questions !== null && questions > 0)) && (
        <p className="border-t border-border/60 pt-1.5 text-[13px] text-muted-foreground">
          {card.lastEvent && (
            <>
              Last: {card.lastEvent.actor} · {card.lastEvent.summary} · {formatRelativeTime(card.lastEvent.at)}
            </>
          )}
          {card.lastEvent && questions !== null && questions > 0 && " · "}
          {questions !== null && questions > 0 && (
            <span className="text-warning">
              {questions} open question{questions === 1 ? "" : "s"}
            </span>
          )}
        </p>
      )}
    </Card>
  )
}
