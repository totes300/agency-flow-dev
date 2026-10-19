"use client"

import { UserAvatar } from "@/components/user-avatar"
import { formatRelativeTime } from "@/lib/format"
import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"

export type EmailEventRowData = FunctionReturnType<typeof api.email.inbox.listEmailEvents>[number]

/** The row sentence per `email_event` subtype (B4 writes `no_action` and `change`). */
function emailEventVerb(subtype: string | null): string {
  switch (subtype) {
    case "no_action":
      return "wrote — no action needed on"
    case "change":
      return "asked for a change on"
    default:
      return "wrote on"
  }
}

/**
 * One email Inbox row (email triage §7.4, D10 — the Inbox only informs):
 * sender avatar, sentence, the email's own words as a quote, the reason
 * line and the time. The row opens Triage (`row.href`: the item, or the
 * conversation when there is none). Same layout as the task NotificationRow,
 * no extra chrome.
 */
export function EmailEventRow({
  row,
  onOpen,
}: {
  row: EmailEventRowData
  onOpen: (row: EmailEventRowData) => void
}) {
  const unread = row.inboxState === "unread"
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="shrink-0 pt-0.5">
        <UserAvatar name={row.senderName} size="sm" className="ring-2 ring-background" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-snug">
          <span className="font-medium">{row.senderName}</span>{" "}
          <span className="text-muted-foreground">{emailEventVerb(row.subtype)}</span>{" "}
          <span className="font-medium">{row.subject || "(no subject)"}</span>
        </p>
        {row.previewText && (
          <p className="line-clamp-2 text-xs text-muted-foreground">“{row.previewText}”</p>
        )}
        {row.reasonText && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{row.reasonText}</p>
        )}
        <p className="text-xs text-muted-foreground/70">
          {formatRelativeTime(row.createdAt)}
        </p>
      </div>
      {unread && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />
      )}
    </button>
  )
}
