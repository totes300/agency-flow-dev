"use client"

import { useEffect, useRef } from "react"
import { useQuery } from "convex/react"
import { useUIMessages } from "@convex-dev/agent/react"
import type { UIMessage } from "@convex-dev/agent/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { ThreadComposer } from "@/components/agents/thread-composer"
import { BlockRenderer } from "@/components/agents/blocks/block-renderer"
import { ErrorBlock } from "@/components/agents/blocks/error-block"
import { SystemBlock } from "@/components/agents/blocks/system-block"
import { classifyParts, type MessagePartLike } from "@/lib/agents/blocks"

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

  // One timeline: messages by creation time + settled-run outcomes by
  // finish time, so an error/stop note lands under the run it closes.
  const timeline: { key: string; at: number; node: React.ReactNode }[] =
    messages.map((message) => ({
      key: message.key,
      at: message._creationTime,
      node: <MessageRow message={message} />,
    }))
  for (const run of runs ?? []) {
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
      timeline.push({
        key: run._id,
        at: run.finishedAt,
        node: <ErrorBlock message={run.error} hint={run.errorHint} />,
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
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
          {timeline.map((entry) => (
            <div key={entry.key} className="flex flex-col">
              {entry.node}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <ThreadComposer
        threadId={threadId}
        agentName={thread.agentName}
        isRunning={thread.status === "running"}
        activeRun={thread.activeRun}
      />
    </div>
  )
}

function MessageRow({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-12 self-end whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed">
        {message.text}
      </div>
    )
  }
  const blocks = classifyParts(message.parts as unknown as MessagePartLike[])
  if (blocks.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
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
