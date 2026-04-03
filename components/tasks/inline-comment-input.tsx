"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useMutation, useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { Tiptap, useEditor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Underline from "@tiptap/extension-underline"
import { api } from "@/convex/_generated/api"
import { UserAvatar } from "@/components/user-avatar"
import { BubbleToolbar } from "@/components/tasks/editor-toolbar"
import { CommentAttachmentChip } from "@/components/comment-attachment-chip"
import { useMentionSuggestion } from "@/components/tasks/use-mention-suggestion"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import {
  AtSignIcon,
  PaperclipIcon,
  ArrowUpIcon,
  XIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import "./tiptap-editor.css"

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PendingFile {
  fileId: string
  fileName: string
  fileSize: number
  mimeType: string
  uploading: boolean
  storageId?: string
}

interface InlineCommentInputProps {
  taskId: Id<"tasks">
  replyContext: { commentId: string; userName: string } | null
  onClearReply: () => void
}

// ─── Notion-style inline comment input ─────────────────────────────────────────

export function InlineCommentInput({
  taskId,
  replyContext,
  onClearReply,
}: InlineCommentInputProps) {
  const { isAuthenticated } = useConvexAuth()
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [hasContent, setHasContent] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  const { mentionExtension, mentionOpenRef, renderMentionDropdown } = useMentionSuggestion()

  const createComment = useMutation(api.comments.create)
  const generateUploadUrl = useMutation(api.commentAttachments.generateUploadUrl)
  const saveAttachment = useMutation(api.commentAttachments.save)
  const setTypingMutation = useMutation(api.typingIndicators.setTyping)
  const clearTypingMutation = useMutation(api.typingIndicators.clearTyping)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)
  const suppressTypingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      Placeholder.configure({ placeholder: "Add a comment..." }),
      mentionExtension,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline cursor-pointer" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
    ],
    onUpdate: ({ editor: e }) => {
      setHasContent(!e.isEmpty)
      if (suppressTypingRef.current) return
      const now = Date.now()
      if (now - lastTypingRef.current > 2000) {
        lastTypingRef.current = now
        void setTypingMutation({ taskId })
      }
    },
    onFocus: () => setIsFocused(true),
    editorProps: {
      attributes: {
        class: "inline-comment-editor tiptap-content focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.isComposing) {
          if (!editor) return false
          if (mentionOpenRef.current) return false
          if (editor.isActive("listItem") || editor.isActive("taskItem") || editor.isActive("codeBlock")) {
            return false
          }
          event.preventDefault()
          handleSubmitRef.current()
          return true
        }
        return false
      },
    },
  }, [mentionExtension])

  useEffect(() => {
    if (replyContext && editor) {
      editor.commands.focus()
      setIsFocused(true)
    }
  }, [replyContext, editor])

  useEffect(() => {
    return () => { void clearTypingMutation({ taskId }) }
  }, [clearTypingMutation, taskId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !hasContent &&
        pendingFiles.length === 0 &&
        !replyContext
      ) {
        setIsFocused(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [hasContent, pendingFiles.length, replyContext])

  // ─── File upload ─────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      const maxFiles = 5
      const maxFileSize = 10 * 1024 * 1024
      if (pendingFiles.length + files.length > maxFiles) {
        toastError(null, `Maximum ${maxFiles} files per comment`)
        e.target.value = ""
        return
      }

      for (const file of Array.from(files)) {
        if (file.size > maxFileSize) {
          toastError(null, `${file.name} exceeds 10MB limit`)
          continue
        }
        const tempId = crypto.randomUUID()
        const pending: PendingFile = {
          fileId: tempId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          uploading: true,
        }
        setPendingFiles((prev) => [...prev, pending])

        try {
          const uploadUrl = await generateUploadUrl()
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          })
          const { storageId } = (await result.json()) as { storageId: string }
          setPendingFiles((prev) =>
            prev.map((f) => (f.fileId === tempId ? { ...f, uploading: false, storageId } : f)),
          )
        } catch (err) {
          toastError(err, "Failed to upload file")
          setPendingFiles((prev) => prev.filter((f) => f.fileId !== tempId))
        }
      }

      e.target.value = ""
    },
    [generateUploadUrl, pendingFiles.length],
  )

  const hasPendingUploads = pendingFiles.some((f) => f.uploading)

  // ─── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!editor || isSubmitting || hasPendingUploads) return
    if (editor.isEmpty && pendingFiles.length === 0) return

    setIsSubmitting(true)
    let commentId: Id<"comments"> | undefined
    try {
      commentId = await createComment({
        taskId,
        content: editor.getJSON(),
        parentCommentId: replyContext?.commentId as Id<"comments"> | undefined,
      })
    } catch (err) {
      toastError(err, "Failed to post comment")
      setIsSubmitting(false)
      return
    }

    void clearTypingMutation({ taskId })
    lastTypingRef.current = 0
    suppressTypingRef.current = true
    editor.commands.clearContent()
    suppressTypingRef.current = false
    onClearReply()

    try {
      for (const file of pendingFiles) {
        if (file.storageId) {
          await saveAttachment({
            commentId,
            fileId: file.storageId as Id<"_storage">,
            fileName: file.fileName,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
          })
        }
      }
    } catch (err) {
      toastError(err, "Some attachments failed to save")
    }

    setPendingFiles([])
    setIsSubmitting(false)
    setIsFocused(false)
  }, [editor, isSubmitting, hasPendingUploads, createComment, taskId, replyContext, pendingFiles, saveAttachment, onClearReply, clearTypingMutation])

  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  if (!editor) return null

  const canSend = (hasContent || pendingFiles.length > 0) && !isSubmitting && !hasPendingUploads
  const showActions = isFocused || hasContent || pendingFiles.length > 0

  return (
    <Tiptap editor={editor}>
      <div ref={containerRef} className="border-b border-border pb-3.5">
        {/* Reply banner */}
        {replyContext && (
          <div className="mb-2 ml-8 flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            <span>↩ Replying to {replyContext.userName}</span>
            <button
              type="button"
              onClick={onClearReply}
              className="flex size-5 items-center justify-center rounded-full hover:bg-muted"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )}

        {/* Single row: avatar, editor, actions. Placeholder alignment is handled in
            CSS so the typed/focused state keeps its original layout. */}
        <div
          className="flex cursor-text items-start gap-3"
          onClick={() => { editor.commands.focus(); setIsFocused(true) }}
        >
          <UserAvatar
            name={currentUser?.name ?? "?"}
            imageUrl={currentUser?.imageUrl}
            className="size-6 shrink-0 text-[9px]"
          />

          <div className="flex min-h-6 min-w-0 flex-1 items-start">
            <Tiptap.Content />
          </div>

          <div className={cn(
            "flex shrink-0 items-center gap-0.5 self-end transition-opacity duration-150",
            showActions ? "opacity-100" : "opacity-0 pointer-events-none",
          )}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:text-muted-foreground"
              aria-label="Attach file"
            >
              <PaperclipIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); insertMentionTrigger(editor) }}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:text-muted-foreground"
              aria-label="Mention someone"
            >
              <AtSignIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void handleSubmit() }}
              disabled={!canSend}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground/30",
              )}
              aria-label="Send comment"
            >
              <ArrowUpIcon className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Pending attachments */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-9 pt-2">
            {pendingFiles.map((file) => (
              <CommentAttachmentChip
                key={file.fileId}
                fileName={file.fileName}
                fileSize={file.fileSize}
                mimeType={file.mimeType}
                url={null}
                isPending={file.uploading}
              />
            ))}
          </div>
        )}

        {/* Floating bubble menu */}
        <BubbleMenu
          updateDelay={100}
          shouldShow={() => {
            if (editor.state.selection.empty) return false
            return true
          }}
        >
          <BubbleToolbar />
        </BubbleMenu>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {renderMentionDropdown()}
      </div>
    </Tiptap>
  )
}

// ─── Mention trigger utility ────────────────────────────────────────────────────

function insertMentionTrigger(editor: ReturnType<typeof useEditor>) {
  if (!editor) return
  editor.commands.focus("end")

  const { state } = editor.view
  const { $from } = state.selection
  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
  const needsSpace = textBefore.length > 0 && !textBefore.endsWith(" ") && !textBefore.endsWith("\n")

  editor.chain().insertContent(needsSpace ? " @" : "@").run()
}
