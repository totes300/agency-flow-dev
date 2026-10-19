"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import {
  AlignLeftIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard as ProposalCardData } from "@/convex/agentProposals"
import {
  PROPOSAL_KIND_META,
  type ProposalPayload,
} from "@/lib/agents/proposals"
import { buildTaskDeepLink } from "@/lib/task-detail"
import {
  formatDateToYMDOrUndefined,
  parseYMDToLocalDate,
} from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AssigneePicker,
  CategoryPicker,
  DueDatePicker,
  ProjectPicker,
  projectPickerLabel,
} from "@/components/tasks/task-property-pickers"
import { cn } from "@/lib/utils"

/**
 * `proposal` block (PRD Module 3 · slice 08) — a batch of write-intent
 * cards. Cards render from the LIVE proposal records, so pending cards
 * persist across thread close/reopen and decisions update in place.
 *
 * The create-task card is the app's ONE task-draft language — borderless
 * title, quiet description affordance, property pills — composed from the
 * same shared pickers as `task-form-modal.tsx` and fed by the same
 * reference queries `/tasks` uses. Only the proposal chrome is new here:
 * per-card Approve + Discard, the sticky "Approve all (N)" bar, the
 * destructive confirm step, and the committed / failed / discarded states.
 */
export function ProposalBlock({
  proposalIds,
  readOnly = false,
}: {
  proposalIds: string[]
  readOnly?: boolean
}) {
  const cards = useQuery(api.agentProposals.listForCards, { proposalIds })
  // Same reference data /tasks feeds its provider with (member-accessible).
  const projects = useQuery(api.projects.list, {})
  const categories = useQuery(api.workCategories.list, {})
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})

  if (cards === undefined) {
    return <ProposalBlockSkeleton count={Math.min(proposalIds.length, 3)} />
  }
  if (cards.length === 0) return null

  // Read-only (no write access to the thread, e.g. an admin auditing a
  // member's private thread): each card's outcome as a compact row — no
  // editors, no Approve/Discard, no Approve-all. The decision mutations
  // check thread write access server-side anyway; this keeps it honest.
  if (readOnly) {
    return (
      <div className="flex flex-col gap-2">
        {cards.map((card) =>
          card.status === "approved" ? (
            <CommittedRow key={card._id} card={card} />
          ) : card.status === "discarded" ? (
            <DiscardedRow key={card._id} card={card} />
          ) : (
            <ReadOnlyPendingRow key={card._id} card={card} />
          ),
        )}
      </div>
    )
  }

  const pending = cards.filter((c) => c.status === "pending")
  const batchable = pending.filter(
    (c) => !PROPOSAL_KIND_META[c.payload.kind].destructive,
  )
  const confirmOnly = pending.length - batchable.length
  const reference: ReferenceData = {
    projects: projects ?? [],
    categories: categories ?? [],
    orgMembers: orgMembers ?? [],
    projectsLoaded: projects !== undefined,
  }

  return (
    <div className="flex flex-col gap-2">
      {batchable.length > 1 && (
        <ApproveAllBar
          threadId={cards[0].threadId}
          items={batchable.map((c) => ({
            proposalId: c._id,
            revision: c.revision,
          }))}
          confirmOnly={confirmOnly}
        />
      )}
      {cards.map((card) => (
        <ProposalCard key={card._id} card={card} reference={reference} />
      ))}
    </div>
  )
}

/** The option lists the task-draft pickers need (shape of /tasks' data). */
type ReferenceData = {
  projects: Array<{
    _id: Id<"projects">
    name: string
    clientName: string
    clientPrefix?: string
    clientUsePrefix?: boolean
  }>
  categories: Array<{ _id: Id<"workCategories">; name: string; color: string }>
  orgMembers: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
  /** Distinguishes "project list still loading" from "project is gone". */
  projectsLoaded: boolean
}

// ─── Approve all (sticky above the batch) ───────────────────────────────────

function ApproveAllBar({
  threadId,
  items,
  confirmOnly,
}: {
  threadId: string
  /** The rendered cards + their revisions — only these are approved (I11). */
  items: Array<{ proposalId: string; revision: number }>
  confirmOnly: number
}) {
  const approveAll = useMutation(api.agentProposals.approveAll)
  const [busy, setBusy] = useState(false)
  const count = items.length

  const onApproveAll = () => {
    setBusy(true)
    approveAll({ threadId, items })
      .then((outcomes) => {
        const approved = outcomes.filter((o) => o.result === "approved").length
        const failed = outcomes.filter((o) => o.result === "failed").length
        if (failed > 0) {
          toast.warning(
            `${approved} approved · ${failed} failed — see the cards for details`,
          )
        } else if (approved > 0) {
          toast.success(
            `${approved} proposal${approved === 1 ? "" : "s"} approved`,
          )
        }
      })
      .catch((err) => toastError(err, "Failed to approve proposals"))
      .finally(() => setBusy(false))
  }

  return (
    <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 rounded-md bg-background/95 px-1 py-1.5 backdrop-blur-sm">
      <span className="text-xs text-muted-foreground">
        {count} pending
        {confirmOnly > 0 &&
          ` · ${confirmOnly} destructive — confirm individually`}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7"
        disabled={busy}
        onClick={onApproveAll}
      >
        Approve all ({count})
      </Button>
    </div>
  )
}

// ─── Card dispatch ──────────────────────────────────────────────────────────

function ProposalCard({
  card,
  reference,
}: {
  card: ProposalCardData
  reference: ReferenceData
}) {
  if (card.status === "approved") return <CommittedRow card={card} />
  if (card.status === "discarded") return <DiscardedRow card={card} />
  // pending | failed — the editable/confirmable card (failed = retryable)
  if (card.payload.kind === "createTask") {
    return (
      <CreateTaskCard
        card={card}
        payload={card.payload}
        reference={reference}
      />
    )
  }
  return <ArchiveTaskCard card={card} payload={card.payload} />
}

/** One-line title for compact rows, from the effective payload. */
function payloadTitle(payload: ProposalPayload): string {
  return payload.kind === "createTask" ? payload.title : payload.taskTitle
}

// ─── Create-task card (the app's task-draft language) ──────────────────────

type CreateTaskDraft = {
  title: string
  description: string
  projectId: string | undefined
  assigneeIds: string[]
  workCategoryId: string | undefined
  dueDate: string // YYYY-MM-DD or ""
}

function draftFromPayload(
  payload: Extract<ProposalPayload, { kind: "createTask" }>,
): CreateTaskDraft {
  return {
    title: payload.title,
    description: payload.description ?? "",
    projectId: payload.projectId,
    assigneeIds: payload.assigneeIds ?? [],
    workCategoryId: payload.workCategoryId,
    dueDate: payload.dueDate ?? "",
  }
}

function CreateTaskCard({
  card,
  payload,
  reference,
}: {
  card: ProposalCardData
  payload: Extract<ProposalPayload, { kind: "createTask" }>
  reference: ReferenceData
}) {
  const approve = useMutation(api.agentProposals.approve)
  const discard = useMutation(api.agentProposals.discard)
  const updateDraft = useMutation(api.agentProposals.updateDraft)
  const [busy, setBusy] = useState(false)
  // Inline-edit state, seeded from the effective payload (edits included).
  const [draft, setDraft] = useState<CreateTaskDraft>(() =>
    draftFromPayload(payload),
  )
  const [showDescription, setShowDescription] = useState(
    Boolean(payload.description),
  )

  // I11: the revision the on-screen draft reflects — what saves and approve
  // send back. Own saves run one at a time (each on the previous one's
  // revision); a refused one toasts "This changed — review it again."
  const [baseRevision, setBaseRevision] = useState(card.revision)
  const [savesInFlight, setSavesInFlight] = useState(0)
  const baseRef = useRef(card.revision)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    baseRef.current = baseRevision
  }, [baseRevision])

  // Someone else changed the card (another admin's edit, the agent revising
  // its plan): show their version, so what is on screen is what approve
  // commits.
  if (card.revision > baseRevision && savesInFlight === 0) {
    setBaseRevision(card.revision)
    setDraft(draftFromPayload(payload))
  }

  // Resolved display values (client-side, same lists /tasks uses)
  const selectedProject = reference.projects.find(
    (p) => p._id === draft.projectId,
  )
  const selectedCategory = reference.categories.find(
    (c) => c._id === draft.workCategoryId,
  )
  const selectedAssignees = reference.orgMembers.filter((m) =>
    draft.assigneeIds.includes(m._id),
  )
  const staleProject =
    reference.projectsLoaded && Boolean(draft.projectId) && !selectedProject

  /** Wire shape of the current draft; "" / [] clear a field server-side. */
  const toEditedPayload = (d: CreateTaskDraft) => ({
    kind: "createTask" as const,
    title: d.title,
    description: d.description,
    projectId: d.projectId ?? "",
    assigneeIds: d.assigneeIds,
    workCategoryId: d.workCategoryId ?? "",
    dueDate: d.dueDate,
  })

  // Persist edits so they survive thread close/reopen and so Approve-all
  // commits what the human typed, not the agent's draft. Pickers persist on
  // change; the title/description persist on blur.
  const applyDraft = (patch: Partial<CreateTaskDraft>, persist: boolean) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (persist) {
      setSavesInFlight((n) => n + 1)
      saveChain.current = saveChain.current
        .then(() =>
          updateDraft({
            proposalId: card._id,
            editedPayload: toEditedPayload(next),
            revision: baseRef.current,
          }),
        )
        .then(({ revision }) => {
          baseRef.current = revision
          setBaseRevision(revision)
        })
        .catch((err) => toastError(err, "Failed to save edit"))
        .finally(() => setSavesInFlight((n) => n - 1))
    }
  }

  const onApprove = () => {
    setBusy(true)
    // After any pending save, so the revision sent is the one on screen.
    saveChain.current
      .then(() =>
        approve({
          proposalId: card._id,
          revision: baseRef.current,
          editedPayload: toEditedPayload(draft),
        }),
      )
      // A stale reference flips the card to its inline failed state
      // reactively; an outdated revision toasts "This changed — review it
      // again." and the card shows the new version.
      .catch((err) => toastError(err, "Failed to approve proposal"))
      .finally(() => setBusy(false))
  }

  const onDiscard = () => {
    setBusy(true)
    discard({ proposalId: card._id })
      .catch((err) => toastError(err, "Failed to discard proposal"))
      .finally(() => setBusy(false))
  }

  return (
    <div className="rounded-lg border">
      <div className="px-4 pt-3">
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={() => {
            if (draft.title !== payload.title) applyDraft({}, true)
          }}
          placeholder="Task name"
          aria-label="Task title"
          disabled={busy}
          className="w-full text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/40 bg-transparent"
        />
      </div>

      <div className="px-4 pt-1.5">
        {showDescription ? (
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
            onBlur={() => {
              if (draft.description !== (payload.description ?? "")) {
                applyDraft({}, true)
              }
            }}
            placeholder="Add description..."
            aria-label="Task description"
            disabled={busy}
            rows={1}
            className="field-sizing-content max-h-40 w-full resize-none bg-transparent text-xs leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/40"
          />
        ) : (
          <button
            onClick={() => setShowDescription(true)}
            className="flex items-center gap-2 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          >
            <AlignLeftIcon className="size-3.5" />
            Add description
          </button>
        )}
      </div>

      {/* Property pills — the shared task-draft pickers */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pt-2">
        <ProjectPicker
          projects={reference.projects}
          value={draft.projectId as Id<"projects"> | undefined}
          onChange={(id) => applyDraft({ projectId: id }, true)}
          selectedLabel={
            selectedProject ? projectPickerLabel(selectedProject) : undefined
          }
        />
        <AssigneePicker
          members={reference.orgMembers}
          value={draft.assigneeIds as Id<"users">[]}
          onChange={(ids) => applyDraft({ assigneeIds: ids }, true)}
          selected={selectedAssignees}
        />
        <CategoryPicker
          categories={reference.categories}
          value={draft.workCategoryId as Id<"workCategories"> | undefined}
          onChange={(id) => applyDraft({ workCategoryId: id }, true)}
          selected={selectedCategory}
        />
        <DueDatePicker
          value={parseYMDToLocalDate(draft.dueDate || undefined)}
          onChange={(date) =>
            applyDraft({ dueDate: formatDateToYMDOrUndefined(date) ?? "" }, true)
          }
        />
      </div>

      {/* Proposal chrome: failure state + decision actions */}
      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
        {card.status === "failed" && card.failureReason ? (
          <FailureNote reason={card.failureReason} />
        ) : staleProject ? (
          <FailureNote reason="The referenced project no longer exists — pick another before approving." />
        ) : (
          <span className="text-xs text-muted-foreground/60">
            Proposed by the agent — nothing is created until you approve.
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-muted-foreground"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button size="sm" className="h-7" disabled={busy} onClick={onApprove}>
            {card.status === "failed" ? "Retry" : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Archive-task card (destructive — explicit confirm step) ────────────────

function ArchiveTaskCard({
  card,
  payload,
}: {
  card: ProposalCardData
  payload: Extract<ProposalPayload, { kind: "archiveTask" }>
}) {
  const approve = useMutation(api.agentProposals.approve)
  const discard = useMutation(api.agentProposals.discard)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const onConfirm = () => {
    setBusy(true)
    approve({
      proposalId: card._id,
      revision: card.revision,
      confirmDestructive: true,
    })
      .catch((err) => toastError(err, "Failed to approve proposal"))
      .finally(() => {
        setBusy(false)
        setConfirming(false)
      })
  }

  const onDiscard = () => {
    setBusy(true)
    discard({ proposalId: card._id })
      .catch((err) => toastError(err, "Failed to discard proposal"))
      .finally(() => setBusy(false))
  }

  return (
    <div className="rounded-lg border px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Archive task
        </span>
        <span className="text-xs text-destructive">· destructive</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {payload.taskTitle || "(untitled task)"}
        </span>
        <div className="flex items-center gap-1.5">
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-muted-foreground"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7"
                disabled={busy}
                onClick={onConfirm}
              >
                Confirm archive
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-muted-foreground"
                disabled={busy}
                onClick={onDiscard}
              >
                Discard
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                {card.status === "failed" ? "Retry…" : "Archive…"}
              </Button>
            </>
          )}
        </div>
      </div>
      {card.status === "failed" && card.failureReason && (
        <div className="mt-2">
          <FailureNote reason={card.failureReason} />
        </div>
      )}
    </div>
  )
}

// ─── Settled rows (compact) ─────────────────────────────────────────────────

function CommittedRow({ card }: { card: ProposalCardData }) {
  const meta = PROPOSAL_KIND_META[card.payload.kind]
  const isCreate = card.payload.kind === "createTask"
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <CheckCircle2Icon
        className={cn(
          "size-4 shrink-0",
          isCreate ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="text-xs text-muted-foreground">{meta.committedLabel}</span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {payloadTitle(card.payload)}
      </span>
      {isCreate && card.committedRef && (
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link href={buildTaskDeepLink(card.committedRef)}>Open task</Link>
        </Button>
      )}
      {!isCreate && (
        <ArchiveIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </div>
  )
}

/** Compact, inert row for a pending/failed proposal in the audit read-only view. */
function ReadOnlyPendingRow({ card }: { card: ProposalCardData }) {
  const meta = PROPOSAL_KIND_META[card.payload.kind]
  const failed = card.status === "failed"
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      {failed ? (
        <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
      ) : (
        <AlignLeftIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="text-xs text-muted-foreground">
        {failed ? "Failed" : `${meta.label} · pending`}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {payloadTitle(card.payload)}
      </span>
    </div>
  )
}

function DiscardedRow({ card }: { card: ProposalCardData }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
      <XIcon className="size-4 shrink-0" />
      <span className="text-xs">Discarded</span>
      <span className="min-w-0 flex-1 truncate text-sm line-through">
        {payloadTitle(card.payload)}
      </span>
    </div>
  )
}

function FailureNote({ reason }: { reason: string }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-xs text-destructive">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{reason}</span>
    </div>
  )
}

/** Content-aware: title line, pill row, footer actions — per card. */
function ProposalBlockSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border">
          <div className="px-4 pt-3">
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex items-center gap-1.5 px-4 pb-3 pt-3">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="flex items-center justify-end gap-1.5 border-t bg-muted/30 px-4 py-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
