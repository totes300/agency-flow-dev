"use client"

import type { ReactNode } from "react"
import { UserAvatar } from "@/components/user-avatar"
import { CommentAttachmentChip } from "@/components/comment-attachment-chip"
import { EmojiPickerPopover } from "@/components/emoji-picker-popover"
import { formatActivityTimestamp } from "@/lib/format"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { ThumbsUpIcon, SmilePlusIcon, CornerDownRightIcon } from "lucide-react"
import type { FeedItem } from "@/lib/task-detail"

/** Clerk default avatars contain "default" in the URL — show monogram instead */
function isDefaultAvatar(url?: string | null): boolean {
  if (!url) return true
  return url.includes("/eyJ0eXBlIjoiZGVmYXVsdCI")
}
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

// ─── TipTap JSON renderer ────────────────────────────────────────────────────────

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function renderTiptapContent(content: unknown): ReactNode {
  if (!content || typeof content !== "object") return null
  const doc = content as TiptapNode
  if (doc.type === "doc" && doc.content) {
    return (
      <div className="tiptap-content text-sm leading-relaxed">
        {doc.content.map((node, i) => renderNode(node, i))}
      </div>
    )
  }
  return null
}

function renderNode(node: TiptapNode, key: number): ReactNode {
  if (node.type === "paragraph") {
    const children = node.content?.map((child, i) => renderNode(child, i))
    return <p key={key} className="my-0">{children ?? <br />}</p>
  }

  if (node.type === "text") {
    let element: ReactNode = node.text ?? ""
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "bold") element = <strong>{element}</strong>
        if (mark.type === "italic") element = <em>{element}</em>
        if (mark.type === "code") element = <code>{element}</code>
        if (mark.type === "underline") element = <u>{element}</u>
        if (mark.type === "strike") element = <s>{element}</s>
        if (mark.type === "link") {
          const href = mark.attrs?.href as string | undefined
          element = <a href={href ?? "#"} target="_blank" rel="noopener noreferrer">{element}</a>
        }
      }
    }
    return <span key={key}>{element}</span>
  }

  if (node.type === "mention") {
    const label = (node.attrs?.label ?? node.attrs?.id ?? "") as string
    return (
      <span
        key={key}
        className="inline rounded bg-blue-100 px-1 py-0.5 text-[12px] font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-400"
      >
        @{label}
      </span>
    )
  }

  if (node.type === "bulletList") {
    return <ul key={key}>{node.content?.map((child, i) => renderNode(child, i))}</ul>
  }
  if (node.type === "orderedList") {
    return <ol key={key}>{node.content?.map((child, i) => renderNode(child, i))}</ol>
  }
  if (node.type === "listItem") {
    return <li key={key}>{node.content?.map((child, i) => renderNode(child, i))}</li>
  }
  if (node.type === "taskList") {
    return <ul key={key} data-type="taskList">{node.content?.map((child, i) => renderNode(child, i))}</ul>
  }
  if (node.type === "taskItem") {
    const checked = node.attrs?.checked as boolean | undefined
    return (
      <li key={key} data-type="taskItem" data-checked={checked ? "true" : "false"}>
        <label><input type="checkbox" checked={checked ?? false} readOnly /></label>
        <div>{node.content?.map((child, i) => renderNode(child, i))}</div>
      </li>
    )
  }
  if (node.type === "heading") {
    const level = (node.attrs?.level as number) ?? 2
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
    return <Tag key={key}>{node.content?.map((child, i) => renderNode(child, i))}</Tag>
  }
  if (node.type === "blockquote") {
    return <blockquote key={key}>{node.content?.map((child, i) => renderNode(child, i))}</blockquote>
  }
  if (node.type === "codeBlock") {
    return <pre key={key}><code>{node.content?.map((child, i) => renderNode(child, i))}</code></pre>
  }

  if (node.type === "hardBreak") return <br key={key} />

  // Fallback: render children
  if (node.content) {
    return <span key={key}>{node.content.map((child, i) => renderNode(child, i))}</span>
  }

  return null
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface CommentCardProps {
  item: FeedItem & { kind: "comment" }
  currentUserId?: Id<"users">
  reactions?: Array<{
    emoji: string
    count: number
    userNames: string[]
    hasReacted: boolean
  }>
  attachments?: Array<{
    _id: string
    fileName: string
    fileSize: number
    mimeType: string
    url: string | null
  }>
  onReply: (commentId: string, userName: string) => void
  onToggleReaction: (commentId: string, emoji: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function CommentCard({
  item,
  reactions,
  attachments,
  onReply,
  onToggleReaction,
}: CommentCardProps) {
  return (
    <div id={`comment-${item.id}`} className="group/comment my-3 rounded-lg border border-border/60 bg-background">
      {/* Header: avatar + name + time */}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-1.5">
        <UserAvatar
          name={item.userName ?? "?"}
          imageUrl={isDefaultAvatar(item.userImageUrl) ? null : item.userImageUrl}
          className="size-6 text-[9px]"
        />
        <span className="text-sm font-medium text-foreground">
          {item.userName}
        </span>
        <span className="text-[11px] text-muted-foreground/50">
          {formatActivityTimestamp(item.createdAt)}
        </span>
      </div>

      {/* Reply label — clickable, scrolls to parent comment */}
      {item.parentCommentId && (
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById(`comment-${item.parentCommentId}`)
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" })
              el.classList.add("ring-2", "ring-primary/30")
              setTimeout(() => el.classList.remove("ring-2", "ring-primary/30"), 1500)
            }
          }}
          className="flex items-center gap-1 pl-4 pr-4 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          <CornerDownRightIcon className="size-3 shrink-0" />
          <span className="truncate">
            replied to{" "}
            {item.parentPreview
              ? `"${item.parentPreview}"`
              : (item.parentUserName ?? "someone")}
          </span>
        </button>
      )}

      {/* Body — render TipTap JSON with mentions */}
      <div className="px-4 pb-2">
        {renderTiptapContent(item.content)}
      </div>

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {attachments.map((att) => (
            <CommentAttachmentChip
              key={att._id}
              fileName={att.fileName}
              fileSize={att.fileSize}
              mimeType={att.mimeType}
              url={att.url}
            />
          ))}
        </div>
      )}

      {/* Reaction badges */}
      {reactions && reactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          <TooltipProvider>
            {reactions.map((r) => (
              <Tooltip key={r.emoji}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onToggleReaction(item.id, r.emoji)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted",
                      r.hasReacted
                        ? "border-primary/30 bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span>{r.count}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="text-xs">{r.userNames.join(", ")}</span>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      )}

      {/* Footer: quick actions */}
      <div className="flex items-center justify-between border-t-2 border-border/40 px-4 py-2 opacity-40 transition-opacity duration-200 group-hover/comment:opacity-100">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleReaction(item.id, "\u{1F44D}")}
            aria-label="Toggle thumbs up reaction"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ThumbsUpIcon className="size-3.5" />
          </button>
          <EmojiPickerPopover
            onSelect={(emoji) => onToggleReaction(item.id, emoji)}
          >
            <button
              type="button"
              aria-label="Add reaction"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            >
              <SmilePlusIcon className="size-3.5" />
            </button>
          </EmojiPickerPopover>
        </div>
        <button
          type="button"
          onClick={() => onReply(item.id, item.userName ?? "Someone")}
          className="text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        >
          Reply
        </button>
      </div>
    </div>
  )
}
