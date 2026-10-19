"use client"

import { ChevronLeftIcon, PanelRightIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { TriageItemDetail } from "@/convex/email/triageView"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThreadView } from "@/components/agents/thread-view"
import { TriageEmailLead } from "@/components/triage/triage-email"
import { TriageDecision } from "@/components/triage/triage-decision"
import { MergePicker } from "@/components/triage/merge-picker"
import { TriageSnoozeMenu } from "@/components/triage/triage-snooze-menu"
import { canMerge, canTriage, drawerTarget, suggestionsFor } from "@/components/triage/triage-model"
import type { TriageActions } from "@/components/triage/use-triage-actions"

export type QuietMenus = {
  mergeOpen: boolean
  setMergeOpen: (open: boolean) => void
  snoozeOpen: boolean
  setSnoozeOpen: (open: boolean) => void
}

/**
 * The middle column (docs/prd-email-triage.md D12, D14, §7.2; B8b): the
 * original email first, then the item's anchored agent thread through the
 * shared `ThreadView` (run line, plan list, question and email blocks, event
 * lines — B8a), the decision at hand, the composer with 2–3 suggestions, and
 * under it the quiet Merge into… · Decline · Snooze.
 *
 * Before the assistant has a thread (nothing planned yet, no agent actor) the
 * same frame shows the email and the decision without a composer.
 */
export function TriageConversation({
  detail,
  actions,
  menus,
  drawerOpen,
  onToggleDrawer,
  onBack,
}: {
  detail: TriageItemDetail
  actions: TriageActions
  menus: QuietMenus
  drawerOpen: boolean
  onToggleDrawer: () => void
  onBack: () => void
}) {
  const hasPlan = Boolean(detail.plan || detail.change || detail.commit || detail.draftId)
  const header = (
    <ConversationHeader
      detail={detail}
      drawerOpen={drawerOpen}
      canOpenDrawer={drawerTarget(detail) !== null}
      onToggleDrawer={onToggleDrawer}
      onBack={onBack}
    />
  )
  const lead = <TriageEmailLead itemId={detail._id} subject={detail.subject} emails={detail.emails} hasPlan={hasPlan} />
  const trailing = <TriageDecision detail={detail} actions={actions} />
  const below = <QuietActions detail={detail} actions={actions} menus={menus} />

  if (!detail.agentThreadId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
            {lead}
            {detail.state.live ? (
              <p className="text-[13px] text-muted-foreground">The assistant is reading the email…</p>
            ) : detail.status === "open" && !detail.planIssue && detail.attentions.length === 0 && !hasPlan ? (
              <p className="text-[13px] text-muted-foreground">The assistant hasn&apos;t prepared this email yet.</p>
            ) : null}
            {trailing}
          </div>
        </div>
        {below}
      </div>
    )
  }

  return (
    <ThreadView
      key={detail.agentThreadId}
      threadId={detail.agentThreadId}
      header={header}
      lead={lead}
      trailing={trailing}
      belowComposer={below}
      suggestions={suggestionsFor(detail)}
      proposalDrawer={false}
    />
  )
}

function ConversationHeader({
  detail,
  drawerOpen,
  canOpenDrawer,
  onToggleDrawer,
  onBack,
}: {
  detail: TriageItemDetail
  drawerOpen: boolean
  canOpenDrawer: boolean
  onToggleDrawer: () => void
  onBack: () => void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <Button variant="ghost" size="icon-xs" className="-ml-1.5 md:hidden" aria-label="Back to the list" onClick={onBack}>
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-0 truncate text-sm font-medium">{detail.title}</span>
      {detail.clientName && <span className="shrink-0 truncate text-xs text-muted-foreground">{detail.clientName}</span>}
      <span className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={drawerOpen ? "Close the task panel" : "Open the task panel"}
            aria-pressed={drawerOpen}
            disabled={!canOpenDrawer && !drawerOpen}
            onClick={onToggleDrawer}
            className={cn("text-muted-foreground", drawerOpen && "bg-accent text-foreground")}
          >
            <PanelRightIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{drawerOpen ? "Close the panel (Esc)" : "Open the task panel"}</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** Under the composer, quiet (§7.2): Merge into… · Decline · Snooze, each with its key. */
function QuietActions({ detail, actions, menus }: { detail: TriageItemDetail; actions: TriageActions; menus: QuietMenus }) {
  if (!canTriage(detail)) return null
  const mergeable = canMerge(detail)
  return (
    <div className="mx-auto flex w-full max-w-2xl items-center gap-0.5 px-4 pb-3 text-[12.5px] text-muted-foreground">
      <span className="flex-1" />
      {mergeable && (
        <MergePicker
          itemId={detail._id as Id<"agentItems">}
          clientName={detail.clientName}
          open={menus.mergeOpen}
          onOpenChange={menus.setMergeOpen}
          onPick={(task) => void actions.merge(task)}
        >
          <QuietButton label="Merge into…" shortcut="M" disabled={actions.busy} />
        </MergePicker>
      )}
      <QuietButton label="Decline" shortcut="D" disabled={actions.busy} onClick={() => void actions.decline()} />
      <TriageSnoozeMenu open={menus.snoozeOpen} onOpenChange={menus.setSnoozeOpen} onSnooze={(c) => void actions.snooze(c)}>
        <QuietButton label="Snooze" shortcut="H" disabled={actions.busy} />
      </TriageSnoozeMenu>
    </div>
  )
}

function QuietButton({
  label,
  shortcut,
  ...props
}: { label: string; shortcut: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="xs" className="h-6.5 px-2 text-[12.5px] font-normal text-muted-foreground" {...props}>
      {label}
      <span className="pl-0.5 text-muted-foreground/50">{shortcut}</span>
    </Button>
  )
}

export function TriageConversationSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Skeleton className="h-6 w-2/3" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex flex-col gap-2 pl-[42px]">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}
