/**
 * Worksheet export toast lifecycle. One helper, used by every surface that
 * triggers an export (dropdown menu items + ad-hoc dialog), so they speak
 * with one voice and look identical.
 *
 * # The lifecycle
 *
 * Implements the Stripe / Vercel / Linear pattern: a single toast that
 * transitions loading → success / warning / error in place. The toast id
 * is stable across the transition, so visually it's one element shifting
 * state, not two stacked toasts.
 *
 *   1. `runExportWithToast({ run })` — fires a loading toast immediately,
 *      then awaits the action.
 *   2. On resolve: replaces the loading toast with the appropriate
 *      success / warning / error variant based on `stats`.
 *   3. On reject: replaces with an error toast carrying the thrown message
 *      (already sanitized server-side via ConvexError).
 *
 * # Outcome variants
 *
 *   success — every AI call succeeded OR no AI was needed
 *     duration: default (~4s)
 *
 *   warning — some AI calls failed (rows carry "[summary unavailable]")
 *     duration: 8s so admins can read the count
 *
 *   error (terminal-AI-failure) — every AI attempt failed but the CSV
 *     still downloaded with deterministic fallback text. Rare; happens
 *     when the API key is revoked mid-export or every call rate-limits.
 *     duration: 10s
 *
 *   error (action-thrown) — no key, encryption broken, no entries.
 *     duration: default
 */

import { toast } from "sonner"
import { extractErrorMessage } from "@/lib/toast-helpers"

/** Mirror of `WorksheetStats` from the Convex action return. */
export type WorksheetToastStats = {
  total: number
  aiSucceeded: number
  aiSkipped: number
  aiFailed: number
}

export type WorksheetExportResult = {
  csv: string
  filename: string
  stats: WorksheetToastStats
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/**
 * Build the appropriate toast contents from a successful action result.
 * Pure — separated from `runExportWithToast` so it's directly testable.
 */
export function buildCompletionToast(
  stats: WorksheetToastStats,
  filename: string,
):
  | { variant: "success"; title: string; description: string; duration?: number }
  | { variant: "warning"; title: string; description: string; duration: number }
  | { variant: "error"; title: string; description: string; duration: number } {
  const attempted = stats.aiSucceeded + stats.aiFailed

  // Every attempted AI call failed → loud error variant, CSV still on disk.
  if (attempted > 0 && stats.aiSucceeded === 0) {
    return {
      variant: "error",
      title: "Worksheet downloaded — every AI summary failed",
      description: `${stats.aiFailed} ${pluralize(stats.aiFailed, "row was", "rows were")} marked "[summary unavailable]". Check Convex logs, or test the API key in Settings → Integrations.`,
      duration: 10_000,
    }
  }

  // Some failures → warning. Spell out the count so the user knows how
  // many rows to scan for the fallback marker.
  if (stats.aiFailed > 0) {
    return {
      variant: "warning",
      title: `${stats.aiSucceeded} of ${attempted} summaries generated`,
      description: `${stats.aiFailed} failed ${pluralize(stats.aiFailed, "row is", "rows are")} marked "[summary unavailable]" in ${filename}.`,
      duration: 8_000,
    }
  }

  // Pure success — distinguish "AI did real work" from "every task had
  // empty content so AI was skipped." Both are happy paths; the message
  // is honest about which one ran.
  if (stats.aiSucceeded > 0) {
    const summaryNoun = pluralize(stats.aiSucceeded, "summary", "summaries")
    return {
      variant: "success",
      title: `Worksheet ready — ${stats.aiSucceeded} ${summaryNoun} generated`,
      description:
        stats.aiSkipped > 0
          ? `${stats.aiSkipped} ${pluralize(stats.aiSkipped, "task had", "tasks had")} no content to summarize. ${filename}`
          : filename,
    }
  }

  // No AI work at all — every task was empty-content.
  return {
    variant: "success",
    title: `Worksheet ready — ${stats.total} ${pluralize(stats.total, "task", "tasks")}`,
    description: `No task descriptions or notes to summarize. ${filename}`,
  }
}

/**
 * The full lifecycle wrapper. Caller passes a function that runs the
 * action; the helper handles the loading toast, in-place transition to
 * the outcome variant, and error mapping. Returns the action's result so
 * the caller can still hook into success (e.g. close a dialog) or rethrow.
 *
 * On success: the returned promise resolves with the action result.
 * On error: rejects with the original error; caller can additionally
 * `catch` to do UI work (e.g. focus the input again).
 */
export async function runExportWithToast(opts: {
  /** Calls the Convex action and returns the full export result. */
  run: () => Promise<WorksheetExportResult>
  /** Optional message shown while the action is in flight. */
  loadingMessage?: string
  /** Optional fallback error title if the thrown value isn't a ConvexError. */
  errorFallback?: string
  /** Side effect to run AFTER the CSV result is in hand (e.g. trigger download). */
  onResult?: (result: WorksheetExportResult) => void
}): Promise<WorksheetExportResult> {
  const toastId = toast.loading(opts.loadingMessage ?? "Generating worksheet…")
  try {
    const result = await opts.run()
    opts.onResult?.(result)

    const completion = buildCompletionToast(result.stats, result.filename)
    const args: Parameters<typeof toast.success>[1] = {
      id: toastId,
      description: completion.description,
      ...(completion.variant !== "success" && completion.duration
        ? { duration: completion.duration }
        : completion.duration
          ? { duration: completion.duration }
          : {}),
    }
    if (completion.variant === "success") toast.success(completion.title, args)
    else if (completion.variant === "warning") toast.warning(completion.title, args)
    else toast.error(completion.title, args)

    return result
  } catch (err) {
    toast.error(
      extractErrorMessage(err, opts.errorFallback ?? "Couldn't generate worksheet"),
      { id: toastId },
    )
    throw err
  }
}
