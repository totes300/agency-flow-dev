"use client"

import { useEffect, useRef, useMemo, useCallback } from "react"
import { Tiptap, useEditor } from "@tiptap/react"
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
import { DescriptionToolbar, BubbleToolbar } from "@/components/tasks/editor-toolbar"
import { useSlashCommand } from "@/components/tasks/slash-command"
import { useMentionSuggestion } from "@/components/tasks/use-mention-suggestion"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import "./tiptap-editor.css"

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

type TiptapEditorProps = {
  content: unknown
  onUpdate: (content: unknown) => void
  placeholder?: string
  editable?: boolean
  variant?: "default" | "document"
}

export function TiptapEditor({
  content,
  onUpdate,
  placeholder = "Add a description...",
  editable = true,
  variant = "default",
}: TiptapEditorProps) {
  const { slashExtension, renderSlashDropdown } = useSlashCommand()
  const { mentionExtension, renderMentionDropdown } = useMentionSuggestion()
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const reuploadFromUrl = useAction(api.attachments.reuploadFromUrl)
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".cloud", ".site")

  // ─── Image upload handler ────────────────────────────────────────────────
  const uploadHandler: UploadFunction = useCallback(
    async (file, onProgress, abortSignal) => {
      if (file.size > MAX_IMAGE_SIZE) throw new Error("File size exceeds 10MB limit")

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

  // ─── Re-upload external images after paste ───────────────────────────────
  const imageReuploadExtension = useMemo(() => {
    const reuploadKey = new PluginKey("imageReupload")

    return Extension.create({
      name: "imageReupload",
      addProseMirrorPlugins() {
        const editorInstance = this.editor
        return [
          new Plugin({
            key: reuploadKey,
            props: {
              handlePaste() {
                setTimeout(async () => {
                  const { doc } = editorInstance.state
                  const externalImages: string[] = []

                  doc.descendants((node) => {
                    if (
                      node.type.name === "image" &&
                      node.attrs.src &&
                      !node.attrs.src.startsWith(convexSiteUrlRef.current) &&
                      !node.attrs.src.startsWith("data:")
                    ) {
                      externalImages.push(node.attrs.src)
                    }
                  })

                  // Process sequentially to avoid transaction conflicts
                  for (const src of externalImages) {
                    try {
                      const storageId = await reuploadFromUrlRef.current({ url: src })
                      const permanentUrl = `${convexSiteUrlRef.current}/image?id=${encodeURIComponent(storageId)}`

                      let targetPos: number | null = null
                      editorInstance.state.doc.descendants((n, p) => {
                        if (n.type.name === "image" && n.attrs.src === src && targetPos === null) {
                          targetPos = p
                          return false
                        }
                      })

                      if (targetPos !== null) {
                        editorInstance.view.dispatch(
                          editorInstance.state.tr.setNodeMarkup(targetPos, undefined, {
                            ...editorInstance.state.doc.nodeAt(targetPos)?.attrs,
                            src: permanentUrl,
                          }),
                        )
                      }
                    } catch {
                      // Keep the original external URL
                    }
                  }
                }, 0)

                return false
              },
            },
          }),
        ]
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Extensions ──────────────────────────────────────────────────────────
  const extensions = useMemo(
    () => [
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
      Table.configure({ resizable: true, renderWrapper: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Highlight.configure({ multicolor: true }),
      mentionExtension,
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
      slashExtension,
    ],
    // Extensions are created once — dynamic values use refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content as Record<string, unknown> | undefined,
    editable,
    editorProps: {
      attributes: {
        class: cn(
          "tiptap-content focus:outline-none",
          variant === "document" ? "min-h-[220px] py-3" : "min-h-[80px] px-4 py-3",
        ),
      },
    },
    onUpdate: ({ editor: ed }) => {
      onUpdate(ed.getJSON())
    },
  })

  // Sync external content changes (e.g., real-time updates from other users).
  // emitUpdate: false prevents our onUpdate from firing and creating a loop.
  // setTimeout defers the transaction outside React's render cycle.
  useEffect(() => {
    if (!editor || !content) return
    const incoming = JSON.stringify(content)
    const current = JSON.stringify(editor.getJSON())
    if (current !== incoming) {
      const handle = setTimeout(() => {
        editor.commands.setContent(content as Record<string, unknown>, { emitUpdate: false })
      }, 0)
      return () => clearTimeout(handle)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <Tiptap editor={editor}>
      <div
        data-variant={variant}
        className={cn(
          "tiptap-editor overflow-hidden",
          variant === "document"
            ? "bg-background"
            : "rounded-lg border border-border/40",
        )}
      >
        {variant !== "document" && <DescriptionToolbar />}

        <Tiptap.Content />

        <BubbleMenu
          updateDelay={100}
          shouldShow={() => {
            if (editor.state.selection.empty) return false
            if (editor.isActive("imageUpload") || editor.isActive("image")) return false
            return true
          }}
        >
          <BubbleToolbar />
        </BubbleMenu>

        {renderSlashDropdown()}
        {renderMentionDropdown()}
      </div>
    </Tiptap>
  )
}
