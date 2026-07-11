"use client"

import { useEffect, useRef } from "react"
import { useQuery } from "convex/react"
import { useUIMessages, useSmoothText } from "@convex-dev/agent/react"
import type { UIMessage } from "@convex-dev/agent/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { ThreadComposer } from "@/components/agents/thread-composer"
import { cn } from "@/lib/utils"

/**
 * Tracer-scale thread view: raw-text message stream + bare composer.
 * Typed block renderers (reasoning, tool rows, tables, proposals) arrive
 * in slice 02+ — this exists to prove the reactive streaming spine.
 */
export function ThreadView({ threadId }: { threadId: string }) {
  const thread = useQuery(api.agentThreads.get, { threadId })
  const { results: messages, status: loadStatus } = useUIMessages(
    api.agentThreads.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  )

  // Pin the stream to the bottom while messages arrive/grow.
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastMessage = messages.at(-1)
  const streamSignature = `${messages.length}:${lastMessage?.text.length ?? 0}`
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [streamSignature])

  if (thread === undefined || loadStatus === "LoadingFirstPage") {
    return <ThreadViewSkeleton />
  }

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
          {messages.map((message) => (
            <MessageRow key={message.key} message={message} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <ThreadComposer
        threadId={threadId}
        agentName={thread.agentName}
        isRunning={thread.status === "running"}
      />
    </div>
  )
}

function MessageRow({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const [visibleText] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  })
  // Raw text only at tracer scale; system/tool parts render in slice 02+.
  if (!message.text && !isUser) return null
  return (
    <div
      className={cn(
        "whitespace-pre-wrap text-sm leading-relaxed",
        isUser
          ? "ml-12 self-end rounded-lg bg-muted px-3 py-2"
          : "text-foreground",
      )}
    >
      {isUser ? message.text : visibleText}
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
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-20 w-full max-w-2xl rounded-lg mx-auto" />
      </div>
    </div>
  )
}
