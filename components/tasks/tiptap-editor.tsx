"use client"

import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import { useMutation, useAction } from "convex/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Underline from "@tiptap/extension-underline"
import Highlight from "@tiptap/extension-highlight"
import Mention from "@tiptap/extension-mention"
import TextAlign from "@tiptap/extension-text-align"
import { Table } from "@tiptap/extension-table"
import { TableRow } from "@tiptap/extension-table-row"
import { TableHeader } from "@tiptap/extension-table-header"
import { TableCell } from "@tiptap/extension-table-cell"
import { Extension } from "@tiptap/core"
import { FileHandler } from "@tiptap/extension-file-handler"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { ImageUploadNode, setPendingFiles } from "@/components/tasks/image-upload-node"
import type { UploadFunction } from "@/components/tasks/image-upload-node"
import { api } from "@/convex/_generated/api"
import { ToolbarButton } from "@/components/toolbar-button"
import { LinkPopover } from "@/components/tasks/link-popover"
import { HighlightPopover } from "@/components/tasks/highlight-popover"
import { HeadingPopover } from "@/components/tasks/heading-popover"
import { useSlashCommand } from "@/components/tasks/slash-command"
import { MentionDropdown } from "@/components/tasks/mention-dropdown"
import type { MentionSuggestion, MentionDropdownState } from "@/components/tasks/mention-dropdown"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { toastError } from "@/lib/toast-helpers"
import "./tiptap-editor.css"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  ListIcon,
  ListOrderedIcon,
  CodeIcon,
  ListChecksIcon,
  QuoteIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  ImageIcon,
  TableIcon,
} from "lucide-react"

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

type TiptapEditorProps = {
  content: unknown
  onUpdate: (content: unknown) => void
  placeholder?: string
  editable?: boolean
}

export function TiptapEditor({
  content,
  onUpdate,
  placeholder = "Add a description...",
  editable = true,
}: TiptapEditorProps) {
  const lastSetContentRef = useRef<string>("")
  const { extension: slashCommandExtension, renderDropdown: renderSlashDropdown } = useSlashCommand()
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const reuploadFromUrl = useAction(api.attachments.reuploadFromUrl)
  // Convex HTTP actions are served at .site instead of .cloud
  // See: https://docs.convex.dev/functions/http-actions#deploying
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".cloud", ".site")

  // ─── Convex image upload handler (used by ImageUploadNode) ────────────────
  // Returns a permanent public URL via HTTP action, not a temporary signed URL.
  const uploadHandler: UploadFunction = useCallback(
    async (file, onProgress, abortSignal) => {
      if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(`File size exceeds 10MB limit`)
      }

      onProgress?.({ progress: 10 })
      if (abortSignal?.aborted) throw new Error("Upload cancelled")

      const uploadUrl = await generateUploadUrl()
      onProgress?.({ progress: 30 })
      if (abortSignal?.aborted) throw new Error("Upload cancelled")

      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: abortSignal,
      })
      onProgress?.({ progress: 80 })

      const { storageId } = (await result.json()) as { storageId: string }

      // Build permanent URL via our HTTP action (never expires, cacheable)
      const imageUrl = `${convexSiteUrl}/image?id=${encodeURIComponent(storageId)}`

      onProgress?.({ progress: 100 })
      return imageUrl
    },
    [generateUploadUrl, convexSiteUrl],
  )
  const uploadHandlerRef = useRef(uploadHandler)
  uploadHandlerRef.current = uploadHandler
  const convexSiteUrlRef = useRef(convexSiteUrl)
  convexSiteUrlRef.current = convexSiteUrl
  const reuploadFromUrlRef = useRef(reuploadFromUrl)
  reuploadFromUrlRef.current = reuploadFromUrl

  // ─── Re-upload external images after paste ─────────────────────────────────
  // When pasting HTML from Notion/Google Docs, images point to external CDNs
  // that expire. This extension detects external image URLs after paste and
  // re-uploads them to Convex storage with permanent URLs.
  const imageReuploadExtension = useMemo(() => {
    const reuploadKey = new PluginKey("imageReupload")

    return Extension.create({
      name: "imageReupload",
      addProseMirrorPlugins() {
        const editorRef = this.editor
        return [
          new Plugin({
            key: reuploadKey,
            props: {
              handlePaste() {
                // Let the default paste happen first, then scan on next tick
                setTimeout(() => {
                  const { doc, tr } = editorRef.state
                  const replacements: Array<{ pos: number; node: typeof doc; src: string }> = []

                  doc.descendants((node, pos) => {
                    if (
                      node.type.name === "image" &&
                      node.attrs.src &&
                      !node.attrs.src.startsWith(convexSiteUrlRef.current) &&
                      !node.attrs.src.startsWith("data:")
                    ) {
                      replacements.push({ pos, node, src: node.attrs.src })
                    }
                  })

                  if (replacements.length === 0) return

                  // Re-upload each external image via server-side action (avoids CORS)
                  for (const { src } of replacements) {
                    void (async () => {
                      try {
                        const storageId = await reuploadFromUrlRef.current({ url: src })
                        const permanentUrl = `${convexSiteUrlRef.current}/image?id=${encodeURIComponent(storageId)}`

                        // Find the image node again (positions may have shifted)
                        let currentPos: number | null = null
                        editorRef.state.doc.descendants((n, p) => {
                          if (n.type.name === "image" && n.attrs.src === src && currentPos === null) {
                            currentPos = p
                            return false
                          }
                        })

                        if (currentPos !== null) {
                          editorRef.view.dispatch(
                            editorRef.state.tr.setNodeMarkup(currentPos, undefined, {
                              ...editorRef.state.doc.nodeAt(currentPos)?.attrs,
                              src: permanentUrl,
                            })
                          )
                        }
                      } catch {
                        // Silently fail — keep the original external URL
                      }
                    })()
                  }
                }, 100)

                // Return false to let the default paste behavior happen
                return false
              },
            },
          }),
        ]
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Mention support ────────────────────────────────────────────────────────
  const { orgMembers: members } = useTaskReferenceData()
  const [mentionState, setMentionState] = useState<MentionDropdownState | null>(null)
  const mentionKeyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)

  const mentionItems = useMemo<MentionSuggestion[]>(
    () => (members ?? []).map((m) => ({ id: m._id, label: m.name })),
    [members],
  )
  const mentionItemsRef = useRef(mentionItems)
  mentionItemsRef.current = mentionItems

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

  const extensions = useMemo(() => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline cursor-pointer" },
      }),
      Image.configure({ allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Highlight.configure({ multicolor: true }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: suggestionConfig.current,
      }),
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_IMAGE_SIZE,
        limit: 3,
        upload: (...args) => uploadHandlerRef.current(...args),
        onError: (error) => toastError(error, "Image upload failed"),
      }),
      FileHandler.configure({
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
        onDrop: (currentEditor, files, pos) => {
          const imageFiles = files.filter((f) => f.type.startsWith("image/"))
          if (imageFiles.length === 0) return
          const fileId = crypto.randomUUID()
          setPendingFiles(fileId, imageFiles)
          const insertPos = pos ?? currentEditor.state.selection.anchor
          currentEditor.chain().focus().insertContentAt(insertPos, {
            type: "imageUpload",
            attrs: { initialFileId: fileId },
          }).run()
        },
        onPaste: (currentEditor, files) => {
          const imageFiles = files.filter((f) => f.type.startsWith("image/"))
          if (imageFiles.length === 0) return
          const fileId = crypto.randomUUID()
          setPendingFiles(fileId, imageFiles)
          currentEditor.chain().focus().setImageUploadNode({ initialFileId: fileId }).run()
        },
      }),
      imageReuploadExtension,
      slashCommandExtension,
    // Extensions are created once — TipTap doesn't support swapping them after init.
    // Dynamic values (placeholder, mention items, upload handler) use refs or are
    // updated via editor API in separate useEffects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content as Record<string, unknown> | undefined,
    editable,
    editorProps: {
      attributes: {
        class: "tiptap-content focus:outline-none min-h-[80px] px-4 py-3 text-sm",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON()
      const serialized = JSON.stringify(json)
      // Skip if this update was triggered by our own setContent
      if (serialized === lastSetContentRef.current) return
      onUpdate(json)
    },
  })

  // Sync placeholder prop changes into the existing editor instance
  useEffect(() => {
    if (!editor) return
    const placeholderExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === "placeholder"
    )
    if (placeholderExt && placeholderExt.options.placeholder !== placeholder) {
      placeholderExt.options.placeholder = placeholder
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, placeholder])

  // Sync external content changes (e.g., real-time updates from other users)
  // setTimeout defers the ProseMirror transaction outside React's render cycle,
  // avoiding the flushSync-inside-lifecycle warning. emitUpdate: false prevents
  // our own onUpdate from firing and creating a feedback loop.
  useEffect(() => {
    if (!editor || !content) return
    const newJSON = JSON.stringify(content)
    const currentJSON = JSON.stringify(editor.getJSON())
    if (currentJSON !== newJSON) {
      lastSetContentRef.current = newJSON
      const handle = setTimeout(() => {
        editor.commands.setContent(content as Record<string, unknown>, { emitUpdate: false })
      }, 0)
      return () => clearTimeout(handle)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className="tiptap-editor rounded-lg border border-border/40 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/40 bg-muted/80 px-2 py-1">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
        >
          <BoldIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
        >
          <ItalicIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          aria-label="Underline"
        >
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
        >
          <StrikethroughIcon className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border/40" />

        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Bullet list"
        >
          <ListIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
        >
          <ListOrderedIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          aria-label="Task list"
        >
          <ListChecksIcon className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border/40" />

        <HeadingPopover editor={editor} />
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label="Quote"
        >
          <QuoteIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          aria-label="Code block"
        >
          <CodeIcon className="size-3.5" />
        </ToolbarButton>
        <LinkPopover editor={editor} />
        <HighlightPopover editor={editor} />
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().setImageUploadNode().run()}
          aria-label="Insert image"
        >
          <ImageIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          aria-label="Insert table"
        >
          <TableIcon className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border/40" />

        <ToolbarButton
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          aria-label="Align left"
        >
          <AlignLeftIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          aria-label="Align center"
        >
          <AlignCenterIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          aria-label="Align right"
        >
          <AlignRightIcon className="size-3.5" />
        </ToolbarButton>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* Bubble menu — floating toolbar on text selection */}
      <BubbleMenu
        editor={editor}
        updateDelay={100}
        shouldShow={() => {
          if (editor.state.selection.empty) return false
          if (editor.isActive("imageUpload") || editor.isActive("image")) return false
          return true
        }}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md">
          <HeadingPopover editor={editor} />
          <div className="mx-0.5 h-4 w-px bg-border/40" />
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <BoldIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <ItalicIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
          >
            <UnderlineIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strikethrough"
          >
            <StrikethroughIcon className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
            aria-label="Inline code"
          >
            <CodeIcon className="size-3.5" />
          </ToolbarButton>
          <div className="mx-0.5 h-4 w-px bg-border/40" />
          <HighlightPopover editor={editor} />
          <LinkPopover editor={editor} />
        </div>
      </BubbleMenu>

      {renderSlashDropdown()}
      {mentionState && (
        <MentionDropdown state={mentionState} onKeyDownRef={mentionKeyDownRef} />
      )}
    </div>
  )
}
