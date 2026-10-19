"use client"

import type { ReactNode } from "react"
import { useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import { PRIORITY_LABELS, isTaskPriority } from "@/convex/tasks/model"
import type {
  PostCommentPayload,
  ProposeSkillPayload,
  ProposedSubtask,
  UpdateTaskPayload,
} from "@/lib/agents/proposals"
import { parseMentionText } from "@/lib/agents/composer"
import { firstName, formatShortDate } from "@/lib/format"
import { OpenInDrawerButton, ProposalFooter } from "./proposal-card-chrome"
import { useConversationSurface } from "./conversation-surface"
import { useProposalDecision } from "./use-proposal-decision"

/**
 * Compact summary cards for the change kinds (email-triage A4): an
 * `updateTask` lists what changes (before → after where the current value is
 * known), a `postComment` shows the comment, a `proposeSkill` shows the
 * instruction and the evidence behind it. Each ends in the shared footer —
 * quiet Discard, one dark Approve. The full editable review lives in the task
 * drawer (B7 / D1: the Update card's "Open"); these cards only decide.
 */

type Member = { _id: Id<"users">; name: string }

/** "Anna, Bence" — first names of the given ids, from the member list. */
function memberNames(members: readonly Member[], ids: readonly string[]): string {
  if (ids.length === 0) return "Nobody"
  return ids
    .map((id) => {
      const member = members.find((m) => m._id === id)
      return member ? firstName(member.name) : "Unknown"
    })
    .join(", ")
}

function dateLabel(value: string | null | undefined): string {
  return value ? formatShortDate(value) : "None"
}

/** "Fix header · Bence · Oct 22" — the quiet sub-task line. */
export function subtaskLine(sub: ProposedSubtask, members: readonly Member[]): string {
  return [
    sub.title,
    sub.assigneeIds.length > 0 ? memberNames(members, sub.assigneeIds) : null,
    sub.dueDate ? formatShortDate(sub.dueDate) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function CardHeader({ label, title, action }: { label: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 px-4 pt-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      {action}
    </div>
  )
}

/** One "label · before → after" line. */
function ChangeRow({
  label,
  before,
  after,
}: {
  label: string
  before?: string | null
  after: ReactNode
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {before !== undefined && before !== null && (
          <>
            <span className="text-muted-foreground">{before}</span>
            <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/60" />
          </>
        )}
        <span className="min-w-0 text-foreground">{after}</span>
      </span>
    </>
  )
}

// ─── updateTask ──────────────────────────────────────────────────────────────

export function UpdateTaskCard({
  card,
  payload,
  members,
}: {
  card: ProposalCard
  payload: UpdateTaskPayload
  members: readonly Member[]
}) {
  const { busy, approve, discard } = useProposalDecision(card)
  const fromEmail = payload.source?.kind === "email"
  const inTriage = useConversationSurface() === "triage"
  const failedNote = card.status === "failed" && card.failureReason ? card.failureReason : null
  // The current values (before) and the names behind ids — the same
  // reactive queries the task surfaces read, with the viewer's access.
  const task = useQuery(api.tasks.queries.getDetail, {
    taskId: payload.taskId as Id<"tasks">,
  })
  const refs = useQuery(api.workspaceRefs.get, {})
  const statusName = (id: string | null | undefined) =>
    refs?.statuses.find((s) => s._id === id)?.name ?? (id ? "Unknown status" : "None")
  const categoryName = (id: string | null | undefined) =>
    id ? (refs?.workCategories.find((c) => c._id === id)?.name ?? "Unknown") : "None"
  const priorityName = (p: number | undefined) =>
    p !== undefined && isTaskPriority(p) ? PRIORITY_LABELS[p] : "None"

  const c = payload.changes ?? {}
  const subs = payload.subtasks ?? {}
  const known = task ?? undefined
  const rows: ReactNode[] = []
  if (c.title !== undefined) {
    rows.push(<ChangeRow key="title" label="Title" before={known?.title} after={c.title} />)
  }
  if (c.statusId !== undefined) {
    rows.push(
      <ChangeRow
        key="status"
        label="Status"
        before={known ? statusName(known.statusId) : undefined}
        after={statusName(c.statusId)}
      />,
    )
  }
  if (c.assigneeIds !== undefined) {
    rows.push(
      <ChangeRow
        key="assignees"
        label="Assignees"
        before={known ? memberNames(members, known.assigneeIds) : undefined}
        after={memberNames(members, c.assigneeIds)}
      />,
    )
  }
  if (c.priority !== undefined) {
    rows.push(
      <ChangeRow
        key="priority"
        label="Priority"
        before={known ? priorityName(known.priority) : undefined}
        after={priorityName(c.priority)}
      />,
    )
  }
  if (c.dueDate !== undefined) {
    rows.push(
      <ChangeRow
        key="due"
        label="Due"
        before={known ? dateLabel(known.dueDate) : undefined}
        after={dateLabel(c.dueDate)}
      />,
    )
  }
  if (c.workCategoryId !== undefined) {
    rows.push(
      <ChangeRow
        key="category"
        label="Category"
        before={known ? categoryName(known.workCategoryId) : undefined}
        after={categoryName(c.workCategoryId)}
      />,
    )
  }
  if (c.descriptionJson !== undefined) {
    rows.push(<ChangeRow key="description" label="Description" after="Rewritten" />)
  }
  for (const [i, sub] of (subs.add ?? []).entries()) {
    rows.push(<ChangeRow key={`add-${i}`} label="New subtask" after={subtaskLine(sub, members)} />)
  }
  for (const a of subs.amend ?? []) {
    const parts = [
      a.title !== undefined ? `“${a.title}”` : null,
      a.assigneeIds !== undefined ? memberNames(members, a.assigneeIds) : null,
      a.dueDate !== undefined ? `due ${dateLabel(a.dueDate)}` : null,
    ].filter(Boolean)
    rows.push(
      <ChangeRow
        key={`amend-${a.subtaskId}`}
        label="Subtask"
        before={a.subtaskTitle ?? "Subtask"}
        after={parts.join(" · ")}
      />,
    )
  }
  for (const t of subs.tick ?? []) {
    rows.push(<ChangeRow key={`tick-${t.subtaskId}`} label="Done" after={t.subtaskTitle ?? "Subtask"} />)
  }
  for (const x of subs.cancel ?? []) {
    rows.push(
      <ChangeRow
        key={`cancel-${x.subtaskId}`}
        label="Cancel"
        after={[x.subtaskTitle ?? "Subtask", x.reason].filter(Boolean).join(" — ")}
      />,
    )
  }
  if (payload.reopen) {
    rows.push(
      <ChangeRow
        key="reopen"
        label="Reopen"
        after={`${statusName(payload.reopen.statusId)} if in review or done`}
      />,
    )
  }

  return (
    <div className="rounded-lg border">
      <CardHeader
        label="Update"
        title={known?.title ?? payload.taskTitle ?? "Task"}
        action={task === null ? undefined : <OpenInDrawerButton kind="change" proposalId={card._id} />}
      />
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 pb-3 pt-2 text-xs">
        {rows}
      </div>
      {fromEmail ? (
        // A change from a client email is decided in Triage (Apply change ·
        // Not a change, B8b) — the server refuses the generic approve. Inside
        // Triage the decision sits right below, so only a failure is said.
        failedNote || !inTriage ? (
          <div className="flex items-center border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground/60">
            {failedNote ?? "Apply it from Triage."}
          </div>
        ) : null
      ) : (
        <ProposalFooter
          failed={card.status === "failed"}
          failureReason={card.failureReason}
          note={task === null ? "This task is no longer available to you." : "Nothing changes until you approve."}
          busy={busy}
          onDiscard={discard}
          onApprove={() => void approve()}
        />
      )}
    </div>
  )
}

// ─── postComment ─────────────────────────────────────────────────────────────

/** The body with `@[Name](user:id)` tokens shown as "@Name". */
function CommentBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parseMentionText(body).map((segment, i) =>
        segment.kind === "mention" ? (
          <span key={i} className="mention rounded px-1 py-0.5 text-[12px] font-medium">
            @{segment.label}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  )
}

export function PostCommentCard({
  card,
  payload,
}: {
  card: ProposalCard
  payload: PostCommentPayload
}) {
  const { busy, approve, discard } = useProposalDecision(card)
  return (
    <div className="rounded-lg border">
      <CardHeader label="Comment on" title={payload.taskTitle ?? "Task"} />
      <div className="px-4 pb-3 pt-1.5">
        <CommentBody body={payload.body} />
      </div>
      <ProposalFooter
        failed={card.status === "failed"}
        failureReason={card.failureReason}
        note="Posted as you when you approve."
        busy={busy}
        onDiscard={discard}
        onApprove={() => void approve()}
      />
    </div>
  )
}

// ─── proposeSkill ────────────────────────────────────────────────────────────

export function ProposeSkillCard({
  card,
  payload,
  canApprove,
}: {
  card: ProposalCard
  payload: ProposeSkillPayload
  /** Skills are admin-approved; members see the card without Approve. */
  canApprove: boolean
}) {
  const { busy, approve, discard } = useProposalDecision(card)
  const refs = useQuery(api.workspaceRefs.get, payload.clientId ? {} : "skip")
  const clientName = payload.clientId
    ? (refs?.clients.find((c) => c._id === payload.clientId)?.name ?? "a client")
    : null
  return (
    <div className="rounded-lg border">
      <CardHeader label={clientName ? `Skill for ${clientName}` : "Skill"} title={payload.name} />
      <div className="flex flex-col gap-2 px-4 pb-3 pt-1.5">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {payload.instruction}
        </p>
        {payload.evidence.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground/60">Why</span>
            <ul className="flex flex-col gap-0.5 border-l pl-2.5 text-xs text-muted-foreground">
              {payload.evidence.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ProposalFooter
        failed={card.status === "failed"}
        failureReason={card.failureReason}
        note="An admin approves skills."
        busy={busy}
        onDiscard={discard}
        onApprove={() => void approve()}
        canApprove={canApprove}
      />
    </div>
  )
}
