"use client"

import { useState, useRef, useCallback, useMemo } from "react"
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { SuggestionDropdown } from "@/components/tasks/suggestion-dropdown"
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListChecksIcon,
  QuoteIcon,
  CodeIcon,
  MinusIcon,
  TextIcon,
  TableIcon,
  ImageIcon,
} from "lucide-react"
import type { Editor, Range } from "@tiptap/core"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"

// ─── Slash command items ─────────────────────────────────────────────────────

export interface SlashCommandItem {
  title: string
  description: string
  icon: React.FC<{ className?: string }>
  command: (editor: Editor, range: Range) => void
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: "Text",
    description: "Plain text paragraph",
    icon: TextIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().scrollIntoView().run()
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: Heading1Icon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).scrollIntoView().run()
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: Heading2Icon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).scrollIntoView().run()
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: Heading3Icon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).scrollIntoView().run()
    },
  },
  {
    title: "Bullet List",
    description: "Unordered list of items",
    icon: ListIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().scrollIntoView().run()
    },
  },
  {
    title: "Numbered List",
    description: "Ordered list of items",
    icon: ListOrderedIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().scrollIntoView().run()
    },
  },
  {
    title: "Task List",
    description: "Checklist with checkboxes",
    icon: ListChecksIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().scrollIntoView().run()
    },
  },
  {
    title: "Quote",
    description: "Blockquote for callouts",
    icon: QuoteIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().scrollIntoView().run()
    },
  },
  {
    title: "Code Block",
    description: "Fenced code snippet",
    icon: CodeIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().scrollIntoView().run()
    },
  },
  {
    title: "Image",
    description: "Upload or drag an image",
    icon: ImageIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setImageUploadNode().scrollIntoView().run()
    },
  },
  {
    title: "Table",
    description: "Insert a table with header row",
    icon: TableIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).scrollIntoView().run()
    },
  },
  {
    title: "Divider",
    description: "Horizontal separator line",
    icon: MinusIcon,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().scrollIntoView().run()
    },
  },
]

// ─── Slash command state type ───────────────────────────────────────────────

interface SlashCommandState {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

// ─── Slash command item renderer ────────────────────────────────────────────

function SlashCommandItemContent({ item }: { item: SlashCommandItem }) {
  const Icon = item.icon
  return (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{item.title}</div>
        <div className="text-xs text-muted-foreground">{item.description}</div>
      </div>
    </>
  )
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSlashCommand() {
  const [state, setState] = useState<SlashCommandState | null>(null)
  const keyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)

  const extension = useMemo(() => {
    return Extension.create({
      name: "slashCommand",

      addOptions() {
        return {
          suggestion: {
            char: "/",
            startOfLine: false,
            items: ({ query }: { query: string }) => {
              const q = query.toLowerCase()
              return SLASH_COMMANDS.filter(
                (item) =>
                  item.title.toLowerCase().includes(q) ||
                  item.description.toLowerCase().includes(q),
              )
            },
            command: ({ editor, range, props: item }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
              item.command(editor, range)
            },
            render: () => ({
              onStart: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
                setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
              },
              onUpdate: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
                setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
              },
              onKeyDown: (props: SuggestionKeyDownProps) => keyDownRef.current?.(props) ?? false,
              onExit: () => setState(null),
            }),
          },
        }
      },

      addProseMirrorPlugins() {
        return [
          Suggestion({
            editor: this.editor,
            ...this.options.suggestion,
          }),
        ]
      },
    })
  }, [])

  const renderSlashDropdown = useCallback(() => {
    if (!state) return null
    return (
      <SuggestionDropdown
        items={state.items}
        onSelect={state.command}
        clientRect={state.clientRect}
        onKeyDownRef={keyDownRef}
        renderItem={(item) => <SlashCommandItemContent item={item} />}
        keyExtractor={(item) => item.title}
        itemClassName="gap-2.5 px-2.5 py-2"
      />
    )
  }, [state])

  return { slashExtension: extension, renderSlashDropdown }
}
