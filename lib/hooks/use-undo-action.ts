"use client"

import { useCallback, useRef } from "react"
import { toast } from "sonner"

type UndoActionOptions = {
  /** Action to execute after delay (the actual mutation) */
  action: () => Promise<void>
  /** Toast message shown during countdown */
  message: string
  /** Delay in ms before executing (default: 5000) */
  delay?: number
  /** Called immediately before the timer starts (optimistic UI) */
  onTrigger?: () => void
  /** Called if the action is undone */
  onUndo?: () => void
  /** Called if the action fails */
  onError?: (error: Error) => void
}

/**
 * Reusable hook for delayed actions with an undo toast (sonner).
 *
 * Flow:
 * 1. `trigger()` → runs `onTrigger` (optimistic removal), shows undo toast
 * 2. After `delay` ms → executes `action` (the actual mutation)
 * 3. If user clicks "Undo" → cancels, runs `onUndo` (revert optimistic state)
 * 4. If `action` throws → runs `onError`, shows error toast
 */
export function useUndoAction() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trigger = useCallback(
    ({ action, message, delay = 5000, onTrigger, onUndo, onError }: UndoActionOptions) => {
      // Cancel any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      // Optimistic UI update
      onTrigger?.()

      // Show undo toast
      toast(message, {
        duration: delay,
        action: {
          label: "Undo",
          onClick: () => {
            if (timerRef.current) {
              clearTimeout(timerRef.current)
              timerRef.current = null
            }
            onUndo?.()
          },
        },
      })

      // Schedule the actual mutation
      timerRef.current = setTimeout(async () => {
        timerRef.current = null
        try {
          await action()
        } catch (err) {
          const error = err instanceof Error ? err : new Error("Action failed")
          onUndo?.() // Revert optimistic state on error
          onError?.(error)
          toast.error(error.message)
        }
      }, delay)
    },
    [],
  )

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return { trigger, cancel }
}
