"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { TriageView as TriageViewName } from "@/convex/email/triageView"
import { buildProposalUrl, buildTaskUrl, parseProposalRef, parseTaskRef } from "@/lib/task-detail"
import { cn } from "@/lib/utils"
import { TASK_VIEW_PANEL_CLASS } from "@/components/task-view/task-view-skeleton"
import { ShortcutsDialog } from "@/components/task-view/shortcuts-dialog"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { DrawerShellModeContext } from "@/components/task-detail/drawer-shell"
import type { ProposalDrawerFooter } from "@/components/task-detail/proposal-drawer"
import { WidgetTaskOpenerContext, type WidgetTaskRef } from "@/components/agents/blocks/use-open-task"
import { ConversationSurfaceContext } from "@/components/agents/blocks/conversation-surface"
import { TRIAGE_VIEWS, TriageList } from "@/components/triage/triage-list"
import { TriageConversation, TriageConversationSkeleton } from "@/components/triage/triage-conversation"
import { TriageDrawerFooter } from "@/components/triage/triage-drawer-footer"
import { canMerge, canTriage, drawerTarget, primaryAction } from "@/components/triage/triage-model"
import { useTriageActions, type DrawerFlush } from "@/components/triage/use-triage-actions"
import { stepSelection, TRIAGE_SHORTCUTS, useTriageKeyboard, type TriageKeyAction } from "@/components/triage/use-triage-keyboard"

/** Every param that opens the drawer (a task, its comment, a proposal). */
const DRAWER_PARAMS = ["task", "detail", "comment", "draft", "change"] as const
const DONE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const TRIAGE_PAGE_SIZE = 50
const HOUR_MS = 60 * 60 * 1000

function parseView(raw: string | null): TriageViewName {
  return TRIAGE_VIEWS.find((v) => v.value === raw)?.value ?? "open"
}

/**
 * /triage (docs/prd-email-triage.md §7.2, §7.7, D12–D15, D24–D30; B8b): the
 * list on the left (J/K, `?item=`, the views behind the header control), the
 * conversation in the middle, the task drawer on demand on the right
 * (`?draft=` / `?change=` / `?task=`) — while it is open the list column
 * hides and the conversation and drawer share the space (the drawer is
 * docked: focus moves freely, Esc closes it). The app sidebar stays.
 *
 * Admins of an org with email triage only: every query answers null to
 * anyone else, and the page then renders not-found (members never get here —
 * the route is admin-only, lib/route-access.ts).
 */
export function TriageView() {
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const view = parseView(searchParams.get("view"))
  const itemParam = searchParams.get("item")
  const threadParam = searchParams.get("thread")
  // The Done view's cutoff (no wall clock in a query): 30 days back, per hour.
  const [doneSince] = useState(() => Math.floor((Date.now() - DONE_WINDOW_MS) / HOUR_MS) * HOUR_MS)

  // Access + the empty state's hint (null = no Triage → not-found).
  const meta = useQuery(api.email.triageView.listMeta, isAuthenticated ? {} : "skip")
  const allowed = isAuthenticated && meta !== null && meta !== undefined
  const pinned = useQuery(api.email.triageView.listPinned, allowed && view === "open" ? {} : "skip")
  const paged = usePaginatedQuery(
    api.email.triageView.listItems,
    allowed ? (view === "done" ? { view, doneSince } : { view }) : "skip",
    { initialNumItems: TRIAGE_PAGE_SIZE },
  )
  const pageLoaded = paged.status !== "LoadingFirstPage"
  const rows = useMemo(() => {
    if (!allowed || !pageLoaded || (view === "open" && pinned === undefined)) return undefined
    const loaded = [...paged.results].sort((a, b) => b.at - a.at)
    // Changes on linked tasks always on top, whatever the paging (§7.2).
    return view === "open" ? [...(pinned ?? []), ...loaded] : loaded
  }, [allowed, pageLoaded, paged.results, pinned, view])
  const more =
    paged.status === "CanLoadMore" || paged.status === "LoadingMore"
      ? { loading: paged.status === "LoadingMore", load: () => paged.loadMore(TRIAGE_PAGE_SIZE) }
      : null
  // No `?item=` yet: the first row is the selection (written to the URL on the first move).
  const selectedId = itemParam ?? (threadParam ? null : (rows?.[0]?._id ?? null))
  const detail = useQuery(
    api.email.triageView.getItem,
    !isAuthenticated
      ? "skip"
      : selectedId
        ? { itemId: selectedId }
        : threadParam
          ? { emailThreadId: threadParam }
          : "skip",
  )

  const drawerOpen = parseTaskRef(searchParams) !== null || parseProposalRef(searchParams) !== null

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(window.location.search)
      mutate(params)
      const query = params.toString()
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false })
    },
    [pathname, router],
  )

  const select = useCallback(
    (id: string | null) =>
      replaceParams((p) => {
        p.delete("thread")
        for (const key of DRAWER_PARAMS) p.delete(key)
        if (id) p.set("item", id)
        else p.delete("item")
      }),
    [replaceParams],
  )

  const setView = (next: TriageViewName) =>
    replaceParams((p) => {
      p.delete("item")
      p.delete("thread")
      if (next === "open") p.delete("view")
      else p.set("view", next)
    })

  const closeDrawer = useCallback(
    () =>
      replaceParams((p) => {
        for (const key of DRAWER_PARAMS) p.delete(key)
      }),
    [replaceParams],
  )

  const openTask = useCallback(
    (task: WidgetTaskRef) => {
      const current = new URLSearchParams(window.location.search)
      router.replace(`${pathname}${buildTaskUrl(current, task)}`, { scroll: false })
    },
    [pathname, router],
  )

  const toggleDrawer = () => {
    if (drawerOpen) return closeDrawer()
    const target = detail ? drawerTarget(detail) : null
    if (!target) return
    const current = new URLSearchParams(window.location.search)
    router.replace(
      `${pathname}${target.kind === "proposal" ? buildProposalUrl(current, target.ref) : buildTaskUrl(current, target.task)}`,
      { scroll: false },
    )
  }

  // After a decision that takes the item off the list: the next row (or the previous one).
  const rowIds = useMemo(() => (rows ?? []).map((r) => r._id as string), [rows])
  const leave = useCallback(() => {
    const at = selectedId ? rowIds.indexOf(selectedId) : -1
    const next = at === -1 ? null : (rowIds[at + 1] ?? rowIds[at - 1] ?? null)
    select(next)
  }, [rowIds, select, selectedId])

  const drawerFlush = useRef<DrawerFlush | null>(null)
  const actions = useTriageActions({ detail, drawerFlush, onLeave: leave, onReturn: select, onCloseDrawer: closeDrawer })
  const footer = useCallback<ProposalDrawerFooter>((ctx) => <TriageDrawerFooter ctx={ctx} registryRef={drawerFlush} />, [])

  const [mergeOpen, setMergeOpen] = useState(false)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const onKey = (action: TriageKeyAction) => {
    if (action === "next" || action === "prev") {
      const next = stepSelection(rowIds, selectedId, action === "next" ? 1 : -1)
      if (next && next !== selectedId) select(next)
      return
    }
    if (action === "shortcuts") return setShortcutsOpen(true)
    if (!detail) return
    if (action === "primary") return actions.runPrimary(primaryAction(detail))
    if (!canTriage(detail)) return
    if (action === "decline") return void actions.decline()
    if (action === "snooze") return setSnoozeOpen(true)
    if (action === "merge" && canMerge(detail)) setMergeOpen(true)
  }
  useTriageKeyboard({ enabled: allowed, listVisible: !drawerOpen, onAction: onKey })

  // The default selection goes into the URL as soon as the rows load, so a new
  // email sorting in above never swaps the item under the user. Once per view:
  // after "Back to the list" (phones) nothing is re-selected.
  const autoSelectedFor = useRef<string | null>(null)
  const firstRowId = rows?.[0]?._id ?? null
  useEffect(() => {
    if (itemParam || threadParam) {
      autoSelectedFor.current = view
      return
    }
    if (autoSelectedFor.current === view || !firstRowId) return
    autoSelectedFor.current = view
    select(firstRowId)
  }, [firstRowId, itemParam, threadParam, view, select])

  // An Inbox link to a conversation (`?thread=`): once resolved, the URL names the item.
  const resolvedId = threadParam && !itemParam && detail ? detail._id : null
  useEffect(() => {
    if (resolvedId) select(resolvedId)
  }, [resolvedId, select])

  // No Triage for this viewer (a member, or the org has no email triage): not found.
  if (meta === null) notFound()

  return (
    <DrawerShellModeContext.Provider value="docked">
      <ConversationSurfaceContext.Provider value="triage">
        <WidgetTaskOpenerContext.Provider value={openTask}>
          <div
            data-full-bleed
            data-drawer-open={drawerOpen || undefined}
            className={cn(TASK_VIEW_PANEL_CLASS, "flex-row", drawerOpen && "md:pr-[54vw]")}
          >
            <TriageList
              className={cn(drawerOpen && "hidden", itemParam && "max-md:hidden")}
              view={view}
              onViewChange={setView}
              rows={rows}
              selectedId={selectedId}
              onSelect={select}
              onPromote={(id) => void actions.promote(id)}
              gmailConnected={meta?.gmailConnected ?? true}
              more={more}
            />
            <section
              aria-label="Conversation"
              className={cn("flex min-w-0 flex-1 flex-col", !itemParam && "max-md:hidden")}
            >
              {detail === undefined && selectedId ? (
                <TriageConversationSkeleton />
              ) : detail ? (
                <TriageConversation
                  key={detail._id}
                  detail={detail}
                  actions={actions}
                  menus={{ mergeOpen, setMergeOpen, snoozeOpen, setSnoozeOpen }}
                  drawerOpen={drawerOpen}
                  onToggleDrawer={toggleDrawer}
                  onBack={() => select(null)}
                />
              ) : selectedId || threadParam ? (
                <p className="m-auto text-sm text-muted-foreground">This email is no longer in Triage.</p>
              ) : null}
            </section>
          </div>
          {/* `?task=` (a linked task, widget cards) and `?draft=` / `?change=` (B7). */}
          <TaskDetailDrawer taskIds={[]} isAdmin proposalFooter={footer} />
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} shortcuts={TRIAGE_SHORTCUTS} />
        </WidgetTaskOpenerContext.Provider>
      </ConversationSurfaceContext.Provider>
    </DrawerShellModeContext.Provider>
  )
}
