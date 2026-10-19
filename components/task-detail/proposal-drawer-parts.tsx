"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { ChevronRightIcon, ChevronsRightIcon } from "lucide-react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { StatusIcon as StatusIconShape } from "@/convex/tasks/model"
import type { ProposalCard } from "@/convex/agentProposals"
import type { ProposalFieldReasons } from "@/lib/agents/proposals"
import { reasonEntries } from "@/lib/agents/proposalDrawer"
import { firstName, formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import Link from "next/link"
import { ProposalFooter } from "@/components/agents/blocks/proposal-card-chrome"
import type { FlushResult } from "@/components/agents/blocks/use-proposal-decision"
import { PROPOSAL_KIND_META } from "@/lib/agents/proposals"
import { buildTaskDeepLink } from "@/lib/task-detail"

/**
 * Shared pieces of the drawer's proposal sources (email-triage B7): the
 * picker reference data, the property slot (unsure marker + "was …" line),
 * "Why these suggestions?", the plan-gap line, the header and the default
 * footer. The Draft (`proposal-draft-view.tsx`) and the proposed change
 * (`proposal-change-view.tsx`) compose them around the shared pickers.
 */

// ─── Reference data (the pickers' option lists) ─────────────────────────────

type WorkspaceRefs = NonNullable<FunctionReturnType<typeof api.workspaceRefs.get>>

export type StatusOption = { _id: Id<"statuses">; name: string; color: string; icon: StatusIconShape }

export type DraftReference = {
  /** Active statuses, in workflow order. */
  statuses: StatusOption[]
  /** What the server picks without a status (the backlog default). */
  defaultStatus: StatusOption | undefined
  categories: Array<{ _id: Id<"workCategories">; name: string; color: string }>
  projects: Array<{ _id: Id<"projects">; name: string; clientName: string; clientPrefix?: string; clientUsePrefix?: boolean }>
  members: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
  /** Lookups including archived rows (a current value may be archived). */
  statusById: ReadonlyMap<string, StatusOption>
  categoryById: ReadonlyMap<string, { name: string; color: string }>
  memberById: ReadonlyMap<string, { name: string; imageUrl?: string }>
  projectById: ReadonlyMap<string, { name: string; clientName: string }>
  clientNameById: ReadonlyMap<string, string>
  loaded: boolean
}

export const EMPTY_REFERENCE: DraftReference = {
  statuses: [],
  defaultStatus: undefined,
  categories: [],
  projects: [],
  members: [],
  statusById: new Map(),
  categoryById: new Map(),
  memberById: new Map(),
  projectById: new Map(),
  clientNameById: new Map(),
  loaded: false,
}

/** Picker lists from the workspace refs (the mapping the create form uses). */
export function draftReferenceFromRefs(refs: WorkspaceRefs): DraftReference {
  const clientById = new Map(refs.clients.map((c) => [c._id as string, c]))
  const toStatus = (s: WorkspaceRefs["statuses"][number]): StatusOption => ({ _id: s._id, name: s.name, color: s.color, icon: s.icon })
  const active = refs.statuses.filter((s) => !s.archived)
  const defaultDoc = active.find((s) => s.category === "backlog" && s.isDefault)
  const projectOf = (p: WorkspaceRefs["projects"][number]) => {
    const client = clientById.get(p.clientId)
    return {
      _id: p._id,
      name: p.name,
      clientName: client?.name ?? "",
      clientPrefix: client?.prefix ?? undefined,
      clientUsePrefix: client?.usePrefix,
    }
  }
  return {
    statuses: active.map(toStatus),
    defaultStatus: defaultDoc ? toStatus(defaultDoc) : undefined,
    categories: refs.workCategories.filter((c) => !c.archived).map((c) => ({ _id: c._id, name: c.name, color: c.color })),
    projects: refs.projects.filter((p) => !p.archived).map(projectOf),
    members: refs.members.map((m) => ({ _id: m._id, name: m.name, imageUrl: m.imageUrl ?? undefined })),
    statusById: new Map(refs.statuses.map((s) => [s._id as string, toStatus(s)])),
    categoryById: new Map(refs.workCategories.map((c) => [c._id as string, { name: c.name, color: c.color }])),
    memberById: new Map(refs.members.map((m) => [m._id as string, { name: m.name, imageUrl: m.imageUrl ?? undefined }])),
    projectById: new Map(refs.projects.map((p) => [p._id as string, projectOf(p)])),
    clientNameById: new Map(refs.clients.map((c) => [c._id as string, c.name])),
    loaded: true,
  }
}

/** The pickers' reference data — the one `workspaceRefs` query every task surface reads. */
export function useDraftReference(enabled: boolean): DraftReference {
  const { isAuthenticated } = useConvexAuth()
  const refs = useQuery(api.workspaceRefs.get, isAuthenticated && enabled ? {} : "skip")
  return useMemo(() => (refs ? draftReferenceFromRefs(refs) : EMPTY_REFERENCE), [refs])
}

/** "Anna, Bence" — or "Nobody". */
export function memberNames(reference: DraftReference, ids: readonly string[]): string {
  if (ids.length === 0) return "Nobody"
  return ids.map((id) => firstName(reference.memberById.get(id)?.name ?? "Unknown")).join(", ")
}

export function dateText(value: string | null | undefined): string {
  return value ? formatShortDate(value) : "No date"
}

// ─── Debounced commit (the description editor) ──────────────────────────────

/**
 * Debounce a save: `schedule()` (re)starts the timer, `flush()` runs a pending
 * one now (before a decision), `cancel()` drops it; a pending one also runs on
 * unmount. `commit` is read at fire time, so it sees the latest render.
 */
export function useDebouncedCommit(commit: () => void, ms: number) {
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        commitRef.current()
      }
    },
    [],
  )
  return useMemo(
    () => ({
      schedule: () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          commitRef.current()
        }, ms)
      },
      flush: () => {
        if (!timer.current) return
        clearTimeout(timer.current)
        timer.current = null
        commitRef.current()
      },
      cancel: () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
      },
    }),
    [ms],
  )
}

// ─── Property slot ──────────────────────────────────────────────────────────

/**
 * One property chip under the title: the shared picker, a small amber dot
 * when the assistant was unsure, and — for a proposed change — a quiet
 * highlight with the muted "Status was In progress" line under it.
 */
export function PropertySlot({
  unsure = false,
  highlighted = false,
  note,
  children,
}: {
  unsure?: boolean
  highlighted?: boolean
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-highlighted={highlighted || undefined}>
      <div className={cn("flex items-center gap-1 rounded-md", highlighted && "bg-accent")}>
        {children}
        {unsure ? <UnsureMarker /> : null}
      </div>
      {note ? <span className="px-0.5 text-[11px] leading-tight text-muted-foreground">{note}</span> : null}
    </div>
  )
}

/** The assistant's guess: a small amber dot (D18 "unsure"). */
export function UnsureMarker() {
  return (
    <span
      role="img"
      aria-label="The assistant isn't sure — check this"
      title="The assistant isn't sure — check this"
      className="mr-1 size-1.5 shrink-0 rounded-full bg-warning"
    />
  )
}

// ─── Why these suggestions? / plan gaps ─────────────────────────────────────

/** A quiet collapsible list of the agent's field reasons. */
export function WhySuggestions({ fieldReasons }: { fieldReasons: ProposalFieldReasons | undefined }) {
  const [open, setOpen] = useState(false)
  const entries = reasonEntries(fieldReasons)
  if (entries.length === 0) return null
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Why these suggestions?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex flex-col gap-1.5 pl-4.5 text-xs">
          {entries.map((e) => (
            <li key={e.field} className="flex items-baseline gap-2">
              <span className="w-32 shrink-0 text-muted-foreground">{e.label}</span>
              <span className="min-w-0 flex-1 text-foreground/80">
                {e.reason}
                {e.unsure ? <span className="ml-1.5 text-warning">· not sure</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** One amber line: what the plan does not cover yet ("Not covered: story size"). */
export function PlanGapsLine({ gaps }: { gaps: readonly string[] }) {
  if (gaps.length === 0) return null
  return <p className="text-xs text-warning">Not covered: {gaps.join(", ")}</p>
}

// ─── Header ─────────────────────────────────────────────────────────────────

/** The drawer header for a proposal: close · crumbs · (Task N of M stepper). */
export function ProposalDrawerHeader({
  onClose,
  crumbs,
  right,
}: {
  onClose: () => void
  crumbs: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close drawer (Esc)">
          <ChevronsRightIcon className="size-4" />
        </Button>
        <div className="h-4 w-px bg-border/50" />
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">{crumbs}</div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">{right}</div>
    </div>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

/**
 * What a parent-provided footer gets (Triage: Create / Apply change · Skip).
 *
 * Contract: before deciding, call `flush()` and decide ONLY on `{ ok: true }`,
 * with its `revision` (I11). `{ ok: false }` means a queued edit was refused
 * (stale revision, invalid value): it was toasted and the drawer was reset to
 * the server's version — the owner must look again, so do nothing.
 */
export type ProposalDrawerFooterContext = {
  card: ProposalCard
  mode: "draft" | "change"
  /** A decision is running. */
  busy: boolean
  /** The viewer may not decide (inert drawer). */
  readOnly: boolean
  /** Waits for every pending edit (the debounced description too). */
  flush: () => Promise<FlushResult>
  /** The generic approve path (flushes first; approves nothing after a refused edit). */
  approve: () => Promise<unknown>
  discard: () => void
  /** Open the next task of the plan, if any (else nothing). */
  next: () => void
  close: () => void
}

export type ProposalDrawerFooter = (ctx: ProposalDrawerFooterContext) => React.ReactNode

export type { FlushResult }

/** Unticking / reverting the last operation would leave a change that changes nothing. */
export const SKIP_INSTEAD_MESSAGE = "This is the only change — Skip it instead."

/** Pending or failed (retryable): still something to review. */
export function isLiveProposal(card: Pick<ProposalCard, "status">): boolean {
  return card.status === "pending" || card.status === "failed"
}

/** A proposal decided meanwhile (created, applied or discarded): one muted line, and the task when there is one. */
export function DecidedNotice({ card, onClose }: { card: ProposalCard; onClose: () => void }) {
  const done = card.status === "approved"
  const opensTask = done && card.committedRef && (card.payload.kind === "createTask" || card.payload.kind === "updateTask")
  return (
    <>
      <ProposalDrawerHeader onClose={onClose} crumbs={null} />
      <div className="flex flex-1 flex-col items-start gap-2 p-6 text-sm text-muted-foreground">
        <span>{done ? PROPOSAL_KIND_META[card.payload.kind].committedLabel : "Discarded"}.</span>
        {opensTask ? (
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground">
            <Link href={buildTaskDeepLink(card.committedRef!)}>Open task</Link>
          </Button>
        ) : null}
      </div>
    </>
  )
}

/**
 * The default footer for a non-email proposal: the cards' own chrome —
 * quiet Discard, one dark Approve. An email proposal is decided from Triage
 * (the server refuses the generic path), so it only says so.
 */
export function DefaultProposalFooter({ ctx }: { ctx: ProposalDrawerFooterContext }) {
  const { card, mode } = ctx
  const fromEmail = "source" in card.payload && card.payload.source?.kind === "email"
  if (ctx.readOnly) {
    return (
      <div className="flex items-center border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground/60">
        View only — the thread owner decides this.
      </div>
    )
  }
  const note = fromEmail
    ? mode === "draft"
      ? "Create this from Triage."
      : "Apply this from Triage."
    : mode === "draft"
      ? "Nothing is created until you approve."
      : "Nothing changes until you approve."
  return (
    <ProposalFooter
      failed={card.status === "failed"}
      failureReason={card.failureReason}
      note={note}
      busy={ctx.busy}
      onDiscard={ctx.discard}
      onApprove={() => {
        void ctx.approve().then((outcome) => {
          if (outcome && typeof outcome === "object" && "ok" in outcome && outcome.ok) ctx.next()
        })
      }}
      canApprove={!fromEmail}
    />
  )
}
