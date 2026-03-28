"use client"

import { ReactNode, useEffect, useRef, useState } from "react"
import data from "@emoji-mart/data"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

interface EmojiMartEmoji {
  native: string
}

function EmojiPicker({
  onEmojiSelect,
}: {
  onEmojiSelect: (emoji: EmojiMartEmoji) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    let pickerElement: HTMLElement | null = null

    void import("emoji-mart").then(({ Picker }) => {
      if (!active || !containerRef.current) return

      pickerElement = new Picker({
        data,
        perLine: 8,
        theme: "auto",
        skinTonePosition: "none",
        onEmojiSelect,
      }) as unknown as HTMLElement

      containerRef.current.replaceChildren(pickerElement)
    })

    return () => {
      active = false
      pickerElement?.remove()
    }
  }, [onEmojiSelect])

  return <div ref={containerRef} />
}

interface EmojiPickerPopoverProps {
  onSelect: (emoji: string) => void
  children: ReactNode
  disabled?: boolean
}

export function EmojiPickerPopover({
  onSelect,
  children,
  disabled,
}: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="w-auto p-0 border-0 shadow-lg"
      >
        <EmojiPicker
          onEmojiSelect={(emoji: { native: string }) => {
            onSelect(emoji.native)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
