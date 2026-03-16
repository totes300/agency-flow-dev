"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"

type UndoActionOptions = {
  /** Unique key for this action (e.g., entity ID). Allows concurrent undo timers. */
  key: string
  /** Action to execute after delay (the actual mutation) */
  action: () => Promise<void>
  /** Toast message shown during countdown */
  message: string
  /** Delay in ms before executing (default: 5000) */
  delay?: number
  /** Called if the action is undone */
  onUndo?: () => void
  /** Called if the action fails */
  onError?: (error: Error) => void
}

/**
 * Reusable hook for delayed actions with an undo toast (sonner).
 * Supports multiple concurrent undo timers keyed by entity ID.
 *
 * Flow:
 * 1. `trigger()` → shows undo toast, starts timer
 * 2. After `delay` ms → executes `action` (the actual mutation)
 * 3. If user clicks "Undo" → cancels that specific timer, runs `onUndo`
 * 4. If `action` throws → runs `onUndo` + `onError`, shows error toast
 */
export function useUndoAction() {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const trigger = useCallback(
    ({ key, action, message, delay = 5000, onUndo, onError }: UndoActionOptions) => {
      // Cancel existing timer for this key (re-archive same item)
      const existing = timersRef.current.get(key)
      if (existing) {
        clearTimeout(existing)
        timersRef.current.delete(key)
      }

      // Show undo toast
      toast(message, {
        id: `undo-${key}`,
        duration: delay,
        action: {
          label: "Undo",
          onClick: () => {
            const timer = timersRef.current.get(key)
            if (timer) {
              clearTimeout(timer)
              timersRef.current.delete(key)
            }
            onUndo?.()
          },
        },
      })

      // Schedule the actual mutation
      const timer = setTimeout(async () => {
        timersRef.current.delete(key)
        try {
          await action()
        } catch (err) {
          const error = err instanceof Error ? err : new Error("Action failed")
          onUndo?.()
          onError?.(error)
          toast.error(error.message)
        }
      }, delay)

      timersRef.current.set(key, timer)
    },
    [],
  )

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  const cancel = useCallback((key?: string) => {
    if (key) {
      const timer = timersRef.current.get(key)
      if (timer) {
        clearTimeout(timer)
        timersRef.current.delete(key)
      }
    } else {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  return { trigger, cancel }
}
