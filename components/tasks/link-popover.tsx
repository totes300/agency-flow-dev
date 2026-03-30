"use client"

import { useState, useRef, useEffect } from "react"
import { useTiptap } from "@tiptap/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToolbarButton } from "@/components/toolbar-button"
import { LinkIcon, CheckIcon, XIcon } from "lucide-react"

export function LinkPopover() {
  const { editor } = useTiptap()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const isActive = editor.isActive("link")

  useEffect(() => {
    if (open && inputRef.current) {
      const attrs = editor.getAttributes("link")
      setUrl(attrs.href ?? "")
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [open, editor])

  function handleApply() {
    const trimmed = url.trim()
    if (trimmed) {
      const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      editor.chain().focus().setLink({ href }).run()
    }
    setOpen(false)
    setUrl("")
  }

  function handleRemove() {
    editor.chain().focus().unsetLink().run()
    setOpen(false)
    setUrl("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarButton
          active={isActive}
          onClick={() => {
            if (isActive && !open) setOpen(true)
          }}
          aria-label="Link"
        >
          <LinkIcon className="size-3.5" />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); handleApply() }}
          className="flex items-center gap-1.5"
        >
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/40"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false)
                editor.commands.focus()
              }
            }}
          />
          <button
            type="submit"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <CheckIcon className="size-3.5" />
          </button>
          {isActive && (
            <button
              type="button"
              onClick={handleRemove}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
