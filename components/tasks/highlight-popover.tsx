"use client"

import { useState } from "react"
import { useTiptap } from "@tiptap/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToolbarButton } from "@/components/toolbar-button"
import { HighlighterIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const HIGHLIGHT_COLORS = [
  { name: "Yellow", color: "#fef08a" },
  { name: "Green", color: "#bbf7d0" },
  { name: "Blue", color: "#bfdbfe" },
  { name: "Purple", color: "#e9d5ff" },
  { name: "Pink", color: "#fbcfe8" },
  { name: "Orange", color: "#fed7aa" },
  { name: "Red", color: "#fecaca" },
  { name: "Cyan", color: "#a5f3fc" },
] as const

export function HighlightPopover() {
  const { editor } = useTiptap()
  const [open, setOpen] = useState(false)

  const isActive = editor.isActive("highlight")
  const currentColor = editor.getAttributes("highlight").color as string | undefined

  function applyHighlight(color: string) {
    editor.chain().focus().toggleHighlight({ color }).run()
    setOpen(false)
  }

  function removeHighlight() {
    editor.chain().focus().unsetHighlight().run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarButton
          active={isActive}
          onClick={() => {}}
          aria-label="Highlight"
          style={
            isActive && currentColor
              ? { borderBottom: `2px solid ${currentColor}` }
              : undefined
          }
        >
          <HighlighterIcon className="size-3.5" />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1">
          {HIGHLIGHT_COLORS.map(({ name, color }) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => applyHighlight(color)}
              className={cn(
                "size-6 rounded-md border transition-all hover:scale-110",
                currentColor === color
                  ? "border-foreground ring-1 ring-foreground/20"
                  : "border-transparent",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
          {isActive && (
            <>
              <div className="mx-0.5 h-4 w-px bg-border/40" />
              <button
                type="button"
                title="Remove highlight"
                onClick={removeHighlight}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <XIcon className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
