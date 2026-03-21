"use client"

import { useEffect, useRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Underline from "@tiptap/extension-underline"
import { ToolbarButton } from "@/components/toolbar-button"
import "./tiptap-editor.css"
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  ListIcon,
  ListOrderedIcon,
  Heading2Icon,
  CodeIcon,
  LinkIcon,
  ListChecksIcon,
  QuoteIcon,
} from "lucide-react"

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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
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
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
    ],
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

  // Sync external content changes (e.g., real-time updates from other users)
  useEffect(() => {
    if (!editor || !content) return
    const newJSON = JSON.stringify(content)
    const currentJSON = JSON.stringify(editor.getJSON())
    if (currentJSON !== newJSON) {
      lastSetContentRef.current = newJSON
      editor.commands.setContent(content as Record<string, unknown>)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className="tiptap-editor rounded-lg border border-border/40 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border/40 bg-muted/80 px-2 py-1">
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

        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label="Heading"
        >
          <Heading2Icon className="size-3.5" />
        </ToolbarButton>
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
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  )
}

