"use client"

import { useEffect, useState } from "react"
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
} from "lucide-react"
import type { JobStage, StageRunStatus } from "@/lib/agents/jobStages"
import { formatElapsed, runLineView, type RunLineStep } from "@/lib/agents/runLine"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import { cn } from "@/lib/utils"
import { ToolCallBlock } from "./tool-call-block"

/** One tool call of the run (the classifier's `tool` block fields). */
export type RunLineCall = {
  toolName: string
  phase: "running" | "done" | "error"
  input: unknown
  output: unknown
  errorText: string | null
}

/**
 * The run line of a JOB run (email-triage B8a; PRD §6.5, §7.1; Claude Code
 * style). Rendered from the job's fixed stages and the run's real tool parts
 * (`lib/agents/runLine.ts`), never from a script:
 *
 *   running   the step list — ✓ done (muted result) / spinner / dashed — and a
 *             live "‹stage›… · 4s ›" line; the chevron shows the quiet tool rows;
 *   finished  ONE collapsed line ("Read the email and ARL-57 · 6s ›") that
 *             expands to the steps and the tool rows (the same
 *             `ToolCallBlock` ghost rows a plain chat run shows inline).
 */
export function RunLineBlock({
  stages,
  calls,
  status,
  startedAt,
  finishedAt,
}: {
  stages: readonly JobStage[]
  calls: readonly RunLineCall[]
  status: StageRunStatus
  startedAt: number
  finishedAt: number | null
}) {
  const view = runLineView(stages, calls, status)
  // A run with a failed tool call starts expanded, so the failure is visible.
  const [expandedChoice, setExpanded] = useState<boolean | null>(null)
  const expanded = expandedChoice ?? view.failed > 0
  const now = useNow(view.live)
  const elapsed = formatElapsed((finishedAt ?? now) - startedAt)

  if (!view.live && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        className="-mx-1.5 flex max-w-full items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span className="truncate">{view.summary}</span>
        <span className="shrink-0 text-muted-foreground/50">·</span>
        <span className={cn("shrink-0", DETERMINISTIC_VALUE_CLASS)}>{elapsed}</span>
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {!view.live && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded
          className="-mx-1.5 mb-0.5 flex max-w-full items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <span className="truncate">{view.summary}</span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className={cn("shrink-0", DETERMINISTIC_VALUE_CLASS)}>{elapsed}</span>
          <ChevronRightIcon className="size-3 shrink-0 rotate-90" aria-hidden />
        </button>
      )}
      <ol aria-label="Run steps" className="flex flex-col gap-px">
        {view.steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
      </ol>
      {view.live && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="-mx-1.5 flex max-w-full items-center gap-2 self-start rounded-md px-1.5 py-0.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60"
        >
          <LiveDots />
          <span className="truncate">{view.current ? `${view.current}…` : "Working…"}</span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className={cn("shrink-0 text-muted-foreground/70", DETERMINISTIC_VALUE_CLASS)}>{elapsed}</span>
          <ChevronRightIcon className={cn("size-3 shrink-0", expanded && "rotate-90")} aria-hidden />
        </button>
      )}
      {expanded && calls.length > 0 && (
        <div aria-label="Tool calls" className="mt-1 flex flex-col border-l pl-3">
          {calls.map((call, i) => (
            <ToolCallBlock key={i} {...call} />
          ))}
        </div>
      )}
    </div>
  )
}

function StepRow({ step }: { step: RunLineStep }) {
  return (
    <li className="flex min-h-6 min-w-0 items-center gap-2 text-[13px]">
      {step.state === "done" ? (
        <CircleCheckIcon aria-label="Done" className="size-3.5 shrink-0 fill-muted-foreground/45 text-background" />
      ) : step.state === "working" ? (
        <LoaderCircleIcon aria-label="In progress" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : step.state === "stopped" ? (
        <CircleSlashIcon aria-label="Stopped" className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <CircleDashedIcon aria-label="Pending" className="size-3.5 shrink-0 text-muted-foreground/40" />
      )}
      <span
        className={cn(
          "shrink-0 whitespace-nowrap",
          step.state === "done" && "text-foreground/80",
          step.state === "working" && "font-medium text-foreground",
          (step.state === "pending" || step.state === "stopped") && "text-muted-foreground/70",
        )}
      >
        {step.label}
      </span>
      {step.state === "done" && step.detail && (
        <span className={cn("min-w-0 truncate text-muted-foreground/60", DETERMINISTIC_VALUE_CLASS)}>
          {step.detail}
        </span>
      )}
    </li>
  )
}

/** Three softly pulsing dots — the live line's "working" mark. */
function LiveDots() {
  return (
    <span aria-hidden className="flex w-3.5 shrink-0 items-center justify-center gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1 animate-pulse rounded-full bg-warning"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

/** Wall clock, ticking every second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live])
  return now
}
