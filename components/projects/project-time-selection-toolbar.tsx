"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency, formatMinutes } from "@/lib/format"
import { LoaderIcon, PlusIcon, XIcon } from "lucide-react"
import type { TimeEntryRow } from "@/components/projects/project-time-table"

export function ProjectTimeSelectionToolbar({
  selectedIds,
  entries,
  currency,
  projectId,
  onDeselectAll,
}: {
  selectedIds: Set<string>
  entries: TimeEntryRow[]
  currency: string
  projectId: Id<"projects">
  onDeselectAll: () => void
}) {
  const router = useRouter()
  const createInvoice = useMutation(api.invoices.createInvoice)
  const [isCreating, setIsCreating] = useState(false)

  const selected = entries.filter((e) => selectedIds.has(e._id))
  const count = selected.length
  const totalMinutes = selected.reduce((sum, e) => sum + e.durationMinutes, 0)
  const totalAmount = selected.reduce(
    (sum, e) => sum + (e.durationMinutes / 60) * e.billableRate,
    0,
  )

  async function handleCreate() {
    if (count === 0 || isCreating) return
    setIsCreating(true)
    try {
      const invoiceId = await createInvoice({
        projectId,
        roundingMinutes: 0,
        timeEntryIds: [...selectedIds] as Id<"timeEntries">[],
      })
      onDeselectAll()
      router.push(`/invoices/${invoiceId}?from=project&projectId=${projectId}&tab=time`)
      toast.success("Invoice created")
    } catch (err) {
      toastError(err, "Failed to create invoice")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2 pr-2">
              <span className="text-sm font-medium tabular-nums">
                {count} {count === 1 ? "entry" : "entries"} · {formatMinutes(totalMinutes)}
              </span>
              <button
                type="button"
                aria-label="Clear selection"
                onClick={onDeselectAll}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <span className="px-1 text-sm tabular-nums text-muted-foreground">
              {formatCurrency(totalAmount, currency)}
            </span>

            <Button
              size="sm"
              onClick={handleCreate}
              disabled={isCreating}
              className="ml-1"
            >
              {isCreating ? (
                <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <PlusIcon className="mr-1.5 size-3.5" />
              )}
              Create Invoice from Selected
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
