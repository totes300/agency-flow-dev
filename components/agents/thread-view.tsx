"use client"

import { useEffect, useMemo, useRef } from "react"
import { useQuery } from "convex/react"
import { useUIMessages } from "@convex-dev/agent/react"
import type { UIMessage } from "@convex-dev/agent/react"
import { EyeIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { ThreadComposer } from "@/components/agents/thread-composer"
import type { AgentComposerHandle } from "@/components/agents/composer"
import {
  ComposerBridgeContext,
  type ComposerBridge,
} from "@/components/agents/composer-bridge"
import { BlockRenderer } from "@/components/agents/blocks/block-renderer"
import { ErrorBlock } from "@/components/agents/blocks/error-block"
import { SystemBlock } from "@/components/agents/blocks/system-block"
import { UserMessage } from "@/components/agents/user-message"
import { ProposalDrawer } from "@/components/task-detail/proposal-drawer"
import { classifyParts, type MessagePartLike } from "@/lib/agents/blocks"
import { cleanErrorText } from "@/lib/agents/providerErrors"

/**
 * The designed chat experience (slice 02): typed block renderers over the
 * component's UIMessage parts, interleaved with run-derived error/system
 * blocks (failed → error + hint, stopped → quiet system line), and the
 * run-state composer below.
 */
export function ThreadView({ threadId }: { threadId: string }) {
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
    return <ThreadViewSkeleton />
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

  // One timeline: messages by creation time + settled-run outcomes by
  // finish time, so an error/stop note lands under the run it closes.
  const timeline: { key: string; at: number; node: React.ReactNode }[] =
    messages.map((message) => ({
      key: message.key,
      at: message._creationTime,
      node: (
        <MessageRow
          message={message}
          readOnly={readOnly}
          authorName={
            authorNames && message.userId
              ? authorNames.get(message.userId)
              : undefined
          }
        />
      ),
    }))
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
        at: run.startedAt,
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
        at: run.startedAt,
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
        node: <SystemBlock>Queued background run cancelled.</SystemBlock>,
      })
    } else if (run.status === "cancelled") {
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        node: <SystemBlock>Run stopped — partial output kept.</SystemBlock>,
      })
    }
  }
  timeline.sort((a, b) => a.at - b.at)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="truncate text-sm font-medium">{thread.title}</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">
          {thread.agentName}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ComposerBridgeContext.Provider value={readOnly ? null : composerBridge}>
          <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
            {timeline.map((entry) => (
              <div key={entry.key} className="flex flex-col">
                {entry.node}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ComposerBridgeContext.Provider>
      </div>
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
        />
      )}
      {/* A proposal card's "Open" (`?draft=` / `?change=`, email-triage B7). */}
      <ProposalDrawer readOnly={readOnly} />
    </div>
  )
}

function MessageRow({
  message,
  readOnly,
  authorName,
}: {
  message: UIMessage
  readOnly: boolean
  authorName?: string
}) {
  if (message.role === "user") {
    return <UserMessage text={message.text} authorName={authorName} />
  }
  const blocks = classifyParts(message.parts as unknown as MessagePartLike[])
  if (blocks.length === 0) return null
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
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        <Skeleton className="ml-12 h-9 w-48 self-end rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <div className="border-t p-4">
        <Skeleton className="mx-auto h-24 w-full max-w-2xl rounded-lg" />
      </div>
    </div>
  )
}
