"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import {
  AlignLeftIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard as ProposalCardData } from "@/convex/agentProposals"
import {
  PROPOSAL_KIND_META,
  type ProposalPayload,
  type ProposedSubtask,
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
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { FailureNote, OpenInDrawerButton, ProposalFooter } from "./proposal-card-chrome"
import {
  PostCommentCard,
  ProposeSkillCard,
  UpdateTaskCard,
  subtaskLine,
} from "./proposal-change-cards"
import { useProposalDecision } from "./use-proposal-decision"

/**
 * `proposal` block (PRD Module 3 · slice 08) — a batch of write-intent
 * cards. Cards render from the LIVE proposal records, so pending cards
 * persist across thread close/reopen and decisions update in place.
 *
 * The create-task card is the app's ONE task-draft language — borderless
 * title, quiet description affordance, property pills — composed from the
 * same shared pickers as `task-form-modal.tsx` and fed by the same
 * reference queries `/tasks` uses; its proposed sub-tasks are a quiet list
 * (title · owner · due) with remove-one. The change kinds (update, comment,
 * skill) are compact summary cards (`proposal-change-cards.tsx`). Only the
 * proposal chrome is new here: per-card Approve + Discard, the sticky
 * "Approve all (N)" bar, the destructive confirm step, and the committed /
 * failed / discarded states.
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
  // Admin-scoped kinds (proposeSkill, archiveTask) show Approve to admins only.
  const isAdmin = useIsAdmin() === true

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
  const canApproveKind = (kind: ProposalPayload["kind"]) =>
    isAdmin || PROPOSAL_KIND_META[kind].approveScope !== "admin"
  const approvable = pending.filter((c) => canApproveKind(c.payload.kind))
  const batchable = approvable.filter(
    (c) => !PROPOSAL_KIND_META[c.payload.kind].destructive,
  )
  const confirmOnly = approvable.length - batchable.length
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
        <ProposalCard
          key={card._id}
          card={card}
          reference={reference}
          canApprove={canApproveKind(card.payload.kind)}
        />
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
        const needsAdmin = outcomes.filter((o) => o.result === "needs_admin").length
        if (needsAdmin > 0) {
          toast.info(
            `${needsAdmin} proposal${needsAdmin === 1 ? " needs" : "s need"} an admin — left pending`,
          )
        }
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
  canApprove,
}: {
  card: ProposalCardData
  reference: ReferenceData
  /** False for an admin-scoped kind viewed by a member: no Approve. */
  canApprove: boolean
}) {
  if (card.status === "approved") return <CommittedRow card={card} />
  if (card.status === "discarded") return <DiscardedRow card={card} />
  // pending | failed — the editable/confirmable card (failed = retryable)
  switch (card.payload.kind) {
    case "createTask":
      return (
        <CreateTaskCard
          card={card}
          payload={card.payload}
          reference={reference}
        />
      )
    case "updateTask":
      return (
        <UpdateTaskCard
          card={card}
          payload={card.payload}
          members={reference.orgMembers}
        />
      )
    case "postComment":
      return <PostCommentCard card={card} payload={card.payload} />
    case "proposeSkill":
      return (
        <ProposeSkillCard
          card={card}
          payload={card.payload}
          canApprove={canApprove}
        />
      )
    case "archiveTask":
      return (
        <ArchiveTaskCard
          card={card}
          payload={card.payload}
          canApprove={canApprove}
        />
      )
  }
}

/** One-line title for compact rows, from the effective payload. */
function payloadTitle(payload: ProposalPayload): string {
  switch (payload.kind) {
    case "createTask":
      return payload.title
    case "proposeSkill":
      return payload.name
    case "updateTask":
    case "postComment":
      return payload.taskTitle ?? "Task"
    case "archiveTask":
      return payload.taskTitle
  }
}

// ─── Create-task card (the app's task-draft language) ──────────────────────

type CreateTaskDraft = {
  title: string
  description: string
  projectId: string | undefined
  assigneeIds: string[]
  workCategoryId: string | undefined
  dueDate: string // YYYY-MM-DD or ""
  subtasks: ProposedSubtask[]
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
    subtasks: payload.subtasks ?? [],
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
  // Inline-edit state, seeded from the effective payload (edits included).
  const [draft, setDraft] = useState<CreateTaskDraft>(() =>
    draftFromPayload(payload),
  )
  const [showDescription, setShowDescription] = useState(
    Boolean(payload.description),
  )
  // Someone else changed the card: show their version.
  const { busy, save, approve, discard } = useProposalDecision(card, () =>
    setDraft(draftFromPayload(payload)),
  )

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
    subtasks: d.subtasks,
  })

  // Persist edits so they survive thread close/reopen and so Approve-all
  // commits what the human typed, not the agent's draft. Pickers persist on
  // change; the title/description persist on blur.
  const applyDraft = (patch: Partial<CreateTaskDraft>, persist: boolean) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (persist) save(toEditedPayload(next))
  }

  const onApprove = () => void approve({ editedPayload: toEditedPayload(draft) })

  return (
    <div className="rounded-lg border">
      <div className="flex items-start gap-2 px-4 pt-3">
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onBlur={() => {
            if (draft.title !== payload.title) applyDraft({}, true)
          }}
          placeholder="Task name"
          aria-label="Task title"
          disabled={busy}
          className="min-w-0 flex-1 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/40 bg-transparent"
        />
        <OpenInDrawerButton kind="draft" proposalId={card._id} />
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

      {draft.subtasks.length > 0 && (
        <ul
          aria-label="Proposed subtasks"
          className="mx-4 mt-2 flex flex-col border-t pt-1.5"
        >
          {draft.subtasks.map((sub, index) => (
            <li
              key={`${index}-${sub.title}`}
              className="flex items-center gap-2 py-0.5 text-xs"
            >
              <CircleIcon className="size-3 shrink-0 text-muted-foreground/50" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {subtaskLine(sub, reference.orgMembers)}
              </span>
              <button
                type="button"
                aria-label={`Remove subtask ${sub.title}`}
                disabled={busy}
                onClick={() =>
                  applyDraft(
                    { subtasks: draft.subtasks.filter((_, i) => i !== index) },
                    true,
                  )
                }
                className="shrink-0 rounded text-muted-foreground/50 transition-colors hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

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
      <ProposalFooter
        failed={card.status === "failed"}
        failureReason={card.failureReason}
        note={
          staleProject ? (
            <FailureNote reason="The referenced project no longer exists — pick another before approving." />
          ) : (
            "Proposed by the agent — nothing is created until you approve."
          )
        }
        busy={busy}
        onDiscard={discard}
        onApprove={onApprove}
      />
    </div>
  )
}

// ─── Archive-task card (destructive — explicit confirm step) ────────────────

function ArchiveTaskCard({
  card,
  payload,
  canApprove,
}: {
  card: ProposalCardData
  payload: Extract<ProposalPayload, { kind: "archiveTask" }>
  canApprove: boolean
}) {
  const { busy, approve, discard: onDiscard } = useProposalDecision(card)
  const [confirming, setConfirming] = useState(false)

  const onConfirm = () => {
    void approve({ confirmDestructive: true }).finally(() => setConfirming(false))
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
              {canApprove ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  {card.status === "failed" ? "Retry…" : "Archive…"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground/60">
                  An admin approves this
                </span>
              )}
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
  // committedRef is the task id for every task-bound kind except archive.
  const opensTask =
    card.payload.kind === "createTask" ||
    card.payload.kind === "updateTask" ||
    card.payload.kind === "postComment"
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
      {opensTask && card.committedRef && (
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link href={buildTaskDeepLink(card.committedRef)}>Open task</Link>
        </Button>
      )}
      {card.payload.kind === "archiveTask" && (
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
      {card.payload.kind === "createTask" || card.payload.kind === "updateTask" ? (
        <OpenInDrawerButton
          kind={card.payload.kind === "createTask" ? "draft" : "change"}
          proposalId={card._id}
        />
      ) : null}
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
