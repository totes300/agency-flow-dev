"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "convex/react"
import { ArrowUpRightIcon, CornerDownLeftIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { QuestionBlockData } from "@/convex/agentQuestions"
import {
  answerSummary,
  questionKeyAction,
  validateAnswer,
  type QuestionOption,
} from "@/lib/agents/questions"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useComposerBridge } from "@/components/agents/composer-bridge"

/**
 * `question` block (A5; PRD D16, §6.6, §7.1) — one decision the agent asked
 * for. Renders from the LIVE `agentQuestions` record (reactive query), never
 * from the tool output, so answered / later / superseded show their current
 * state for everyone in the thread.
 *
 * Pending: header, question, the muted "why" line, numbered options
 * (description, "Recommended", a quiet trailing effect icon), checkboxes +
 * Submit for multi-select, an "Other" field, and Later. An option with a
 * composer prefix types it into the thread composer instead of answering.
 * Keys 1–4 pick ONLY while the block itself has focus and never from an
 * editable field (F10); Enter submits a multi-select from the block or a
 * checkbox. A pending block takes focus when it appears (unless the user is
 * typing somewhere), so the keys work without a click. After an answer focus
 * returns to the composer. Settled states are one muted line. Read-only
 * viewers get an inert version.
 */
export function QuestionBlock({
  questionId,
  readOnly = false,
}: {
  questionId: string
  readOnly?: boolean
}) {
  const data = useQuery(api.agentQuestions.getForBlock, { questionId })
  // Set when this viewer just settled it without a composer to return to:
  // the settled line takes focus instead.
  const [focusSettled, setFocusSettled] = useState(false)
  if (data === undefined) return <Skeleton className="h-28 w-full rounded-lg" />
  if (data === null) return null

  if (data.status === "answered") {
    const who = data.answeredByViewer ? "You" : (data.answeredByName ?? "Someone")
    return (
      <SettledLine header={data.header} autoFocus={focusSettled}>
        {answerSummary(data, data.answer, who, data.settledInConversation)}
      </SettledLine>
    )
  }
  if (data.status === "superseded") {
    return <SettledLine header={data.header}>Replaced by a newer question</SettledLine>
  }
  if (data.status === "later") {
    return (
      <LaterLine
        data={data}
        interactive={!readOnly && data.canAnswer}
        autoFocus={focusSettled}
      />
    )
  }
  if (data.stale) {
    return <SettledLine header={data.header}>This changed — see the new plan</SettledLine>
  }
  if (readOnly || !data.canAnswer) return <InertQuestion data={data} />
  return <QuestionForm data={data} onSettledWithoutComposer={() => setFocusSettled(true)} />
}

// ─── Settled states ─────────────────────────────────────────────────────────

function SettledLine({
  header,
  children,
  action,
  autoFocus = false,
}: {
  header: string
  children: React.ReactNode
  action?: React.ReactNode
  /** Take focus on mount (the viewer just settled it, no composer). */
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true })
  }, [autoFocus])
  return (
    <div
      ref={ref}
      tabIndex={autoFocus ? -1 : undefined}
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground outline-none"
    >
      <span className="shrink-0 text-muted-foreground/70">{header}</span>
      <span aria-hidden className="text-muted-foreground/40">·</span>
      <span className="min-w-0 truncate">{children}</span>
      {action}
    </div>
  )
}

function LaterLine({
  data,
  interactive,
  autoFocus,
}: {
  data: QuestionBlockData
  interactive: boolean
  autoFocus: boolean
}) {
  const reopen = useMutation(api.agentQuestions.reopen)
  const [busy, setBusy] = useState(false)
  return (
    <SettledLine
      header={data.header}
      autoFocus={autoFocus}
      action={
        interactive ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void reopen({ questionId: data._id })
                .catch((err) => toastError(err, "Couldn't reopen the question"))
                .finally(() => setBusy(false))
            }}
          >
            Answer now
          </Button>
        ) : null
      }
    >
      Set aside for later
    </SettledLine>
  )
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

function QuestionHeading({ data, id }: { data: QuestionBlockData; id?: string }) {
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="text-xs text-muted-foreground">{data.header}</div>
      <div id={id} className="mt-0.5 text-sm font-medium leading-snug">
        {data.question}
      </div>
      {data.why && (
        <div className="mt-1 text-xs text-muted-foreground/70">{data.why}</div>
      )}
    </div>
  )
}

const EFFECT_META = {
  email_client: { Icon: ArrowUpRightIcon, label: "Drafts an email to the client" },
  answer_here: { Icon: CornerDownLeftIcon, label: "Answers here" },
} as const

function OptionBody({ option, index }: { option: QuestionOption; index: number }) {
  const effect = option.effect ? EFFECT_META[option.effect] : null
  return (
    <>
      <span className="mt-px w-3 shrink-0 text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm">{option.label}</span>
        {option.recommended && (
          <span className="ml-1.5 text-xs text-muted-foreground">Recommended</span>
        )}
        {option.description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
      {effect && (
        <span title={effect.label} className="mt-0.5 shrink-0 text-muted-foreground/60">
          <effect.Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{effect.label}</span>
        </span>
      )}
    </>
  )
}

/** Read-only viewers: the question and its options, nothing to press. */
function InertQuestion({ data }: { data: QuestionBlockData }) {
  return (
    <div className="rounded-lg border bg-background">
      <QuestionHeading data={data} />
      <div className="flex flex-col px-1.5 pb-1.5">
        {data.options.map((option, i) => (
          <div key={i} className="flex items-start gap-3 rounded-md px-2.5 py-2">
            <OptionBody option={option} index={i} />
          </div>
        ))}
      </div>
      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground/60">
        Waiting for an answer
      </div>
    </div>
  )
}

// ─── Pending, interactive ───────────────────────────────────────────────────

/** Focus inside a typing surface — the question's keys never fire there. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function QuestionForm({
  data,
  onSettledWithoutComposer,
}: {
  data: QuestionBlockData
  onSettledWithoutComposer: () => void
}) {
  const answer = useMutation(api.agentQuestions.answer)
  const later = useMutation(api.agentQuestions.later)
  const composer = useComposerBridge()
  const [selected, setSelected] = useState<number[]>([])
  const [other, setOther] = useState("")
  const [busy, setBusy] = useState(false)
  const headingId = `question-${data._id}`
  const containerRef = useRef<HTMLDivElement>(null)

  // Take focus when the pending question appears (one pending per thread, so
  // this is the latest), so 1–4 work without a click — Safari included,
  // where clicks don't focus buttons. Never while the user is typing.
  useEffect(() => {
    if (isEditableTarget(document.activeElement)) return
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  /** After an answer / Later: back to the composer, else the settled line. */
  function handOffFocus() {
    if (composer) composer.focus()
    else onSettledWithoutComposer()
  }

  function submit(optionIndexes: number[], otherText: string) {
    if (busy) return
    const validated = validateAnswer(data, { optionIndexes, other: otherText })
    if (!validated.ok) return
    setBusy(true)
    void answer({
      questionId: data._id,
      optionIndexes: validated.answer.optionIndexes,
      other: validated.answer.other,
    })
      .then(handOffFocus)
      .catch((err) => toastError(err, "Couldn't save the answer"))
      .finally(() => setBusy(false))
  }

  function pick(index: number) {
    const option = data.options[index]
    if (!option || busy) return
    // "I'll give the exact time" → the composer, not an answer.
    if (option.composerPrefix) {
      composer?.insertPrefix(option.composerPrefix)
      return
    }
    if (data.multiSelect) {
      setSelected((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
      )
      return
    }
    submit([index], "")
  }

  function submitCurrent() {
    submit(data.multiSelect ? selected : [], other)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = questionKeyAction(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetEditable: isEditableTarget(event.target),
        // Enter submits from the block itself or a checkbox only; on Later
        // or a prefix option it activates that button.
        targetSubmits:
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.getAttribute("role") === "checkbox"),
      },
      { optionCount: data.options.length, multiSelect: data.multiSelect },
    )
    if (!action) return
    event.preventDefault()
    if (action.type === "pick") pick(action.index)
    else submitCurrent()
  }

  const canSubmit = validateAnswer(data, {
    optionIndexes: data.multiSelect ? selected : [],
    other,
  }).ok
  const showSubmit = data.multiSelect || other.trim().length > 0

  return (
    <div
      ref={containerRef}
      role="group"
      aria-labelledby={headingId}
      aria-keyshortcuts={data.options.map((_, i) => String(i + 1)).join(" ")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-lg border bg-background outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <QuestionHeading data={data} id={headingId} />
      <div className="flex flex-col px-1.5 pb-1.5">
        {data.options.map((option, i) =>
          data.multiSelect && !option.composerPrefix ? (
            <label
              key={i}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 hover:bg-muted/60",
                busy && "pointer-events-none opacity-50",
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={selected.includes(i)}
                onCheckedChange={() => pick(i)}
                disabled={busy}
              />
              <OptionBody option={option} index={i} />
            </label>
          ) : (
            <button
              key={i}
              type="button"
              disabled={busy}
              onClick={() => pick(i)}
              className="flex items-start gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60 disabled:opacity-50"
            >
              <OptionBody option={option} index={i} />
            </button>
          ),
        )}
      </div>
      {data.allowOther && (
        <div className="border-t px-4 py-1.5">
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submitCurrent()
              }
            }}
            disabled={busy}
            placeholder="Or type your answer…"
            aria-label="Other answer"
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      )}
      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
        <span className="text-xs text-muted-foreground/60">
          {data.multiSelect ? "Pick any that apply" : "Pick one"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-muted-foreground"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void later({ questionId: data._id })
                .then(handOffFocus)
                .catch((err) => toastError(err, "Couldn't set the question aside"))
                .finally(() => setBusy(false))
            }}
          >
            Later
          </Button>
          {showSubmit && (
            <Button size="sm" className="h-7" disabled={busy || !canSubmit} onClick={submitCurrent}>
              Submit
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
