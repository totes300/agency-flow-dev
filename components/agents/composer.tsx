"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { useMutation } from "convex/react"
import { Tiptap, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import {
  BotIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  useAgentMentions,
  collectMentions,
} from "@/components/agents/use-agent-mentions"
import {
  attachmentRejectionMessage,
  isSupportedAttachment,
  type MentionRef,
} from "@/lib/agents/composer"
import { formatFileSize } from "@/lib/attachment"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import "./agent-composer.css"

// ─── Types ───────────────────────────────────────────────────────────────────

/** An uploaded composer attachment, ready to hand to `startRun`. */
export type ComposerAttachment = {
  storageId: string
  name: string
  mimeType: string
  size: number
}

/** What the composer emits on send (PRD: text + typed mentions + files). */
export type ComposerSubmission = {
  text: string
  mentions: MentionRef[]
  attachments: ComposerAttachment[]
}

/** Imperative handle so parents can prefill (example chips) / restore drafts. */
export type AgentComposerHandle = {
  prefill: (text: string) => void
  focus: () => void
  clear: () => void
}

interface PendingFile {
  tempId: string
  name: string
  size: number
  mimeType: string
  uploading: boolean
  storageId?: string
}

const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// ─── Composer ─────────────────────────────────────────────────────────────────

/**
 * The designed composer (slice 07): a Tiptap editor with @-mentions across the
 * four domain entities + txt/csv attachments, replacing the tracer's textarea.
 * Enter sends, Shift+Enter is a newline, Escape blurs. The send button swaps
 * in-place to Stop during a run (the editor stays visible + typable). The
 * editor owns its content; parents receive a structured `ComposerSubmission`
 * on send and drive it imperatively for prefill/restore.
 */
export const AgentComposer = forwardRef<AgentComposerHandle, {
  agentName: string
  onSend: (submission: ComposerSubmission) => void
  /** A run is active — send swaps to Stop. */
  running: boolean
  onStop?: () => void
  /** Stop already requested (or no run id yet) — Stop shows as settling. */
  stopDisabled?: boolean
}>(function AgentComposer({ agentName, onSend, running, onStop, stopDisabled }, ref) {
  const [hasContent, setHasContent] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const submitRef = useRef<(() => void) | null>(null)

  const generateUploadUrl = useMutation(api.agentAttachments.generateUploadUrl)
  const { mentionExtension, mentionOpenRef, renderMentionDropdown } =
    useAgentMentions()

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        // Single-line-ish message input: no headings/lists — just paragraphs,
        // marks, and mentions. Long pastes keep their paragraph breaks.
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Placeholder.configure({ placeholder: `Message ${agentName}…` }),
        mentionExtension,
      ],
      onUpdate: ({ editor: e }) => setHasContent(!e.isEmpty),
      editorProps: {
        attributes: {
          class:
            "agent-composer-content focus:outline-none min-h-[60px] max-h-40 overflow-y-auto px-3 py-2.5",
        },
        handleKeyDown: (_view, event) => {
          if (event.key === "Escape") {
            editorRef.current?.commands.blur()
            return true
          }
          if (event.key === "Enter" && !event.shiftKey) {
            // Let the mention dropdown consume Enter to pick an item.
            if (mentionOpenRef.current) return false
            event.preventDefault()
            submitRef.current?.()
            return true
          }
          return false
        },
      },
    },
    [mentionExtension],
  )

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // ─── File upload ────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      const accepted = Array.from(files)
      e.target.value = "" // allow re-picking the same file after a rejection

      for (const file of accepted) {
        // US 17: reject unsupported/oversized files inline, before any run.
        if (!isSupportedAttachment(file.name, file.type)) {
          toastError(null, attachmentRejectionMessage(file.name))
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          toastError(null, `${file.name} exceeds the 10MB limit`)
          continue
        }
        let overCap = false
        setPendingFiles((prev) => {
          if (prev.length >= MAX_FILES) {
            overCap = true
            return prev
          }
          return prev
        })
        if (overCap) {
          toastError(null, `Up to ${MAX_FILES} files per message`)
          break
        }

        const tempId = crypto.randomUUID()
        setPendingFiles((prev) => [
          ...prev,
          {
            tempId,
            name: file.name,
            size: file.size,
            mimeType: file.type || "text/plain",
            uploading: true,
          },
        ])
        try {
          const uploadUrl = await generateUploadUrl()
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "text/plain" },
            body: file,
          })
          const { storageId } = (await res.json()) as { storageId: string }
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.tempId === tempId ? { ...f, uploading: false, storageId } : f,
            ),
          )
        } catch (err) {
          toastError(err, `Failed to upload ${file.name}`)
          setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId))
        }
      }
    },
    [generateUploadUrl],
  )

  const removeFile = useCallback((tempId: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId))
  }, [])

  const hasPendingUploads = pendingFiles.some((f) => f.uploading)
  const canSend =
    !running &&
    !hasPendingUploads &&
    (hasContent || pendingFiles.some((f) => f.storageId))

  // ─── Send ────────────────────────────────────────────────────────────────
  const send = useCallback(() => {
    const ed = editorRef.current
    if (!ed || running || hasPendingUploads) return
    const attachments: ComposerAttachment[] = pendingFiles
      .filter((f) => f.storageId)
      .map((f) => ({
        storageId: f.storageId as string,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
      }))
    // `getText` runs each mention through renderText → `@[label](type:id)`,
    // so the stored message carries both readable prose and parseable refs.
    const text = ed.getText({ blockSeparator: "\n" }).trim()
    const mentions = collectMentions(ed)
    if (!text && attachments.length === 0 && mentions.length === 0) return

    onSend({ text, mentions, attachments })
    ed.commands.clearContent()
    setHasContent(false)
    setPendingFiles([])
  }, [running, hasPendingUploads, pendingFiles, onSend])

  useEffect(() => {
    // Latest-ref: the editor's handleKeyDown closure is captured at creation
    // (when `editor` is still null) and must call the current send handler.
    submitRef.current = send
  })

  useImperativeHandle(
    ref,
    () => ({
      prefill: (text: string) => {
        const ed = editorRef.current
        if (!ed) return
        ed.commands.setContent(text)
        setHasContent(text.trim().length > 0)
        ed.commands.focus("end")
      },
      focus: () => editorRef.current?.commands.focus("end"),
      clear: () => {
        editorRef.current?.commands.clearContent()
        setHasContent(false)
        setPendingFiles([])
      },
    }),
    [],
  )

  return (
    <div className="shrink-0 border-t p-4">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <BotIcon className="size-3.5" />
          <span>{agentName}</span>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-md border bg-background focus-within:border-ring">
            {editor ? (
              <Tiptap editor={editor}>
                <Tiptap.Content />
              </Tiptap>
            ) : (
              <div className="min-h-[60px] px-3 py-2.5" />
            )}

            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {pendingFiles.map((file) => (
                  <ComposerAttachmentChip
                    key={file.tempId}
                    name={file.name}
                    size={file.size}
                    uploading={file.uploading}
                    onRemove={() => removeFile(file.tempId)}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between border-t px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
              >
                <PaperclipIcon className="size-4" />
              </Button>
              <span className="pr-1 text-[11px] text-muted-foreground/60">
                @ to mention · txt/csv
              </span>
            </div>
          </div>

          {running ? (
            <Button
              type="button"
              size="icon"
              onClick={onStop}
              disabled={stopDisabled || !onStop}
              aria-label="Stop"
            >
              {stopDisabled ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SquareIcon className="size-4 fill-current" />
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
            >
              <SendIcon className="size-4" />
            </Button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.csv,text/plain,text/csv"
          className="hidden"
          onChange={handleFileSelect}
        />
        {renderMentionDropdown()}
      </div>
    </div>
  )
})

// ─── Attachment chip ───────────────────────────────────────────────────────────

function ComposerAttachmentChip({
  name,
  size,
  uploading,
  onRemove,
}: {
  name: string
  size: number
  uploading: boolean
  onRemove: () => void
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground",
      )}
    >
      {uploading ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <PaperclipIcon className="size-3" />
      )}
      <span className="max-w-40 truncate">{name}</span>
      <span className="text-muted-foreground/60">{formatFileSize(size)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 flex size-4 items-center justify-center rounded-full hover:bg-muted"
        aria-label={`Remove ${name}`}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}
