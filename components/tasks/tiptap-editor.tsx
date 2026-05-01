"use client"

import { useEffect, useRef, useMemo, useCallback, useState } from "react"
import { Tiptap, useEditor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import { TiptapLightbox, type LightboxImage } from "@/components/tasks/tiptap-lightbox"
import { useMutation, useAction } from "convex/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import { Markdown } from "@tiptap/markdown"
import { PortableTaskList, PortableTaskItem } from "@/components/tasks/portable-task-list"
import { MarkdownClipboard } from "@/components/tasks/markdown-clipboard"
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
  autoFocus?: boolean
  variant?: "default" | "document"
}

export function TiptapEditor({
  content,
  onUpdate,
  placeholder = "Add a description...",
  editable = true,
  autoFocus = false,
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
              handlePaste(_view, event) {
                // Collect clipboard image files (available when pasting from Gmail, etc.)
                const clipboardFiles: File[] = []
                if (event.clipboardData) {
                  for (let i = 0; i < event.clipboardData.files.length; i++) {
                    const file = event.clipboardData.files[i]
                    if (file.type.startsWith("image/")) {
                      clipboardFiles.push(file)
                    }
                  }
                }

                setTimeout(async () => {
                  const { doc } = editorInstance.state
                  const externalImages: { src: string; pos: number }[] = []

                  doc.descendants((node, pos) => {
                    if (
                      node.type.name === "image" &&
                      node.attrs.src &&
                      !node.attrs.src.startsWith(convexSiteUrlRef.current) &&
                      !node.attrs.src.startsWith("data:") &&
                      !node.attrs.src.startsWith("blob:")
                    ) {
                      externalImages.push({ src: node.attrs.src, pos })
                    }
                  })

                  if (externalImages.length === 0) return

                  // If we have clipboard image files, upload them directly.
                  if (clipboardFiles.length > 0) {
                    for (let i = 0; i < externalImages.length && i < clipboardFiles.length; i++) {
                      try {
                        const permanentUrl = await uploadHandlerRef.current(clipboardFiles[i])
                        const srcToFind = externalImages[i].src

                        let targetPos: number | null = null
                        editorInstance.state.doc.descendants((n, p) => {
                          if (n.type.name === "image" && n.attrs.src === srcToFind && targetPos === null) {
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
                        // Keep the original URL
                      }
                    }
                    return
                  }

                  // No clipboard files — try server-side re-upload.
                  // Returns null for auth-walled / non-image URLs instead of throwing.
                  for (const { src } of externalImages) {
                    const storageId = await reuploadFromUrlRef.current({ url: src })
                    if (!storageId) continue // Could not fetch — keep original URL

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
                  }
                }, 0)

                return false
              },
            },
          }),
        ]
      },
    })
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
      Image.configure({
        allowBase64: true,
        resize: {
          enabled: true,
          directions: ["left", "right"],
          minWidth: 80,
          minHeight: 40,
          alwaysPreserveAspectRatio: true,
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PortableTaskList,
      PortableTaskItem.configure({ nested: true }),
      Markdown,
      MarkdownClipboard,
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

  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

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
      onUpdateRef.current(ed.getJSON())
    },
  }, [extensions])

  // Sync external content changes (date switch, edits from another tab, etc.).
  // Tiptap is an uncontrolled editor — `content` only takes effect on mount.
  // We re-apply when the prop diverges, but ONLY while the editor is unfocused.
  // While focused, the user is the source of truth: applying a stale server
  // echo here would clobber unsaved keystrokes and reset the ProseMirror
  // selection (causing typed text to land outside the current node).
  // emitUpdate: false prevents our onUpdate from firing and creating a loop.
  useEffect(() => {
    if (!editor || !content) return
    if (editor.isFocused) return
    const incoming = JSON.stringify(content)
    const current = JSON.stringify(editor.getJSON())
    if (current === incoming) return
    const handle = setTimeout(() => {
      editor.commands.setContent(content as Record<string, unknown>, { emitUpdate: false })
    }, 0)
    return () => clearTimeout(handle)
  }, [content, editor])

  // Keep editable state in sync when prop changes after creation.
  // emitUpdate: false — TipTap's setEditable defaults to firing a fake
  // "update" event even though no doc change occurred. That event would
  // serialize the current (potentially empty, mid-load) doc through our
  // onUpdate handler and trigger a destructive save. The flag toggle is
  // not a content change; it must not emit update.
  useEffect(() => {
    if (editor) editor.setEditable(editable, false)
  }, [editor, editable])

  // Auto-focus when requested
  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus()
  }, [autoFocus, editor])

  // ─── Image lightbox ──────────────────────────────────────────────────────
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number; slides: LightboxImage[] }>(
    { open: false, index: 0, slides: [] },
  )

  const handleContentClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editor) return
      const target = event.target as HTMLElement | null
      if (!target) return
      // Only intercept direct clicks on rendered images inside content.
      // Skip uploads-in-progress (image-upload node renders a wrapper, not <img>),
      // skip images inside an `imageUpload` node, and skip modifier-clicks (Cmd/Ctrl)
      // so the user can still open in a new tab.
      if (target.tagName !== "IMG") return
      if (target.closest('[data-type="imageUpload"]')) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const clickedSrc = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src
      if (!clickedSrc) return

      const collected: LightboxImage[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image" && typeof node.attrs.src === "string" && node.attrs.src) {
          collected.push({ src: node.attrs.src, alt: node.attrs.alt ?? undefined })
        }
      })
      if (collected.length === 0) return

      const startIndex = Math.max(
        0,
        collected.findIndex((s) => s.src === clickedSrc),
      )
      event.preventDefault()
      setLightbox({ open: true, index: startIndex, slides: collected })
    },
    [editor],
  )

  if (!editor) return null

  return (
    <Tiptap instance={editor}>
      <div
        data-variant={variant}
        onClick={(e) => {
          // Empty/below-content click anywhere in the document zone focuses the editor
          // at the end. Clicks inside rendered content bubble through their own targets,
          // so this only fires for the surrounding empty space.
          if (variant !== "document") return
          if (e.target !== e.currentTarget) return
          editor.commands.focus("end")
        }}
        className={cn(
          "tiptap-editor overflow-hidden",
          variant === "document"
            ? "bg-background min-h-[180px] cursor-text"
            : "rounded-lg border border-border/40",
        )}
      >
        {variant !== "document" && <DescriptionToolbar />}

        <div onClick={handleContentClick}>
          <Tiptap.Content />
        </div>

        <TiptapLightbox
          open={lightbox.open}
          index={lightbox.index}
          slides={lightbox.slides}
          onClose={() => setLightbox((prev) => ({ ...prev, open: false }))}
        />

        <BubbleMenu
          updateDelay={100}
          shouldShow={({ view, state }) => {
            if (!view.hasFocus()) return false
            if (state.selection.empty) return false
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
