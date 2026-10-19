"use client"

import { useCallback, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useConvexAuth, useQuery } from "convex/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import { PROPOSAL_KIND_META } from "@/lib/agents/proposals"
import { formatDateToYMD } from "@/lib/format"
import { buildProposalUrl, parseProposalRef, type ProposalRef } from "@/lib/task-detail"
import { Skeleton } from "@/components/ui/skeleton"
import { DrawerShell } from "@/components/task-detail/drawer-shell"
import type { PlanNav } from "@/components/task-detail/proposal-draft-view"
import { currentSubtasksFromRows } from "@/lib/agents/proposalDrawer"
import {
  DecidedNotice,
  ProposalDrawerHeader,
  useDraftReference,
  type DraftReference,
  type ProposalDrawerFooter,
} from "@/components/task-detail/proposal-drawer-parts"

// The views (pickers, TipTap, the subtask grid) load only when a proposal opens:
// every page with the task drawer mounts this drawer, most never open one.
const ProposalDraftView = dynamic(
  () => import("@/components/task-detail/proposal-draft-view").then((m) => ({ default: m.ProposalDraftView })),
  { ssr: false, loading: () => <DrawerSkeleton /> },
)
const ProposalChangeView = dynamic(
  () => import("@/components/task-detail/proposal-change-view").then((m) => ({ default: m.ProposalChangeView })),
  { ssr: false, loading: () => <DrawerSkeleton /> },
)

export type { ProposalDrawerFooter, ProposalDrawerFooterContext } from "@/components/task-detail/proposal-drawer-parts"

export type ProposalDrawerProps = {
  /**
   * The footer (the parent decides: Triage renders Create / Apply change ·
   * Skip). Default: the cards' Discard + Approve for a non-email proposal.
   */
  footer?: ProposalDrawerFooter
  /** What the plan does not cover yet for this task ("story size"), one amber line. */
  planGaps?: (card: ProposalCard) => readonly string[]
  /** Force the inert view (e.g. the thread is read-only for the viewer). */
  readOnly?: boolean
}

const NO_GAPS: readonly string[] = []

/**
 * The task drawer on a proposal (email-triage B7, D15): `?draft=<proposalId>`
 * opens a pending `createTask` as a Draft, `?change=<proposalId>` a pending
 * `updateTask` on its task. Same chrome as the task drawer (`DrawerShell`:
 * Esc closes, focus trapped); the source decides the body. Mounted wherever
 * the task drawer is (every `TaskDetailDrawer`), and in the Agents thread
 * view, so a proposal opens from any surface by URL.
 *
 * Reader-only viewers (no write access to the proposal's thread) and
 * proposals already decided see an inert version.
 */
export function ProposalDrawer({ footer, planGaps, readOnly = false }: ProposalDrawerProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useConvexAuth()
  const ref = parseProposalRef(searchParams)
  const isOpen = ref !== null

  const navigate = useCallback(
    (target: ProposalRef | null) => {
      const current = new URLSearchParams(window.location.search)
      router.replace(`${pathname}${buildProposalUrl(current, target)}`, { scroll: false })
    },
    [pathname, router],
  )
  const close = useCallback(() => navigate(null), [navigate])

  const cards = useQuery(
    api.agentProposals.listForCards,
    isAuthenticated && ref ? { proposalIds: [ref.proposalId] } : "skip",
  )
  const card = cards === undefined ? undefined : (cards.find((c) => c._id === ref?.proposalId) ?? null)
  const plannedId =
    card && card.payload.kind === "createTask" && card.payload.grouping ? card._id : null
  const siblings = useQuery(api.agentProposals.planSiblings, isAuthenticated && plannedId ? { proposalId: plannedId } : "skip")
  const reference = useDraftReference(isOpen)

  const planIds = siblings?.proposalIds
  const planIndex = card && planIds ? planIds.indexOf(card._id) : -1
  const plan: PlanNav | null =
    planIds && planIndex !== -1 && planIds.length > 1
      ? {
          index: planIndex,
          total: planIds.length,
          onStep: (direction) => {
            const target = planIds[planIndex + (direction === "next" ? 1 : -1)]
            if (target) navigate({ kind: "draft", proposalId: target })
          },
        }
      : null
  const next = () => {
    const target = planIds && planIndex !== -1 ? planIds[planIndex + 1] : undefined
    if (target) navigate({ kind: "draft", proposalId: target })
  }

  const label = ref?.kind === "change" ? "Proposed change" : "Draft task"

  return (
    <DrawerShell isOpen={isOpen} label={label} onClose={close}>
      {card === undefined ? (
        <DrawerLoading onClose={close} />
      ) : card === null ? (
        <DrawerNotice onClose={close} text="This proposal is no longer available." />
      ) : card.payload.kind === "createTask" ? (
        // A view stays mounted when its proposal is decided meanwhile and shows
        // the decided line itself (a pending description save is then skipped).
        <ProposalDraftView
          key={card._id}
          card={card}
          payload={card.payload}
          reference={reference}
          readOnly={readOnly || !card.viewerCanWrite}
          gaps={planGaps?.(card) ?? NO_GAPS}
          plan={plan}
          footer={footer}
          onClose={close}
          onNext={next}
        />
      ) : card.payload.kind === "updateTask" ? (
        <ChangeLoader
          key={card._id}
          card={card}
          reference={reference}
          readOnly={readOnly || !card.viewerCanWrite}
          footer={footer}
          onClose={close}
        />
      ) : card.status === "approved" || card.status === "discarded" ? (
        <DecidedNotice card={card} onClose={close} />
      ) : (
        <DrawerNotice onClose={close} text={`${PROPOSAL_KIND_META[card.payload.kind].label} — review it in the conversation.`} />
      )}
    </DrawerShell>
  )
}

/** Loads the task a change proposal points at (with the viewer's access), then the change view. */
function ChangeLoader({
  card,
  reference,
  readOnly,
  footer,
  onClose,
}: {
  card: ProposalCard
  reference: DraftReference
  readOnly: boolean
  footer?: ProposalDrawerFooter
  onClose: () => void
}) {
  const payload = card.payload.kind === "updateTask" ? card.payload : null
  const [today] = useState(() => formatDateToYMD(new Date()))
  const taskId = payload?.taskId as Id<"tasks"> | undefined
  const task = useQuery(api.tasks.queries.getDetail, taskId ? { taskId, today } : "skip")
  const subtaskRows = useQuery(api.tasks.queries.subtasks, taskId && task ? { parentTaskId: taskId, today } : "skip")
  const subtasks = useMemo(() => (subtaskRows ? currentSubtasksFromRows(subtaskRows.rows) : undefined), [subtaskRows])

  if (!payload) return null
  if (task === undefined) return <DrawerLoading onClose={onClose} />
  if (task === null) return <DrawerNotice onClose={onClose} text="This task is no longer available to you." />
  return (
    <ProposalChangeView
      card={card}
      payload={payload}
      task={task}
      subtasks={subtasks}
      reference={reference}
      readOnly={readOnly}
      footer={footer}
      onClose={onClose}
      onNext={() => {}}
    />
  )
}

function DrawerLoading({ onClose }: { onClose: () => void }) {
  return (
    <>
      <ProposalDrawerHeader onClose={onClose} crumbs={null} />
      <DrawerSkeleton />
    </>
  )
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 px-12 pt-8">
      <Skeleton className="h-8 w-2/3" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="mt-4 h-4 w-1/2" />
    </div>
  )
}

function DrawerNotice({ onClose, text }: { onClose: () => void; text: string }) {
  return (
    <>
      <ProposalDrawerHeader onClose={onClose} crumbs={null} />
      <div className="flex-1 p-6 text-sm text-muted-foreground">{text}</div>
    </>
  )
}
