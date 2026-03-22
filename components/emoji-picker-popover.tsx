"use client"

import { ReactNode, useState } from "react"
import dynamic from "next/dynamic"
import data from "@emoji-mart/data"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

const Picker = dynamic(() => import("@emoji-mart/react").then(m => m.default), {
  ssr: false,
})

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
        <Picker
          data={data}
          perLine={8}
          theme="auto"
          skinTonePosition="none"
          onEmojiSelect={(emoji: { native: string }) => {
            onSelect(emoji.native)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
