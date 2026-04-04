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
