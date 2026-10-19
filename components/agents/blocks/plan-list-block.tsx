"use client"

import { useQuery } from "convex/react"
import { CheckIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import type { CreateTaskPayload, ProposalPayload } from "@/lib/agents/proposals"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import { firstName, formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/user-avatar"
import { useOpenProposal } from "@/components/task-detail/use-open-proposal"
import { FailureNote } from "./proposal-card-chrome"
import { useOpenWidgetTask } from "./use-open-task"

type Member = { _id: Id<"users">; name: string; imageUrl?: string }
type Category = { _id: Id<"workCategories">; name: string }

type CreateCard = ProposalCard & { payload: CreateTaskPayload }

/**
 * An email-sourced `createTask` proposal — a Triage plan task (B6a). These
 * render as the plan list, never as the generic editable card: they are
 * created through Triage's Create (convex/email/create.ts), not Approve.
 */
export function isPlanCard(card: ProposalCard): card is CreateCard {
  return isEmailCreatePayload(card.payload)
}

function isEmailCreatePayload(payload: ProposalPayload): payload is CreateTaskPayload {
  return payload.kind === "createTask" && payload.source?.kind === "email"
}

/**
 * The plan list (email-triage B8a; PRD §7.1 "plan list", D13): per task a
 * bold title that opens the Draft drawer (`?draft=`), with category · owner ·
 * due right-aligned, then the subtasks as a quiet aligned table — # ·
 * subtask (the full self-explaining title, wrapping) · owner (avatar + first
 * name) · due — thin row dividers, a muted header, no cell boxes. A missing
 * value shows "open" in amber; the plan's ledger gaps show as one amber line.
 *
 * Live: the cards come from `agentProposals.listForCards` (the owner's edits
 * and revisions included), the gaps from `agentWidgets.planGaps`. A
 * subtask without its own owner / due inherits the task's (createTask
 * semantics); "open" means neither has one.
 */
export function PlanListBlock({
  cards,
  members,
  categories,
}: {
  cards: readonly CreateCard[]
  members: readonly Member[]
  categories: readonly Category[]
}) {
  const gaps = useQuery(api.agentWidgets.planGaps, { proposalIds: cards.map((c) => c._id) })
  const hasPending = cards.some((c) => c.status === "pending" || c.status === "failed")

  return (
    <div className="flex flex-col gap-5">
      {cards.map((card) =>
        card.status === "approved" ? (
          <CreatedLine key={card._id} card={card} />
        ) : card.status === "discarded" ? (
          <DiscardedLine key={card._id} card={card} />
        ) : (
          <PlanTask key={card._id} card={card} members={members} categories={categories} />
        ),
      )}
      {gaps && gaps.gaps.length > 0 && (
        <p className="text-[13px] text-warning">{gaps.gaps.join(" · ")}</p>
      )}
      {hasPending && (
        <p className="text-xs text-muted-foreground/70">Click a task to see and edit it as a draft.</p>
      )}
    </div>
  )
}

function PlanTask({
  card,
  members,
  categories,
}: {
  card: CreateCard
  members: readonly Member[]
  categories: readonly Category[]
}) {
  const open = useOpenProposal()
  const payload = card.payload
  const taskOwners = (payload.assigneeIds ?? [])
    .map((id) => members.find((m) => m._id === id))
    .filter((m): m is Member => m !== undefined)
  const category = categories.find((c) => c._id === payload.workCategoryId)
  const subtasks = payload.subtasks ?? []

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-3 pb-1.5">
        <button
          type="button"
          onClick={() => open({ kind: "draft", proposalId: card._id })}
          className="min-w-0 text-left text-sm font-semibold text-foreground underline-offset-2 hover:underline"
        >
          {payload.title}
        </button>
        <span className="flex-1" />
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {category && <>{category.name} · </>}
          {taskOwners.length > 0 ? taskOwners.map((m) => firstName(m.name)).join(", ") : <OpenValue />}
          {" · "}
          {payload.dueDate ? (
            <span className={DETERMINISTIC_VALUE_CLASS}>{formatShortDate(payload.dueDate)}</span>
          ) : (
            <OpenValue />
          )}
        </span>
      </div>

      {subtasks.length > 0 && (
        <div role="table" aria-label="Subtasks" className="flex flex-col border-t">
          <div
            role="row"
            className="grid grid-cols-[22px_minmax(0,1fr)_96px_56px] gap-2.5 border-b border-border/60 py-1.5 text-[11.5px] text-muted-foreground/70"
          >
            <span role="columnheader" aria-label="Number" />
            <span role="columnheader">Subtask</span>
            <span role="columnheader">Owner</span>
            <span role="columnheader" className="text-right">
              Due
            </span>
          </div>
          {subtasks.map((sub, i) => {
            const own = sub.assigneeIds
              .map((id) => members.find((m) => m._id === id))
              .filter((m): m is Member => m !== undefined)
            const owners = own.length > 0 ? own : taskOwners
            const due = sub.dueDate ?? payload.dueDate
            return (
              <div
                key={`${i}-${sub.title}`}
                role="row"
                className="grid grid-cols-[22px_minmax(0,1fr)_96px_56px] items-start gap-2.5 border-b border-border/60 py-2 text-[13.5px] leading-snug"
              >
                <span role="cell" className={cn("pt-px text-xs text-muted-foreground/70", DETERMINISTIC_VALUE_CLASS)}>
                  {i + 1}
                </span>
                <span role="cell" className="text-foreground/90">
                  {sub.title}
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/80">
                  {owners.length > 0 ? (
                    <>
                      <UserAvatar name={owners[0].name} imageUrl={owners[0].imageUrl} className="size-[18px] text-[8px]" />
                      <span className="truncate">
                        {firstName(owners[0].name)}
                        {owners.length > 1 && <span className="text-muted-foreground"> +{owners.length - 1}</span>}
                      </span>
                    </>
                  ) : (
                    <OpenValue />
                  )}
                </span>
                <span role="cell" className={cn("pt-px text-right text-xs text-muted-foreground", DETERMINISTIC_VALUE_CLASS)}>
                  {due ? formatShortDate(due) : <OpenValue />}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {card.status === "failed" && card.failureReason && (
        <div className="pt-2">
          <FailureNote reason={card.failureReason} />
        </div>
      )}
    </div>
  )
}

/** The amber "open" of a missing value. */
function OpenValue() {
  return <span className="text-warning">open</span>
}

function CreatedLine({ card }: { card: CreateCard }) {
  const openTask = useOpenWidgetTask()
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
      <span>Created</span>
      {card.committedRef ? (
        <button
          type="button"
          onClick={() => openTask({ id: card.committedRef!, identifier: null })}
          className="min-w-0 truncate text-left text-foreground underline-offset-2 hover:underline"
        >
          {card.payload.title}
        </button>
      ) : (
        <span className="min-w-0 truncate text-foreground">{card.payload.title}</span>
      )}
    </div>
  )
}

function DiscardedLine({ card }: { card: CreateCard }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span>Discarded</span>
      <span className="min-w-0 truncate line-through">{card.payload.title}</span>
    </div>
  )
}
