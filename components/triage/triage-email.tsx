"use client"

import { ChevronRightIcon, PaperclipIcon } from "lucide-react"
import type { TriageEmail } from "@/convex/email/triageView"
import { formatFileSize } from "@/lib/attachment"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { formatEmailTime, senderLabel } from "@/components/triage/format"
import { useEmailFold } from "@/components/triage/use-email-fold"

/**
 * The original email, Gmail-style (docs/prd-email-triage.md D14; B8b): the
 * subject, the sender line, every paragraph untouched — the STORED TEXT with
 * its whitespace kept (`whitespace-pre-wrap`); the HTML body is never
 * rendered — and the attachments as chips. Later emails of the item follow,
 * each with its own sender line.
 *
 * Once the agent has a plan it folds to one line ("Kovács Réka — Black
 * Friday… · Show the original email"), never while the reader is in it, and
 * the owner's own choice is remembered per item (`useEmailFold`).
 */
export function TriageEmailLead({
  itemId,
  subject,
  emails,
  hasPlan,
}: {
  itemId: string
  subject: string
  emails: readonly TriageEmail[]
  hasPlan: boolean
}) {
  const fold = useEmailFold(itemId, hasPlan)
  if (emails.length === 0) return null
  const latest = emails[emails.length - 1]

  if (fold.folded) {
    return (
      <button
        type="button"
        onClick={fold.expand}
        aria-label="Show the original email"
        className="-mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-muted-foreground transition-colors hover:bg-accent/60"
      >
        <UserAvatar name={senderLabel(latest.from)} size="sm" className="size-[22px] text-[9px]" />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">
          <span className="font-medium text-foreground">{senderLabel(latest.from)}</span> — {subject}
          {emails.length > 1 && <span className="text-muted-foreground"> · {emails.length} emails</span>}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[12.5px]">
          Show the original email
          <ChevronRightIcon className="size-3.5" aria-hidden />
        </span>
      </button>
    )
  }

  return (
    <article
      aria-label="Original email"
      {...fold.readerProps}
      className="flex flex-col gap-3.5 border-b border-border/60 pb-5"
    >
      <h2 className="text-[19px] font-normal leading-snug tracking-[-0.01em]">{subject || "(no subject)"}</h2>
      {emails.map((email, i) => (
        <EmailMessage key={email._id} email={email} separated={i > 0} />
      ))}
      {hasPlan && (
        <Button
          variant="ghost"
          size="sm"
          onClick={fold.fold}
          className="ml-[34px] self-start text-[12.5px] text-muted-foreground"
        >
          Hide email
        </Button>
      )}
    </article>
  )
}

function EmailMessage({ email, separated }: { email: TriageEmail; separated: boolean }) {
  const recipients = [...email.to, ...email.cc].map((r) => r.name ?? r.email).join(", ")
  return (
    <div className={cn("flex flex-col gap-3", separated && "border-t border-border/50 pt-4")}>
      <div className="flex items-start gap-2.5">
        <UserAvatar name={senderLabel(email.from)} className="size-8 text-[11px]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px]">
            <span className="font-semibold">{senderLabel(email.from)}</span>{" "}
            {email.from.name && <span className="text-[12.5px] text-muted-foreground">‹{email.from.email}›</span>}
          </span>
          {recipients && <span className="truncate text-[12.5px] text-muted-foreground">to {recipients}</span>}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[12.5px] text-muted-foreground">{formatEmailTime(email.sentAt)}</span>
      </div>
      <div className="flex flex-col gap-2.5 pl-[42px]">
        {/* Plain stored text, paragraphs untouched (D14) — never the HTML body. */}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{email.bodyText}</p>
        {email.attachments.length > 0 && (
          <ul aria-label="Attachments" className="flex flex-wrap gap-2 pt-1">
            {email.attachments.map((a, i) => (
              <li key={`${a.name}-${i}`}>
                <AttachmentChip name={a.name} size={a.size} url={a.url} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AttachmentChip({ name, size, url }: { name: string; size: number; url: string | null }) {
  const body = (
    <>
      <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(size)}</span>
    </>
  )
  const className =
    "flex h-8 max-w-[240px] items-center gap-1.5 rounded-md bg-muted/60 px-2.5 text-[12.5px] transition-colors"
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(className, "hover:bg-muted")}>
      {body}
    </a>
  ) : (
    <span className={className}>{body}</span>
  )
}
