"use client"

import { forwardRef, useState } from "react"
import { useMutation, useQuery, useConvexAuth } from "convex/react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellIcon,
  BellOffIcon,
  CheckIcon,
  MailIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SnoozeMenu } from "@/components/inbox/snooze-menu"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/** Small icon button shared by the inbox hover-action strip. */
export const InboxActionButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { label: string }
>(function InboxActionButton({ label, className, ...props }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
})

/**
 * Hover-reveal action strip for a notification group row
 * (invoice-row-actions pattern: opacity-0 until group hover/focus).
 *
 * Inbox view: read/unread toggle, archive, snooze, overflow (mute task).
 * Archived view: unarchive (markUnread — restores to inbox as unread).
 */
export function NotificationRowActions({
  memberIds,
  unreadMemberIds,
  taskId,
  view,
}: {
  memberIds: Id<"notifications">[]
  unreadMemberIds: Id<"notifications">[]
  taskId: Id<"tasks">
  view: "inbox" | "archived"
}) {
  const markRead = useMutation(api.notifications.markRead)
  const markUnread = useMutation(api.notifications.markUnread)
  const archive = useMutation(api.notifications.archive)

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const isUnread = unreadMemberIds.length > 0

  if (view === "archived") {
    return (
      <div
        className="flex items-center gap-0.5 p-0.5"
        onClick={stop}
      >
        <InboxActionButton
          label="Unarchive"
          onClick={() =>
            void markUnread({ ids: memberIds }).catch((err) =>
              toastError(err, "Failed to unarchive notification"),
            )
          }
        >
          <ArchiveRestoreIcon className="size-3.5" />
        </InboxActionButton>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 p-0.5"
      onClick={stop}
    >
      {isUnread ? (
        <InboxActionButton
          label="Mark as read"
          onClick={() =>
            void markRead({ ids: unreadMemberIds }).catch((err) =>
              toastError(err, "Failed to mark as read"),
            )
          }
        >
          <CheckIcon className="size-3.5" />
        </InboxActionButton>
      ) : (
        <InboxActionButton
          label="Mark as unread"
          onClick={() =>
            void markUnread({ ids: memberIds }).catch((err) =>
              toastError(err, "Failed to mark as unread"),
            )
          }
        >
          <MailIcon className="size-3.5" />
        </InboxActionButton>
      )}
      <InboxActionButton
        label="Archive"
        onClick={() =>
          void archive({ ids: memberIds }).catch((err) =>
            toastError(err, "Failed to archive notification"),
          )
        }
      >
        <ArchiveIcon className="size-3.5" />
      </InboxActionButton>
      <SnoozeMenu ids={memberIds} />
      <OverflowMenu taskId={taskId} />
    </div>
  )
}

/**
 * Overflow menu with the mute toggle. `isTaskMuted` is only subscribed while
 * the menu is open — one query per OPEN menu, not one per rendered row.
 */
function OverflowMenu({ taskId }: { taskId: Id<"tasks"> }) {
  const { isAuthenticated } = useConvexAuth()
  const [open, setOpen] = useState(false)
  const muteTask = useMutation(api.notifications.muteTask)
  const unmuteTask = useMutation(api.notifications.unmuteTask)
  const isMuted = useQuery(
    api.notifications.isTaskMuted,
    isAuthenticated && open ? { taskId } : "skip",
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <InboxActionButton label="More">
          <MoreHorizontalIcon className="size-3.5" />
        </InboxActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {isMuted ? (
          <DropdownMenuItem
            onClick={() =>
              void unmuteTask({ taskId }).catch((err) =>
                toastError(err, "Failed to unmute task"),
              )
            }
          >
            <BellIcon className="mr-2 size-3.5" />
            Unmute task
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isMuted === undefined}
            onClick={() =>
              void muteTask({ taskId }).catch((err) =>
                toastError(err, "Failed to mute task"),
              )
            }
          >
            <BellOffIcon className="mr-2 size-3.5" />
            Mute task
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
