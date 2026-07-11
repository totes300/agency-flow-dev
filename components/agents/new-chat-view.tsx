"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAction, useMutation, useQuery } from "convex/react"
import { BotIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { AgentComposer } from "@/components/agents/composer"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"
import { toastError } from "@/lib/toast-helpers"

/**
 * New-chat state (`?agent=` without a thread): the selected agent's
 * identity + clickable example-prompt chips that pre-fill the composer.
 * The thread record is only created on the first send — clicking around
 * agents in the rail never litters the Recent list with empty threads.
 */
export function NewChatView({ agentId }: { agentId: string }) {
  const router = useRouter()
  const agent = useQuery(api.agents.get, { agentId })
  const createThread = useMutation(api.agentThreads.create)
  const startRun = useAction(api.agentRunner.startRun)

  const [draft, setDraft] = useState("")
  const [starting, setStarting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (agent === undefined) return <NewChatViewSkeleton />
  // Stale/foreign ?agent= URL — degrade to the generic workspace state.
  if (agent === null) return <WorkspaceEmptyState />

  function send() {
    if (agent === null || agent === undefined) return
    const text = draft.trim()
    if (!text || starting) return
    setStarting(true)
    void createThread({ agentId: agent._id })
      .then((threadId) => {
        // Fire the run, then jump into the thread — post-start failures
        // surface there as error blocks, so no catch-toast needed beyond
        // pre-start validation.
        void startRun({ threadId, message: text }).catch((err) =>
          toastError(err, "The agent run failed"),
        )
        router.push(`/agents?thread=${threadId}`)
      })
      .catch((err) => {
        toastError(err, "Couldn't start the chat")
        setStarting(false)
      })
  }

  function pickPrompt(prompt: string) {
    setDraft(prompt)
    textareaRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="truncate text-sm font-medium">New chat</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">
          {agent.name}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <EmptyState
          icon={BotIcon}
          title={agent.name}
          description={agent.description}
          action={
            agent.examplePrompts.length > 0 ? (
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {agent.examplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => pickPrompt(prompt)}
                    className="rounded-lg bg-muted/60 px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>
      <AgentComposer
        agentName={agent.name}
        value={draft}
        onChange={setDraft}
        onSend={send}
        running={starting}
        stopDisabled
        textareaRef={textareaRef}
      />
    </div>
  )
}

/** Content-aware: identity circle + text lines + chip row + composer box. */
function NewChatViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
      </div>
      <div className="border-t p-4">
        <Skeleton className="mx-auto h-24 w-full max-w-2xl rounded-lg" />
      </div>
    </div>
  )
}
