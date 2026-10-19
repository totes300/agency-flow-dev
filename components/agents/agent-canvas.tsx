"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import {
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SheetGrid } from "@/components/agents/sheet/sheet-grid"
import { useAgentCanvas } from "@/lib/hooks/use-agent-canvas"
import { agentTableToCsv } from "@/lib/agents/table-csv"
import { downloadCsv } from "@/lib/download"
import { slugify } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The docked right canvas (PRD slice 06 · Module 5). A flex-sibling of the
 * chat that renders an artifact as a full sheet. Deliberately diverges from
 * the inbox choreography: it does NOT collapse the rail (the rail is primary
 * nav here) — it narrows the chat instead. Open/expand state lives in the URL
 * (`useAgentCanvas`); auto-opens on the first artifact of a run, manual after.
 */
export function AgentCanvas() {
  const searchParams = useSearchParams()
  const threadId = searchParams.get("thread")
  const { artifactId } = useAgentCanvas()

  return (
    <>
      {/* Keyed by thread so the auto-open bookkeeping resets per conversation. */}
      {threadId ? <CanvasAutoOpen key={threadId} threadId={threadId} /> : null}
      {artifactId ? <CanvasPanel artifactId={artifactId} /> : null}
    </>
  )
}

/**
 * Watches a thread's artifacts and opens the FIRST freshly-produced one once
 * (US 34: canvas auto-opens on the first artifact of a run, manual after).
 * Renders nothing. Seeds "seen" with whatever exists on arrival so revisiting
 * a thread never auto-opens an old artifact.
 */
function CanvasAutoOpen({ threadId }: { threadId: string }) {
  const { artifactId, openArtifact } = useAgentCanvas()
  const artifacts = useQuery(api.agentArtifacts.listByThread, { threadId })

  const seenRef = useRef<Set<string> | null>(null)
  const autoOpenedRef = useRef(false)

  useEffect(() => {
    if (!artifacts) return
    if (seenRef.current === null) {
      seenRef.current = new Set(artifacts.map((a) => a._id))
      return
    }
    if (autoOpenedRef.current) return
    const fresh = artifacts.find((a) => !seenRef.current!.has(a._id))
    if (!fresh) return
    seenRef.current.add(fresh._id)
    autoOpenedRef.current = true
    // Don't yank focus off an artifact the user opened manually. `artifactId`
    // is a dependency; the autoOpenedRef guard keeps that re-run a no-op.
    if (!artifactId) openArtifact(fresh._id)
  }, [artifacts, artifactId, openArtifact])

  return null
}

function CanvasPanel({ artifactId }: { artifactId: string }) {
  const { isExpanded, closeCanvas, setExpanded } = useAgentCanvas()
  const artifact = useQuery(api.agentArtifacts.getForCanvas, { artifactId })

  // Esc closes the canvas; the chat stays live underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCanvas()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeCanvas])

  function handleExport() {
    if (!artifact) return
    // Derived here from the same sheet the grid renders, using the same format
    // helpers → the download matches the grid cell-for-cell (BOM + injection
    // guard applied inside agentTableToCsv).
    const csv = agentTableToCsv(artifact.table)
    downloadCsv(csv, `${slugify(artifact.name) || "timesheet"}.csv`)
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-l bg-background",
        // Desktop: docked ~520px, Expand widens it. Mobile: full-screen sheet.
        "max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full",
        isExpanded ? "md:w-[55vw] md:max-w-[900px]" : "md:w-[520px]",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {artifact?.name ?? "Artifact"}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={!artifact}
        >
          <DownloadIcon className="size-4" />
          Export CSV
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => setExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse canvas" : "Expand canvas"}
        >
          {isExpanded ? (
            <Minimize2Icon className="size-4" />
          ) : (
            <Maximize2Icon className="size-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={closeCanvas}
          aria-label="Close canvas"
        >
          <XIcon className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {artifact === undefined ? (
          <div className="p-4">
            <CanvasSkeleton />
          </div>
        ) : artifact === null ? (
          <CanvasEmpty />
        ) : (
          // The sheet sits flush in the panel and owns its scroll container,
          // so the sticky header/footer and frozen column work (slice-06 v2).
          <SheetGrid variant="canvas" table={artifact.table} />
        )}
      </div>
    </aside>
  )
}

/** Content-aware: a sheet header row + several data rows. */
function CanvasSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: 5 }).map((_, c) => (
            <Skeleton key={c} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

function CanvasEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
      This artifact is no longer available.
    </div>
  )
}
