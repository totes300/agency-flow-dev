"use client"

import { useState, useCallback, useEffect, memo, type ReactNode } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ThumbsUpIcon,
  SmilePlusIcon,
  CornerDownRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
  MessageSquareIcon,
} from "lucide-react"
import type { FeedItem } from "@/lib/task-detail"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

/** Format timestamp as short 24h time: "16:05" */
function formatShortTime(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
}

/** Clerk default avatars contain "default" in the URL — show monogram instead */
function isDefaultAvatar(url?: string | null): boolean {
  if (!url) return true
  return url.includes("/eyJ0eXBlIjoiZGVmYXVsdCI")
}

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
        if (mark.type === "highlight") {
          const color = mark.attrs?.color as string | undefined
          element = <mark style={color ? { backgroundColor: color } : undefined}>{element}</mark>
        }
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
        className="mention inline rounded px-1 py-0.5 text-[12px] font-medium"
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

  if (node.type === "image") {
    const src = node.attrs?.src as string | undefined
    const alt = (node.attrs?.alt as string) ?? ""
    if (!src) return null
    return (
      <img
        key={key}
        src={src}
        alt={alt}
        className="my-2 max-h-64 max-w-full rounded-md object-contain"
        loading="lazy"
      />
    )
  }

  if (node.type === "table") {
    return (
      <table key={key} className="my-2 w-full border-collapse text-sm">
        <tbody>{node.content?.map((child, i) => renderNode(child, i))}</tbody>
      </table>
    )
  }
  if (node.type === "tableRow") {
    return <tr key={key}>{node.content?.map((child, i) => renderNode(child, i))}</tr>
  }
  if (node.type === "tableHeader") {
    return (
      <th key={key} className="border border-border/50 bg-muted/50 px-2 py-1 text-left font-medium">
        {node.content?.map((child, i) => renderNode(child, i))}
      </th>
    )
  }
  if (node.type === "tableCell") {
    return (
      <td key={key} className="border border-border/50 px-2 py-1">
        {node.content?.map((child, i) => renderNode(child, i))}
      </td>
    )
  }

  if (node.type === "highlight") {
    return <mark key={key}>{node.content?.map((child, i) => renderNode(child, i))}</mark>
  }

  if (node.content) {
    return <span key={key}>{node.content.map((child, i) => renderNode(child, i))}</span>
  }

  return null
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ChatMessageProps {
  item: FeedItem & { kind: "comment" }
  currentUserId?: Id<"users">
  isAdmin?: boolean
  isGrouped?: boolean
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
  onEdit?: (commentId: string, content: unknown) => void
  onDelete?: (commentId: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────────

export const ChatMessage = memo(function ChatMessage({
  item,
  currentUserId,
  isAdmin,
  isGrouped = false,
  reactions,
  attachments,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState<unknown>(null)

  const isOwn = currentUserId && item.userId === currentUserId
  const canEdit = isOwn && onEdit
  const canDelete = (isOwn || isAdmin) && onDelete

  const handleStartEdit = useCallback(() => {
    setEditContent(item.content)
    setIsEditing(true)
  }, [item.content])

  const handleSaveEdit = useCallback(() => {
    if (editContent && onEdit) {
      onEdit(item.id, editContent)
    }
    setIsEditing(false)
    setEditContent(null)
  }, [editContent, onEdit, item.id])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditContent(null)
  }, [])

  return (
    <div
      id={`comment-${item.id}`}
      className={cn(
        "group/msg relative rounded-lg px-3 transition-colors hover:bg-muted/75",
        isGrouped
          ? "py-1.5"
          : "mt-3 py-1.5",
      )}
    >
      {/* Floating action toolbar — Slack-style pill, top-right */}
      {!isEditing && (
        <div className="absolute top-0 right-1 z-10 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background px-1 py-0.5 opacity-0 shadow-sm transition-opacity duration-100 group-hover/msg:opacity-100">
          <button
            type="button"
            onClick={() => onToggleReaction(item.id, "\u{1F44D}")}
            aria-label="Toggle thumbs up reaction"
            className="flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ThumbsUpIcon className="size-3.5" />
          </button>
          <EmojiPickerPopover
            onSelect={(emoji) => onToggleReaction(item.id, emoji)}
          >
            <button
              type="button"
              aria-label="Add reaction"
              className="flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <SmilePlusIcon className="size-3.5" />
            </button>
          </EmojiPickerPopover>
          <button
            type="button"
            onClick={() => onReply(item.id, item.userName ?? "Someone")}
            aria-label="Reply"
            className="flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquareIcon className="size-3.5" />
          </button>
          {(canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                {canEdit && (
                  <DropdownMenuItem onClick={handleStartEdit}>
                    <PencilIcon className="mr-2 size-3.5" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    onClick={() => onDelete!(item.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <TrashIcon className="mr-2 size-3.5" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Slack-style row: avatar left + content right */}
      <div className={cn("flex gap-2", isGrouped && "items-baseline")}>
        {/* Avatar column — 24px wide */}
        <div className="w-6 shrink-0">
          {!isGrouped ? (
            <div className="flex h-5 items-center">
              <UserAvatar
                name={item.userName ?? "?"}
                imageUrl={isDefaultAvatar(item.userImageUrl) ? null : item.userImageUrl}
                className="size-6 text-[8px]"
              />
            </div>
          ) : (
            /* Grouped: show short timestamp on hover, matches text line-height for baseline alignment */
            <span className="text-[10px] leading-relaxed text-muted-foreground/0 transition-colors group-hover/msg:text-muted-foreground/60">
              {formatShortTime(item.createdAt)}
            </span>
          )}
        </div>

        {/* Content column */}
        <div className="min-w-0 max-w-[80%] flex-1 overflow-hidden break-words">
          {/* Header: name + time (only for non-grouped messages) */}
          {!isGrouped && (
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold leading-5 text-foreground">
                {item.userName}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs font-normal text-muted-foreground/60">
                    {formatShortTime(item.createdAt)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="text-xs">{formatActivityTimestamp(item.createdAt)}</span>
                </TooltipContent>
              </Tooltip>
              {item.updatedAt && item.updatedAt !== item.createdAt && (
                <span className="text-[10px] text-muted-foreground/55">(edited)</span>
              )}
            </div>
          )}

          {/* Reply label — clickable, scrolls to parent comment */}
          {item.parentCommentId && (
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById(`comment-${item.parentCommentId}`)
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" })
                  el.classList.remove("comment-highlight")
              void el.offsetWidth
              el.classList.add("comment-highlight")
            }
          }}
              className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground/60 transition-colors hover:text-foreground/80"
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

          {/* Body — render or edit */}
          <div>
            {isEditing ? (
              <ChatEditArea
                content={editContent}
                onChange={setEditContent}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
              />
            ) : (
              renderTiptapContent(item.content)
            )}
          </div>

          {/* Attachments */}
          {!isEditing && attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
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

          {/* Reaction badges — always visible when present */}
          {!isEditing && reactions && reactions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
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

        </div>
      </div>
    </div>
  )
})

// ─── Inline edit area ───────────────────────────────────────────────────────────

function ChatEditArea({
  content,
  onChange,
  onSave,
  onCancel,
}: {
  content: unknown
  onChange: (content: unknown) => void
  onSave: () => void
  onCancel: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [TiptapEditor, setTiptapEditor] = useState<React.ComponentType<any> | null>(null)

  useEffect(() => {
    void import("@/components/tasks/tiptap-editor").then((mod) => {
      setTiptapEditor(() => mod.TiptapEditor)
    })
  }, [])

  if (!TiptapEditor) {
    return (
      <div className="rounded-lg border border-border/40 p-3">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-border/60 focus-within:border-primary/40">
        <TiptapEditor
          content={content}
          onUpdate={onChange}
          autoFocus
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Save
        </button>
      </div>
    </div>
  )
}
