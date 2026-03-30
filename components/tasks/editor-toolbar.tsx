"use client"

import { useTiptap } from "@tiptap/react"
import { ToolbarButton } from "@/components/toolbar-button"
import { LinkPopover } from "@/components/tasks/link-popover"
import { HighlightPopover } from "@/components/tasks/highlight-popover"
import { HeadingPopover } from "@/components/tasks/heading-popover"
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

function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px bg-border/40" />
}

export function DescriptionToolbar() {
  const { editor } = useTiptap()

  if (!editor) return null

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border/40 bg-muted/80 px-2 py-1">
      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
        <BoldIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
        <ItalicIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline">
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
        <StrikethroughIcon className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
        <ListIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">
        <ListOrderedIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Task list">
        <ListChecksIcon className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <HeadingPopover />
      <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Quote">
        <QuoteIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label="Code block">
        <CodeIcon className="size-3.5" />
      </ToolbarButton>
      <LinkPopover />
      <HighlightPopover />
      <ToolbarButton active={false} onClick={() => editor.chain().focus().setImageUploadNode().run()} aria-label="Insert image">
        <ImageIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={false} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} aria-label="Insert table">
        <TableIcon className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} aria-label="Align left">
        <AlignLeftIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} aria-label="Align center">
        <AlignCenterIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} aria-label="Align right">
        <AlignRightIcon className="size-3.5" />
      </ToolbarButton>
    </div>
  )
}

export function BubbleToolbar() {
  const { editor } = useTiptap()

  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md">
      <HeadingPopover />
      <ToolbarDivider />
      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
        <BoldIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
        <ItalicIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline">
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
        <StrikethroughIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code">
        <CodeIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Task list">
        <ListChecksIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
        <ListIcon className="size-3.5" />
      </ToolbarButton>
      <HighlightPopover />
      <LinkPopover />
    </div>
  )
}

export function CommentToolbar() {
  const { editor } = useTiptap()

  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 bg-black/[0.06] dark:bg-white/[0.08] px-2.5 py-1.5">
      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
        <BoldIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
        <ItalicIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
        <StrikethroughIcon className="size-3.5" />
      </ToolbarButton>
      <LinkPopover />

      <ToolbarDivider />

      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
        <ListIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Ordered list">
        <ListOrderedIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Task list">
        <ListChecksIcon className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label="Code block">
        <CodeIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Blockquote">
        <QuoteIcon className="size-3.5" />
      </ToolbarButton>
    </div>
  )
}
