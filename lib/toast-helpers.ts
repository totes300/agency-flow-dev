import { toast } from "sonner"
import { ConvexError } from "convex/values"

/** Show a toast error, extracting clean messages from ConvexError. */
export function toastError(err: unknown, fallback: string): void {
  if (err instanceof ConvexError) {
    const msg = typeof err.data === "string" ? err.data : fallback
    toast.error(msg)
  } else if (err instanceof Error) {
    toast.error(err.message)
  } else {
    toast.error(fallback)
  }
}
