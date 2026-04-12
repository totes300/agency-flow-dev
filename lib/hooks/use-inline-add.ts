"use client"

import { useState, useRef, useEffect, useCallback } from "react"

/**
 * Shared hook for the "+ Add task…" inline-add pattern.
 *
 * Handles: active/inactive toggle, title state, auto-focus,
 * Enter → submit, Escape → deactivate, blur-with-delay, rapid-fire.
 */
export function useInlineAdd(onSubmit: (title: string) => void) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const closingRef = useRef(false)

  // Auto-focus when activated
  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  const activate = useCallback(() => {
    closingRef.current = false
    setActive(true)
  }, [])

  const deactivate = useCallback(() => {
    setTitle("")
    setActive(false)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      const trimmed = title.trim()
      if (!trimmed) return
      setTitle("")
      onSubmit(trimmed)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else if (e.key === "Escape") {
      deactivate()
    }
  }

  function handleBlur() {
    closingRef.current = true
    setTimeout(() => {
      if (closingRef.current && !title.trim()) {
        deactivate()
      }
      closingRef.current = false
    }, 150)
  }

  return {
    active,
    title,
    setTitle,
    inputRef,
    activate,
    deactivate,
    handleKeyDown,
    handleBlur,
  }
}
