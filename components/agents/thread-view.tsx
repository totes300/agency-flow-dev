"use client"

import { useEffect, useMemo, useRef } from "react"
import { useQuery } from "convex/react"
import { useUIMessages } from "@convex-dev/agent/react"
import { EyeIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { ThreadComposer } from "@/components/agents/thread-composer"
import type { AgentComposerHandle, ComposerSuggestion } from "@/components/agents/composer"
import {
  ComposerBridgeContext,
  type ComposerBridge,
} from "@/components/agents/composer-bridge"
import { BlockRenderer } from "@/components/agents/blocks/block-renderer"
import { ErrorBlock } from "@/components/agents/blocks/error-block"
import { RunLineBlock, type RunLineCall } from "@/components/agents/blocks/run-line-block"
import { DraftPrimaryProvider } from "@/components/agents/blocks/draft-primary"
import { SystemBlock } from "@/components/agents/blocks/system-block"
import { UserMessage } from "@/components/agents/user-message"
import { ProposalDrawer } from "@/components/task-detail/proposal-drawer"
import {
  classifyParts,
  deliverableBlocks,
  latestDraftBlocks,
  type AgentBlock,
  type MessagePartLike,
} from "@/lib/agents/blocks"
import { JOB_STAGES, type StageRunStatus } from "@/lib/agents/jobStages"
import { backgroundJobPrompts, runAnchor, runAt, type RunWindow } from "@/lib/agents/threadRuns"
import { cleanErrorText } from "@/lib/agents/providerErrors"

/**
 * The designed chat experience (slice 02): typed block renderers over the
 * component's UIMessage parts, interleaved with run-derived error/system
 * blocks (failed → error + hint, stopped → quiet system line), and the
 * run-state composer below.
 *
 * A JOB run (`agentRuns.job` with stages in `JOB_STAGES`, email-triage B8a)
 * renders as ONE run line — its stages from the run's real tool parts, with a
 * live "‹stage›… · 4s" line while it works, one collapsed line when done —
 * followed only by its deliverable (prose, plan, question, email); its tool
 * rows live inside the run line and a background job's machine prompt is not
 * shown as a user turn. Every other run renders as before.
 */
export function ThreadView({
  threadId,
  suggestions,
  header,
  lead,
  trailing,
  belowComposer,
  proposalDrawer = true,
}: {
  threadId: string
  /** Composer suggestion chips for the current state (Triage provides them, B8b). */
  suggestions?: readonly ComposerSuggestion[]
  /** Replaces the default title bar (Triage: the item title + the panel toggle). */
  header?: React.ReactNode
  /** Rendered first in the conversation, above the timeline (Triage: the original email, D14). */
  lead?: React.ReactNode
  /** Rendered after the timeline (Triage: the decision for the item — Create, Apply …). */
  trailing?: React.ReactNode
  /** Quiet actions under the composer (Triage: Merge into… · Decline · Snooze). */
  belowComposer?: React.ReactNode
  /**
   * Mount the proposal drawer here (default). Off when the page mounts its
   * own (Triage's `TaskDetailDrawer` carries the `?draft=` / `?change=` drawer).
   */
  proposalDrawer?: boolean
}) {
  const thread = useQuery(api.agentThreads.get, { threadId })
  const runs = useQuery(api.agentThreads.listRuns, { threadId })
  const { results: messages, status: loadStatus } = useUIMessages(
    api.agentThreads.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  )

  // Blocks reach the composer through this bridge (a question option's
  // composer prefix — A5); the handle itself stays owned by the composer.
  const composerRef = useRef<AgentComposerHandle>(null)
  const composerBridge = useMemo<ComposerBridge>(
    () => ({
      insertPrefix: (text) => composerRef.current?.insertPrefix(text),
      focus: () => composerRef.current?.focus(),
    }),
    [],
  )

  // Pin the stream to the bottom while messages arrive/grow.
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastMessage = messages.at(-1)
  const streamSignature = `${messages.length}:${lastMessage?.text.length ?? 0}:${runs?.length ?? 0}`
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [streamSignature])

  if (thread === undefined || loadStatus === "LoadingFirstPage") {
    // A surface's own header / lead stay mounted at the same place while the
    // thread loads (Triage's email keeps its scroll, selection and fold).
    return (
      <ThreadFrame
        header={header ?? <SkeletonHeader />}
        lead={lead}
        trailing={trailing}
        bridge={null}
        draftOrder={NO_DRAFTS}
        bottomRef={bottomRef}
        footer={
          <>
            <div className="border-t p-4">
              <Skeleton className="mx-auto h-24 w-full max-w-2xl rounded-lg" />
            </div>
            {belowComposer}
          </>
        }
      >
        <SkeletonTurns />
      </ThreadFrame>
    )
  }

  // Without write access (an admin auditing a member's private thread) the
  // composer is replaced with a notice and proposal cards render inert. Every
  // write path re-checks the thread policy server-side, so this is UX, not
  // the security gate.
  const readOnly = !thread.viewerCanWrite

  // A shared (admins) thread names the sender of each user turn.
  const authorNames =
    thread.visibility === "admins"
      ? new Map(thread.authors.map((a) => [a.userId as string, a.name]))
      : null

  // Job runs (B8a): which messages belong to a staged job run, their tool
  // calls (→ the run line), and the background prompts to hide.
  const windows: RunWindow[] = (runs ?? []).map((r) => ({
    id: r._id,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    job: r.job,
    via: r.via,
    answersQuestion: r.answersQuestion,
    started: r.started,
    promptMessageId: r.promptMessageId,
  }))
  const stagedRun = (run: RunWindow | null) =>
    run && run.job && JOB_STAGES[run.job] ? run : null
  // Hidden by the exact prompt id each run recorded — never by timestamps.
  const hiddenPrompts = backgroundJobPrompts(windows)
  // A run's lines sort at or after its prompt (stamped after startedAt on a
  // real deployment), so a shown typed turn / answer stays above its run.
  const userTimes = new Map(
    messages.filter((m) => m.role === "user").map((m) => [m.id, m._creationTime]),
  )
  const anchorOf = (run: { startedAt: number; promptMessageId: string | null }) =>
    runAnchor(run, userTimes)
  const jobCalls = new Map<string, RunLineCall[]>()

  // One timeline: messages by creation time + settled-run outcomes by
  // finish time, so an error/stop note lands under the run it closes. On a
  // tie, a user turn sorts first, then a run line, then the rest.
  const timeline: { key: string; at: number; rank: number; node: React.ReactNode }[] = []
  const assistant: { key: string; at: number; blocks: AgentBlock[] }[] = []
  for (const message of messages) {
    if (message.role === "user") {
      if (hiddenPrompts.has(message.id)) continue
      timeline.push({
        key: message.key,
        at: message._creationTime,
        rank: 0,
        node: (
          <UserMessage
            text={message.text}
            authorName={
              authorNames && message.userId
                ? authorNames.get(message.userId)
                : undefined
            }
          />
        ),
      })
      continue
    }
    const all = classifyParts(message.parts as unknown as MessagePartLike[])
    const jobRun = stagedRun(runAt(windows, message._creationTime))
    let blocks: AgentBlock[] = all
    if (jobRun) {
      const calls = jobCalls.get(jobRun.id) ?? []
      for (const b of all) if (b.kind === "tool") calls.push(b)
      jobCalls.set(jobRun.id, calls)
      blocks = deliverableBlocks(all)
    }
    assistant.push({ key: message.key, at: message._creationTime, blocks })
  }
  // A revised draft renders once, at its latest version's marker (B8a).
  assistant.sort((a, b) => a.at - b.at)
  const { groups, draftOrder } = latestDraftBlocks(assistant.map((a) => a.blocks))
  assistant.forEach((entry, i) => {
    const blocks = groups[i]
    if (blocks.length === 0) return
    timeline.push({
      key: entry.key,
      at: entry.at,
      rank: 2,
      node: <AssistantBlocks blocks={blocks} readOnly={readOnly} />,
    })
  })
  for (const run of runs ?? []) {
    const staged = run.job ? JOB_STAGES[run.job] : undefined
    if (staged && run.started) {
      timeline.push({
        key: `${run._id}-run-line`,
        at: anchorOf(run),
        rank: 1,
        node: (
          <RunLineBlock
            stages={staged}
            calls={jobCalls.get(run._id) ?? []}
            status={run.status as StageRunStatus}
            startedAt={run.startedAt}
            finishedAt={run.finishedAt}
          />
        ),
      })
    }
  }
  for (const run of runs ?? []) {
    // A background run waiting for the active one (I11) — its message is
    // posted when it starts, so only a quiet note shows meanwhile.
    if (run.queuedAt !== null) {
      // The run a question answer started (A5) shows as its answer turn
      // once it starts — no generic queued line meanwhile.
      if (run.answersQuestion) continue
      timeline.push({
        key: `${run._id}-queued`,
        at: run.queuedAt,
        rank: 2,
        node: (
          <SystemBlock>
            Background run queued — starts when the current run finishes.
          </SystemBlock>
        ),
      })
      continue
    }
    // "Skill loaded" notes anchor to run start, so they sort right after the
    // triggering user message and above the agent's response (slice 04).
    for (const skill of run.loadedSkills) {
      timeline.push({
        key: `${run._id}-skill-${skill.name}`,
        at: anchorOf(run),
        rank: 1,
        node: (
          <SystemBlock>
            Skill loaded: {skill.name}
            {skill.isStopCondition && " · stop-condition"}
          </SystemBlock>
        ),
      })
    }
    // A tool the agent references no longer exists in the registry — dropped
    // before the model call, flagged here instead of failing the run (slice 09).
    // Every run mode gets the same tools (A7); besides renamed/removed tools
    // this only names connector tools a non-interactive run can't use.
    if (run.droppedTools.length > 0) {
      timeline.push({
        key: `${run._id}-dropped-tools`,
        at: anchorOf(run),
        rank: 1,
        node: (
          <SystemBlock>
            {run.droppedTools.length === 1
              ? `Unavailable tool skipped: ${run.droppedTools[0]}`
              : `Unavailable tools skipped: ${run.droppedTools.join(", ")}`}
          </SystemBlock>
        ),
      })
    }
    if (run.finishedAt === null) continue
    if (run.stoppedBySkill) {
      // A stop-condition fired — the run halted deliberately. Explain which
      // skill stopped it and why, in the error block's message+hint shape.
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        rank: 2,
        node: (
          <ErrorBlock
            message={`Stopped by the “${run.stoppedBySkill.skillName}” skill`}
            hint={run.stoppedBySkill.reason}
          />
        ),
      })
    } else if (run.status === "failed" && run.error) {
      // Shown as stored (classified server-side); only cleaned, so an older
      // row can never show a stack trace (providerErrors.ts).
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        rank: 2,
        node: (
          <ErrorBlock
            message={cleanErrorText(run.error)}
            hint={run.errorHint ? cleanErrorText(run.errorHint) : null}
          />
        ),
      })
    } else if (run.cancelledBeforeStart) {
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        rank: 2,
        node: <SystemBlock>Queued background run cancelled.</SystemBlock>,
      })
    } else if (run.status === "cancelled") {
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        rank: 2,
        node: <SystemBlock>Run stopped — partial output kept.</SystemBlock>,
      })
    }
  }
  timeline.sort((a, b) => a.at - b.at || a.rank - b.rank)

  return (
    <ThreadFrame
      header={
        header ?? (
          <div className="flex h-12 shrink-0 items-center border-b px-4">
            <span className="truncate text-sm font-medium">{thread.title}</span>
            <span className="ml-2 truncate text-xs text-muted-foreground">
              {thread.agentName}
            </span>
          </div>
        )
      }
      lead={lead}
      trailing={trailing}
      bridge={readOnly ? null : composerBridge}
      draftOrder={draftOrder}
      bottomRef={bottomRef}
      footer={
        <>
          {readOnly ? (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <EyeIcon className="size-3.5" aria-hidden />
              Viewing another member&apos;s thread — read-only.
            </div>
          ) : (
            <ThreadComposer
              threadId={threadId}
              agentName={thread.agentName}
              isRunning={thread.status === "running"}
              activeRun={thread.activeRun}
              composerRef={composerRef}
              suggestions={suggestions}
            />
          )}
          {belowComposer}
          {/* A proposal card's "Open" (`?draft=` / `?change=`, email-triage B7). */}
          {proposalDrawer && <ProposalDrawer readOnly={readOnly} />}
        </>
      }
    >
      {timeline.map((entry) => (
        <div key={entry.key} className="flex flex-col">
          {entry.node}
        </div>
      ))}
    </ThreadFrame>
  )
}

const NO_DRAFTS: readonly string[] = []

/**
 * The conversation's one structure, loading or loaded — header, the scroll
 * column (lead, the timeline, trailing), then the composer area — so what a
 * surface passes in keeps its place (and its state) when the thread arrives.
 */
function ThreadFrame({
  header,
  lead,
  trailing,
  bridge,
  draftOrder,
  bottomRef,
  footer,
  children,
}: {
  header: React.ReactNode
  lead?: React.ReactNode
  trailing?: React.ReactNode
  bridge: ComposerBridge | null
  draftOrder: readonly string[]
  bottomRef: React.RefObject<HTMLDivElement | null>
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ComposerBridgeContext.Provider value={bridge}>
          <DraftPrimaryProvider order={draftOrder}>
            <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
              {lead}
              {children}
              {trailing}
              <div ref={bottomRef} />
            </div>
          </DraftPrimaryProvider>
        </ComposerBridgeContext.Provider>
      </div>
      {footer}
    </div>
  )
}

function SkeletonHeader() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

function SkeletonTurns() {
  return (
    <>
      <Skeleton className="ml-12 h-9 w-48 self-end rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </>
  )
}

function AssistantBlocks({
  blocks,
  readOnly,
}: {
  blocks: readonly AgentBlock[]
  readOnly: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} readOnly={readOnly} />
      ))}
    </div>
  )
}

/** Content-aware: header line, one user bubble, one assistant block. */
export function ThreadViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SkeletonHeader />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        <SkeletonTurns />
      </div>
      <div className="border-t p-4">
        <Skeleton className="mx-auto h-24 w-full max-w-2xl rounded-lg" />
      </div>
    </div>
  )
}
