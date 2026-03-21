"use client"

import {
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react"
import { useMutation, useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Mention from "@tiptap/extension-mention"
import Link from "@tiptap/extension-link"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Underline from "@tiptap/extension-underline"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { ToolbarButton } from "@/components/toolbar-button"
import { EmojiPickerPopover } from "@/components/emoji-picker-popover"
import { CommentAttachmentChip } from "@/components/comment-attachment-chip"
import { MentionDropdown } from "@/components/tasks/mention-dropdown"
import type { MentionSuggestion, MentionDropdownState } from "@/components/tasks/mention-dropdown"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import {
  AtSignIcon,
  SmileIcon,
  PaperclipIcon,
  XIcon,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListChecksIcon,
  CodeIcon,
  QuoteIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
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
  const [mentionState, setMentionState] = useState<MentionDropdownState | null>(null)
  const mentionKeyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)

  const { isAuthenticated } = useConvexAuth()
  const createComment = useMutation(api.comments.create)
  const generateUploadUrl = useMutation(api.commentAttachments.generateUploadUrl)
  const saveAttachment = useMutation(api.commentAttachments.save)
  const setTypingMutation = useMutation(api.typingIndicators.setTyping)
  const clearTypingMutation = useMutation(api.typingIndicators.clearTyping)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)
  const suppressTypingRef = useRef(false)
  const members = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated ? {} : "skip",
  )

  // Build mention items — ref so suggestion config always reads latest
  const mentionItems: MentionSuggestion[] = (members ?? []).map((m) => ({
    id: m._id,
    label: m.name,
  }))
  const mentionItemsRef = useRef(mentionItems)
  mentionItemsRef.current = mentionItems

  // Suggestion config — stable ref, renders via React state instead of tippy
  const suggestionConfig = useRef({
    items: ({ query }: { query: string }): MentionSuggestion[] =>
      mentionItemsRef.current
        .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5),

    render: () => ({
      onStart: (props: { items: MentionSuggestion[]; command: (item: MentionSuggestion) => void; clientRect?: (() => DOMRect | null) | null }) => {
        setMentionState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
      },
      onUpdate: (props: { items: MentionSuggestion[]; command: (item: MentionSuggestion) => void; clientRect?: (() => DOMRect | null) | null }) => {
        setMentionState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        return mentionKeyDownRef.current?.(props) ?? false
      },
      onExit: () => {
        setMentionState(null)
      },
    }),
  })

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      Placeholder.configure({ placeholder: "Write a comment..." }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: suggestionConfig.current,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline cursor-pointer" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
    ],
    onUpdate: () => {
      // Skip typing indicator during submit (clearContent triggers onUpdate)
      if (suppressTypingRef.current) return
      const now = Date.now()
      if (now - lastTypingRef.current > 2000) {
        lastTypingRef.current = now
        void setTypingMutation({ taskId })
      }
    },
    editorProps: {
      attributes: {
        class:
          "comment-editor tiptap-content focus:outline-none min-h-[60px] max-h-[min(300px,50vh)] overflow-y-auto px-3 py-2 text-sm",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault()
          handleSubmitRef.current()
          return true
        }
        return false
      },
    },
  })

  // Auto-focus editor when replyContext changes
  useEffect(() => {
    if (replyContext && editor) {
      editor.commands.focus()
    }
  }, [replyContext, editor])

  // Clear typing indicator on unmount
  useEffect(() => {
    return () => {
      void clearTypingMutation({ taskId })
    }
  }, [clearTypingMutation, taskId])

  // File upload handler
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
            prev.map((f) =>
              f.fileId === tempId ? { ...f, uploading: false, storageId } : f,
            ),
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

  const handleSubmit = useCallback(async () => {
    if (!editor || isSubmitting || hasPendingUploads) return
    if (editor.isEmpty && pendingFiles.length === 0) return
    const json = editor.getJSON()

    setIsSubmitting(true)
    let commentId: Id<"comments"> | undefined
    try {
      commentId = await createComment({
        taskId,
        content: json,
        parentCommentId: replyContext?.commentId as Id<"comments"> | undefined,
      })
    } catch (err) {
      toastError(err, "Failed to post comment")
      setIsSubmitting(false)
      return
    }

    // Comment created — clear editor immediately so retrying won't duplicate
    void clearTypingMutation({ taskId })
    lastTypingRef.current = 0
    suppressTypingRef.current = true
    editor.commands.clearContent()
    editor.commands.focus()
    suppressTypingRef.current = false
    onClearReply()

    // Attach files (best-effort after comment is committed)
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
    <div className="border-t border-border/60 bg-muted/40 p-3">
      {/* Reply context banner */}
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

      {/* Editor area */}
      <div className="mb-2.5 overflow-hidden rounded-lg border border-border/30 bg-background shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30">
        {/* Formatting toolbar */}
        <div className="flex items-center gap-0.5 border-b border-border/30 bg-muted/20 px-2 py-1">
          <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
            <BoldIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
            <ItalicIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
            <StrikethroughIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("link")}
            onClick={() => {
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run()
              } else {
                const url = window.prompt("URL")
                if (url) editor.chain().focus().setLink({ href: url }).run()
              }
            }}
            aria-label="Link"
          >
            <LinkIcon className="size-3.5" />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border/40" />

          <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
            <ListIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Ordered list">
            <ListOrderedIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Task list">
            <ListChecksIcon className="size-3.5" />
          </ToolbarButton>

          <div className="mx-1 h-4 w-px bg-border/40" />

          <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label="Code block">
            <CodeIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Blockquote">
            <QuoteIcon className="size-3.5" />
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} />
      </div>

      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
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

      {/* Toolbar: action icons left, send button right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <ActionBtn
            onClick={() => insertMentionTrigger(editor)}
            aria-label="Mention someone"
          >
            <AtSignIcon className="size-4" />
          </ActionBtn>
          <ActionBtn
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
          >
            <PaperclipIcon className="size-4" />
          </ActionBtn>
          <EmojiPickerPopover
            onSelect={(emoji) =>
              editor.chain().focus().insertContent(emoji).run()
            }
          >
            <ActionBtn
              onClick={() => {}}
              aria-label="Add emoji"
            >
              <SmileIcon className="size-4" />
            </ActionBtn>
          </EmojiPickerPopover>
        </div>
        <Button
          size="default"
          onClick={() => handleSubmit()}
          disabled={isSubmitting || hasPendingUploads}
        >
          Comment
        </Button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Mention suggestion dropdown — rendered via React portal */}
      {mentionState && (
        <MentionDropdown state={mentionState} onKeyDownRef={mentionKeyDownRef} />
      )}
    </div>
  )
}

// ─── Mention trigger utility ─────────────────────────────────────────────────
// Ensures proper whitespace before the trigger character so the suggestion
// plugin detects it (same logic as TipTap's addMentionTrigger).

function insertMentionTrigger(editor: ReturnType<typeof useEditor>) {
  if (!editor) return

  editor.commands.focus("end")

  const { state } = editor.view
  const { $from } = state.selection
  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
  const needsSpace = textBefore.length > 0 && !textBefore.endsWith(" ") && !textBefore.endsWith("\n")

  editor.chain().insertContent(needsSpace ? " @" : "@").run()
}

// ─── Action button ───────────────────────────────────────────────────────────

function ActionBtn({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 rounded-full text-muted-foreground/60 hover:text-foreground"
      {...props}
    >
      {children}
    </Button>
  )
}
