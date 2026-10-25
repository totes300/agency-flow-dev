"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CloseNavIcon, SearchNavIcon } from "@/components/icons/nav-icons"

export type SearchBoxHandle = { focus: () => void }

/** URL writes are debounced so typing does not replace history per keystroke. */
const DEBOUNCE_MS = 150

type SearchBoxProps = {
  value: string
  onChange: (value: string) => void
  label?: string
  /** Key that focuses the box, shown in the button's tooltip; pass it only where the shortcut is wired. */
  shortcut?: string
}

/**
 * Title search for the task view (the old /tasks search box, `/` focuses it)
 * and the directory lists. Collapsed to a round icon button until used;
 * filters the loaded rows. Esc clears and closes it.
 */
export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(
  function SearchBox({ value, onChange, label = "Search tasks", shortcut }, ref) {
    const [draft, setDraft] = useState(value)
    const [open, setOpen] = useState(value !== "")
    const inputRef = useRef<HTMLInputElement>(null)

    // The URL is the source of truth (view switches clear it).
    const [lastValue, setLastValue] = useState(value)
    if (value !== lastValue) {
      setLastValue(value)
      setDraft(value)
      if (value !== "") setOpen(true)
    }

    useEffect(() => {
      if (draft === value) return
      const timer = setTimeout(() => onChange(draft), DEBOUNCE_MS)
      return () => clearTimeout(timer)
    }, [draft, onChange, value])

    useImperativeHandle(ref, () => ({
      focus: () => {
        setOpen(true)
        requestAnimationFrame(() => inputRef.current?.focus())
      },
    }))

    if (!open) {
      return (
        <Button
          variant="outline"
          size="icon-sm"
          className="rounded-full"
          aria-label={label}
          title={shortcut ? `${label} (${shortcut})` : label}
          onClick={() => {
            setOpen(true)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          <SearchNavIcon />
        </Button>
      )
    }

    return (
      <div className="relative flex w-52 items-center">
        <SearchNavIcon size={14} className="pointer-events-none absolute left-2.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          value={draft}
          placeholder={label}
          aria-label={label}
          className="h-7 pr-7 pl-8 text-[13px]"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft === "") setOpen(false) }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              setDraft("")
              onChange("")
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
        {draft ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 text-muted-foreground"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft("")
              onChange("")
              inputRef.current?.focus()
            }}
          >
            <CloseNavIcon size={12} />
          </Button>
        ) : null}
      </div>
    )
  },
)
