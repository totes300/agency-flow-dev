"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToolbarButton } from "@/components/toolbar-button"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Editor } from "@tiptap/react"

const HEADING_OPTIONS = [
  { level: 0, label: "Paragraph" },
  { level: 1, label: "Heading 1" },
  { level: 2, label: "Heading 2" },
  { level: 3, label: "Heading 3" },
] as const

function getActiveLevel(editor: Editor): number {
  for (const { level } of HEADING_OPTIONS) {
    if (level > 0 && editor.isActive("heading", { level })) return level
  }
  return 0
}

function getLabel(level: number): string {
  return HEADING_OPTIONS.find((o) => o.level === level)?.label ?? "Paragraph"
}

export function HeadingPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const activeLevel = getActiveLevel(editor)

  function applyHeading(level: number) {
    if (level === 0) {
      editor.chain().focus().setParagraph().run()
    } else {
      editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            open && "bg-muted text-foreground",
          )}
        >
          <span className="min-w-[4.5rem]">{getLabel(activeLevel)}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-40 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {HEADING_OPTIONS.map(({ level, label }) => (
          <button
            key={level}
            type="button"
            onClick={() => applyHeading(level)}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors",
              activeLevel === level
                ? "text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {label}
            {activeLevel === level && <CheckIcon className="size-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
