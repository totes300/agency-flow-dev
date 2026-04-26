"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { MoreHorizontal, CheckCircle2, Undo2, Ban, FileCheck } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { InvoiceStatus } from "@/components/invoices/invoice-status-badge"

type TransitionLabel = {
  label: string
  icon: React.ReactNode
  target: InvoiceStatus
  destructive?: boolean
}

/**
 * Available transitions per current state. Order matches the state machine
 * in `convex/invoices.ts` — forward progression first, reversal below a
 * separator, Void last as the destructive option.
 */
const TRANSITIONS: Record<InvoiceStatus, TransitionLabel[]> = {
  draft: [
    {
      label: "Mark as invoiced",
      icon: <FileCheck className="size-3.5" />,
      target: "invoiced",
    },
    { label: "Void", icon: <Ban className="size-3.5" />, target: "void", destructive: true },
  ],
  invoiced: [
    {
      label: "Mark as paid",
      icon: <CheckCircle2 className="size-3.5" />,
      target: "paid",
    },
    {
      label: "Revert to draft",
      icon: <Undo2 className="size-3.5" />,
      target: "draft",
    },
    { label: "Void", icon: <Ban className="size-3.5" />, target: "void", destructive: true },
  ],
  paid: [
    {
      label: "Revert to invoiced",
      icon: <Undo2 className="size-3.5" />,
      target: "invoiced",
    },
  ],
  void: [],
}

const PAST_TENSE: Record<InvoiceStatus, string> = {
  draft: "reverted to draft",
  invoiced: "marked as invoiced",
  paid: "marked as paid",
  void: "voided",
}

export function InvoiceRowActions({
  invoiceId,
  status,
}: {
  invoiceId: Id<"invoices">
  status: InvoiceStatus
}) {
  const changeStatus = useMutation(api.invoices.changeInvoiceStatus)
  const [open, setOpen] = useState(false)

  const transitions = TRANSITIONS[status]
  if (transitions.length === 0) return null

  // Void is always the last, destructive entry — separate it visually.
  const [void_, ...rest] = transitions.slice().reverse()
  const forward = rest.reverse()
  const hasVoid = void_?.target === "void"

  async function run(target: InvoiceStatus) {
    try {
      await changeStatus({ id: invoiceId, newStatus: target })
      toast.success(`Invoice ${PAST_TENSE[target]}`)
    } catch (err) {
      toastError(err, `Failed to update invoice`)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Invoice actions"
          onClick={(e) => e.stopPropagation()}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        {forward.map((t) => (
          <DropdownMenuItem key={t.target} onSelect={() => run(t.target)}>
            {t.icon}
            {t.label}
          </DropdownMenuItem>
        ))}
        {hasVoid && forward.length > 0 && <DropdownMenuSeparator />}
        {hasVoid && (
          <DropdownMenuItem variant="destructive" onSelect={() => run("void")}>
            {void_.icon}
            {void_.label}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
