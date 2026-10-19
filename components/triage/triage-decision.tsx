"use client"

import Link from "next/link"
import { AlertCircleIcon } from "lucide-react"
import type { TriageItemDetail } from "@/convex/email/triageView"
import { OUTCOME_LABELS } from "@/lib/agents/triageState"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { formatSnoozeUntil } from "@/components/triage/format"
import { primaryAction, PRIMARY_LABELS } from "@/components/triage/triage-model"
import type { TriageActions } from "@/components/triage/use-triage-actions"

/**
 * The decision at hand, at the end of the conversation (docs/prd-email-triage.md
 * §7.2 "Item types"; B8b) — buttons only for that decision, ONE dark primary
 * (⌘↵), the rest quiet:
 *
 *   request / new sender   Create (under the plan list)
 *   change                 Apply change · Not a change
 *   approval               Mark done · Keep in Client review
 *   question               the reply email above has Send; here "Make it a task instead"
 *   needs a look           Plan it
 *   attention              Retry · Reconnect (when the mailbox is disconnected)
 *   plan issue             Retry, or "Set the agent actor in Settings"
 *   filtered               Move to Triage
 *
 * The kickoff / reply email's Send lives in its email block (B8a).
 */
export function TriageDecision({ detail, actions }: { detail: TriageItemDetail; actions: TriageActions }) {
  const primary = primaryAction(detail)
  const busy = actions.busy
  const shortcut = <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground/80">⌘↵</Kbd>

  if (detail.status === "done") {
    const outcome = detail.outcome ? OUTCOME_LABELS[detail.outcome] : "Done"
    return <Line>{`${outcome} · this email is done`}</Line>
  }

  if (detail.attentions.length > 0) {
    const reconnect = detail.mailbox && !detail.mailbox.connected
    return (
      <Bar note={<Amber>{`Couldn't process the email: ${detail.attentions[0].message}`}</Amber>}>
        {reconnect && (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/agents?view=connectors">Reconnect</Link>
          </Button>
        )}
        <Button size="sm" onClick={actions.retry} disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Retry{shortcut}
        </Button>
      </Bar>
    )
  }

  if (detail.state.live) return null

  if (detail.planIssue) {
    if (detail.planIssue.kind === "no_actor") {
      return (
        <Bar note={<Amber>No agent actor is set — automatic email work has no admin to run as.</Amber>}>
          <Button asChild size="sm">
            <Link href="/settings">Set the agent actor in Settings</Link>
          </Button>
        </Bar>
      )
    }
    return (
      <Bar note={<Amber>{detail.planIssue.message}</Amber>}>
        <Button size="sm" onClick={actions.replan} disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Retry{shortcut}
        </Button>
      </Bar>
    )
  }

  if (detail.status === "filtered") {
    return (
      <Bar note="Filtered — the assistant didn't take this for a work request.">
        <Button size="sm" onClick={() => actions.promote()} disabled={busy}>
          Move to Triage{shortcut}
        </Button>
      </Bar>
    )
  }

  const snoozedNote =
    detail.status === "snoozed" && detail.snoozedUntil ? (
      <Line>
        {`Snoozed until ${formatSnoozeUntil(detail.snoozedUntil)}`}
        <Button variant="ghost" size="xs" className="ml-1 text-muted-foreground" onClick={actions.wake} disabled={busy}>
          Unsnooze
        </Button>
      </Line>
    ) : null

  if (detail.commit) return snoozedNote

  let bar: React.ReactNode = null
  if (detail.kind === "change" && detail.change) {
    bar = (
      <Bar note="Nothing changes on the task until you apply it.">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={actions.rejectChange} disabled={busy}>
          Not a change
        </Button>
        <Button size="sm" onClick={actions.apply} disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {PRIMARY_LABELS.apply}
          {shortcut}
        </Button>
      </Bar>
    )
  } else if (detail.kind === "approval") {
    bar = (
      <Bar note={detail.linkedTask ? `${detail.linkedTask.identifier} is in Client review.` : null}>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={actions.keep} disabled={busy}>
          Keep in Client review
        </Button>
        <Button size="sm" onClick={actions.markDone} disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Mark done{shortcut}
        </Button>
      </Bar>
    )
  } else if (detail.kind === "needs_look") {
    bar = (
      <Bar note="Read the email — then plan it, or decline it below.">
        <Button size="sm" onClick={actions.planIt} disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Plan it{shortcut}
        </Button>
      </Bar>
    )
  } else if (primary === "send" && (detail.kind === "question" || detail.plan?.isReply)) {
    bar = (
      <Bar note="Or turn the question into work.">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={actions.toTask} disabled={busy}>
          Make it a task instead
        </Button>
      </Bar>
    )
  } else if (primary === "create" && detail.plan) {
    const n = detail.plan.tasks.length
    bar = (
      <Bar note={`${n === 1 ? "1 task" : `${n} tasks`} · nothing exists until you press Create`}>
        <Button size="sm" onClick={actions.create} disabled={busy} className="px-3.5">
          {busy && <Spinner data-icon="inline-start" />}
          {n > 1 ? `Create ${n} tasks` : "Create"}
          {shortcut}
        </Button>
      </Bar>
    )
  }

  return (
    <>
      {bar}
      {snoozedNote}
    </>
  )
}

function Bar({ note, children }: { note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="group" aria-label="Decision" className="flex items-center gap-2 border-t border-border/60 pt-3">
      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{note}</span>
      {children}
    </div>
  )
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center text-[13px] text-muted-foreground">{children}</p>
}

function Amber({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-warning">
      <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  )
}
