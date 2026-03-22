"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { cn } from "@/lib/utils"
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

// ─── Dropdown state type ─────────────────────────────────────────────────────

export interface SlashCommandDropdownState {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

// ─── Dropdown component ──────────────────────────────────────────────────────

const DROPDOWN_OFFSET = 4

export function SlashCommandDropdown({
  state,
  onKeyDownRef,
}: {
  state: SlashCommandDropdownState
  onKeyDownRef: React.MutableRefObject<((e: SuggestionKeyDownProps) => boolean) | null>
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { items, command, clientRect } = state
  const listRef = useRef<HTMLDivElement>(null)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const commandRef = useRef(command)
  commandRef.current = command

  useEffect(() => setSelectedIndex(0), [items])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  useEffect(() => {
    onKeyDownRef.current = ({ event }: SuggestionKeyDownProps) => {
      const currentItems = itemsRef.current
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + currentItems.length - 1) % currentItems.length)
        return true
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % currentItems.length)
        return true
      }
      if (event.key === "Enter") {
        const item = currentItems[selectedIndexRef.current]
        if (item) commandRef.current(item)
        return true
      }
      if (event.key === "Escape") {
        return true
      }
      return false
    }
    return () => { onKeyDownRef.current = null }
  }, [onKeyDownRef])

  if (items.length === 0) return null

  const rect = clientRect?.()
  if (!rect) return null

  return (
    <div
      ref={listRef}
      role="listbox"
      className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ top: rect.bottom + DROPDOWN_OFFSET, left: rect.left, minWidth: 220 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            tabIndex={-1}
            onClick={() => commandRef.current(item)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent/50",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Extension factory ───────────────────────────────────────────────────────

export function createSlashCommandExtension({
  onStart,
  onUpdate,
  onKeyDown,
  onExit,
}: {
  onStart: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => void
  onUpdate: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
}) {
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
            onStart: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => onStart(props),
            onUpdate: (props: { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; clientRect?: (() => DOMRect | null) | null }) => onUpdate(props),
            onKeyDown: (props: SuggestionKeyDownProps) => onKeyDown(props),
            onExit: () => onExit(),
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
}

// ─── Hook for easy integration ───────────────────────────────────────────────

export function useSlashCommand() {
  const [slashState, setSlashState] = useState<SlashCommandDropdownState | null>(null)
  const slashKeyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)

  const extension = useRef(
    createSlashCommandExtension({
      onStart: (props) => {
        setSlashState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
      },
      onUpdate: (props) => {
        setSlashState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
      },
      onKeyDown: (props) => {
        return slashKeyDownRef.current?.(props) ?? false
      },
      onExit: () => {
        setSlashState(null)
      },
    }),
  ).current

  const renderDropdown = useCallback(() => {
    if (!slashState) return null
    return <SlashCommandDropdown state={slashState} onKeyDownRef={slashKeyDownRef} />
  }, [slashState])

  return { extension, renderDropdown }
}
