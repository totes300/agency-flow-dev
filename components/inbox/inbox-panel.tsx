"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useConvexAuth } from "convex/react"
import { ArchiveIcon, CheckCheckIcon, ListFilterIcon, XIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { InboxEmptyState } from "@/components/inbox/inbox-empty-state"
import { NotificationRow } from "@/components/inbox/notification-row"
import { InboxActionButton } from "@/components/inbox/notification-row-actions"
import { groupInbox, type InboxGroup, type InboxRowBase } from "@/lib/inbox"
import { buildTaskDeepLink, parseDetailParam } from "@/lib/task-detail"
import { useOrgTimezone } from "@/lib/hooks/use-org-timezone"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2">
      <Skeleton className="mx-2 mt-2 h-3 w-20" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-md p-2">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Inbox content — hosted by the desktop InboxSidebar panel or the mobile
 * Sheet.
 *
 * variant "sidebar": persistent panel. Row clicks navigate but the panel
 * STAYS OPEN (sequential triage; the panel doubles as a live monitor);
 * the header shows an explicit close button, and the row whose task is
 * currently open gets an active highlight.
 *
 * variant "sheet": overlay. Row clicks also close it (mobile behavior).
 */
export function InboxPanel({
  variant = "sheet",
  onClose,
  now,
}: {
  variant?: "sidebar" | "sheet"
  onClose: () => void
  /** Week-bucket anchor; defaults to mount time (the Sheet remounts per open). */
  now?: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated } = useConvexAuth()
  const { timezone } = useOrgTimezone()

  // Ephemeral UI state — the panel isn't a route, so no URL persistence
  const [view, setView] = useState<"inbox" | "archived">("inbox")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [mountedAt] = useState(() => Date.now())
  const bucketAnchor = now ?? mountedAt

  const inboxRows = useQuery(
    api.notifications.listInbox,
    isAuthenticated && view === "inbox" ? {} : "skip",
  )
  const archivedRows = useQuery(
    api.notifications.listArchived,
    isAuthenticated && view === "archived" ? {} : "skip",
  )
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)

  const rows = view === "inbox" ? inboxRows : archivedRows
  const hasUnread = (inboxRows ?? []).some((r) => r.inboxState === "unread")
  const activeTaskId = parseDetailParam(searchParams)

  const sections =
    rows === undefined ? undefined : groupInbox(rows, timezone, bucketAnchor)
  const visibleSections = sections
    ?.map((section) => ({
      ...section,
      groups:
        view === "inbox" && unreadOnly
          ? section.groups.filter((g) => g.unread)
          : section.groups,
    }))
    .filter((section) => section.groups.length > 0)

  function handleOpen(group: InboxGroup<InboxRowBase>) {
    if (group.unreadMemberIds.length > 0) {
      void markRead({ ids: group.unreadMemberIds as Id<"notifications">[] }).catch(
        (err) => toastError(err, "Failed to mark notification as read"),
      )
    }
    if (variant === "sheet") onClose()
    router.push(
      buildTaskDeepLink(
        group.taskId,
        group.typeClass === "comment" ? group.latest.commentId : undefined,
      ),
    )
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          {view === "archived" ? "Archived" : "Inbox"}
        </h2>
        <div className="flex items-center gap-0.5">
          <InboxActionButton
            label="Mark all as read"
            disabled={view === "archived" || !hasUnread}
            onClick={() =>
              void markAllRead({}).catch((err) =>
                toastError(err, "Failed to mark all as read"),
              )
            }
          >
            <CheckCheckIcon className="size-4" />
          </InboxActionButton>
          <InboxActionButton
            label={unreadOnly ? "Show all" : "Unread only"}
            disabled={view === "archived"}
            onClick={() => setUnreadOnly((v) => !v)}
            className={cn(unreadOnly && "bg-accent text-foreground")}
          >
            <ListFilterIcon className="size-4" />
          </InboxActionButton>
          <InboxActionButton
            label={view === "archived" ? "Back to inbox" : "Archived"}
            onClick={() => setView((v) => (v === "inbox" ? "archived" : "inbox"))}
            className={cn(view === "archived" && "bg-accent text-foreground")}
          >
            <ArchiveIcon className="size-4" />
          </InboxActionButton>
          {variant === "sidebar" && (
            <>
              <Separator orientation="vertical" className="mx-1 data-vertical:h-4" />
              <InboxActionButton label="Close inbox" onClick={onClose}>
                <XIcon className="size-4" />
              </InboxActionButton>
            </>
          )}
        </div>
      </div>
      <Separator />
      <div className="flex flex-1 flex-col overflow-y-auto">
        {visibleSections === undefined ? (
          <InboxSkeleton />
        ) : visibleSections.length === 0 ? (
          <div className="flex flex-1 flex-col py-10">
            <InboxEmptyState view={view} />
          </div>
        ) : (
          <div className="flex flex-col p-2">
            {visibleSections.map((section) => (
              <div key={section.key} className="flex flex-col">
                <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground first:pt-1">
                  {section.label}
                </p>
                {section.groups.map((group) => (
                  <NotificationRow
                    key={group.key}
                    group={group}
                    view={view}
                    isActive={variant === "sidebar" && group.taskId === activeTaskId}
                    onOpen={handleOpen}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
