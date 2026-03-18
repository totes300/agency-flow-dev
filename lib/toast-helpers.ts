import { toast } from "sonner"

/** Show a toast error with a fallback message for non-Error objects. */
export function toastError(err: unknown, fallback: string): void {
  toast.error(err instanceof Error ? err.message : fallback)
}
