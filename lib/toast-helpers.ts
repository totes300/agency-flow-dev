import { toast } from "sonner"
import { ConvexError } from "convex/values"

/** Extract a user-friendly message from a ConvexError or standard Error. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : fallback
  }
  if (err instanceof Error) {
    return err.message
  }
  return fallback
}

/** Show a toast error, extracting clean messages from ConvexError. */
export function toastError(err: unknown, fallback: string): void {
  toast.error(extractErrorMessage(err, fallback))
}

/** Shape returned by tasks.archive / carried by bulk archive results. */
export type TimerRescueResult = {
  autoSavedTimers?: Array<{ userName: string; minutes: number }>
  timerSaveFailures?: Array<{ userName: string; reason: string }>
} | null | undefined

/**
 * Success toast for archive actions that may have rescued running timers.
 * Nothing about the rescue is silent: saved time is named per person, and a
 * timer that COULDN'T be saved (e.g. missing rate) is called out as still
 * running.
 */
export function toastArchiveSuccess(result: TimerRescueResult, baseMessage: string): void {
  const saved = result?.autoSavedTimers ?? []
  const failed = result?.timerSaveFailures ?? []

  if (saved.length > 0) {
    const detail = saved
      .map((s) => `${s.userName}'s running timer (${formatSavedMinutes(s.minutes)})`)
      .join(", ")
    toast.success(`${baseMessage} — saved ${detail} as a time entry`)
  } else {
    toast.success(baseMessage)
  }

  for (const f of failed) {
    toast.warning(
      `${f.userName}'s timer couldn't be auto-saved (${f.reason}) — it keeps running so nothing is lost.`,
    )
  }
}

function formatSavedMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
