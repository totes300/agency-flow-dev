"use client"

import { UserAvatar } from "@/components/user-avatar"
import { NotificationRowActions } from "@/components/inbox/notification-row-actions"
import { formatRelativeTime } from "@/lib/format"
import { formatActorNames, groupVerb, type InboxGroup, type InboxRowBase } from "@/lib/inbox"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

const MAX_STACKED_AVATARS = 3

/**
 * One group row: stacked actor avatars, sentence, latest preview, relative
 * time, unread dot. Hover reveals the action strip (`group` class).
 */
export function NotificationRow<R extends InboxRowBase>({
  group,
  view,
  isActive = false,
  onOpen,
}: {
  group: InboxGroup<R>
  view: "inbox" | "archived"
  /** The group's task is currently open in the detail drawer/modal. */
  isActive?: boolean
  onOpen: (group: InboxGroup<R>) => void
}) {
  const shownActors = group.actors.slice(0, MAX_STACKED_AVATARS)
  const extraActors = group.actors.length - shownActors.length

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(group)}
        className={cn(
          "flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "bg-accent",
        )}
      >
        <div className="flex shrink-0 -space-x-2 pt-0.5">
          {shownActors.map((actor) => (
            <UserAvatar
              key={actor.actorId}
              name={actor.actorName}
              imageUrl={actor.actorImageUrl}
              size="sm"
              className="ring-2 ring-background"
            />
          ))}
          {extraActors > 0 && (
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
              +{extraActors}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="pr-14 text-sm leading-snug">
            <span className="font-medium">{formatActorNames(group.actors)}</span>{" "}
            <span className="text-muted-foreground">{groupVerb(group)}</span>{" "}
            <span className="font-medium">{group.taskTitle}</span>
          </p>
          {group.latest.previewText && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {group.latest.previewText}
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            {formatRelativeTime(group.latest.createdAt)}
          </p>
        </div>
        {group.unread && (
          <span
            className="mt-2 size-2 shrink-0 rounded-full bg-blue-500"
            aria-label="Unread"
          />
        )}
      </button>
      {/* Action strip overlays the row's top-right corner on hover */}
      <div className="absolute right-2 top-1.5 rounded-md bg-background/95 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <NotificationRowActions
          memberIds={group.memberIds as Id<"notifications">[]}
          unreadMemberIds={group.unreadMemberIds as Id<"notifications">[]}
          taskId={group.taskId as Id<"tasks">}
          view={view}
        />
      </div>
    </div>
  )
}
