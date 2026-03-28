"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { Tiptap, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Underline from "@tiptap/extension-underline"
import { api } from "@/convex/_generated/api"
import { ToolbarButton } from "@/components/toolbar-button"
import { CommentToolbar } from "@/components/tasks/editor-toolbar"
import { EmojiPickerPopover } from "@/components/emoji-picker-popover"
import { CommentAttachmentChip } from "@/components/comment-attachment-chip"
import { useMentionSuggestion } from "@/components/tasks/use-mention-suggestion"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import {
  AtSignIcon,
  SmileIcon,
  PaperclipIcon,
  XIcon,
  SendHorizonalIcon,
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

interface TaskDetailCommentInputProps {
  taskId: Id<"tasks">
  replyContext: { commentId: string; userName: string } | null
  onClearReply: () => void
}

// ─── Main comment input ─────────────────────────────────────────────────────────

export function TaskDetailCommentInput({
  taskId,
  replyContext,
  onClearReply,
}: TaskDetailCommentInputProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [hasContent, setHasContent] = useState(false)

  const { mentionExtension, renderMentionDropdown } = useMentionSuggestion()

  const createComment = useMutation(api.comments.create)
  const generateUploadUrl = useMutation(api.commentAttachments.generateUploadUrl)
  const saveAttachment = useMutation(api.commentAttachments.save)
  const setTypingMutation = useMutation(api.typingIndicators.setTyping)
  const clearTypingMutation = useMutation(api.typingIndicators.clearTyping)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)
  const suppressTypingRef = useRef(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      Placeholder.configure({ placeholder: "Write a comment..." }),
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
    editorProps: {
      attributes: {
        class: "comment-editor tiptap-content focus:outline-none min-h-[60px] max-h-[min(300px,50vh)] overflow-y-auto px-3 py-2",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          if (!editor) return false
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
  })

  useEffect(() => {
    if (replyContext && editor) editor.commands.focus()
  }, [replyContext, editor])

  useEffect(() => {
    return () => { void clearTypingMutation({ taskId }) }
  }, [clearTypingMutation, taskId])

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
    editor.commands.focus()
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
  }, [editor, isSubmitting, hasPendingUploads, createComment, taskId, replyContext, pendingFiles, saveAttachment, onClearReply, clearTypingMutation])

  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  if (!editor) return null

  return (
    <Tiptap editor={editor}>
      <div className="bg-background/80 p-3">
        {replyContext && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            <span>&#x21A9; Replying to {replyContext.userName}</span>
            <button
              type="button"
              onClick={onClearReply}
              className="flex size-5 items-center justify-center rounded-full hover:bg-muted"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border/100 bg-background transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30">
          <CommentToolbar />
          <Tiptap.Content />

          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
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

          <CommentBottomBar
            editor={editor}
            onSubmit={handleSubmit}
            onAttach={() => fileInputRef.current?.click()}
            hasContent={hasContent}
            pendingFileCount={pendingFiles.length}
            isSubmitting={isSubmitting}
            hasPendingUploads={hasPendingUploads}
          />
        </div>

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

// ─── Bottom bar ─────────────────────────────────────────────────────────────────

function CommentBottomBar({
  editor,
  onSubmit,
  onAttach,
  hasContent,
  pendingFileCount,
  isSubmitting,
  hasPendingUploads,
}: {
  editor: ReturnType<typeof useEditor>
  onSubmit: () => void
  onAttach: () => void
  hasContent: boolean
  pendingFileCount: number
  isSubmitting: boolean
  hasPendingUploads: boolean
}) {
  if (!editor) return null

  return (
    <div className="flex items-center justify-between px-1.5 py-1">
      <div className="flex items-center gap-0.5">
        <EmojiPickerPopover onSelect={(emoji) => editor.chain().focus().insertContent(emoji).run()}>
          <ToolbarButton active={false} onClick={() => {}} aria-label="Add emoji">
            <SmileIcon className="size-4" />
          </ToolbarButton>
        </EmojiPickerPopover>
        <ToolbarButton
          active={false}
          onClick={() => insertMentionTrigger(editor)}
          aria-label="Mention someone"
        >
          <AtSignIcon className="size-4" />
        </ToolbarButton>

        <div className="mx-0.5 h-4 w-px bg-border/50" />

        <ToolbarButton active={false} onClick={onAttach} aria-label="Attach file">
          <PaperclipIcon className="size-4" />
        </ToolbarButton>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting || hasPendingUploads}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors",
          !hasContent && pendingFileCount === 0
            ? "text-muted-foreground/30"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
          (isSubmitting || hasPendingUploads) && "opacity-50",
        )}
        aria-label="Send comment"
      >
        <SendHorizonalIcon className="size-4" />
      </button>
    </div>
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
