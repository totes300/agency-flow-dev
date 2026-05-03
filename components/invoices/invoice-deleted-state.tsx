"use client"

import Link from "next/link"
import { ArrowLeftIcon, FileXIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Rendered on `/invoices/[id]` when the invoice query returns null.
 *
 * Three call sites collapse into the same UI:
 *  - this user just deleted the invoice (sidebar's optimistic
 *    `router.replace` is mid-flight; this state shows for at most one frame)
 *  - another teammate / another tab deleted it while we were viewing
 *  - the URL points at a non-existent ID (genuinely bad link)
 *
 * Same pattern as Linear / Notion: tell the user what happened, give them a
 * single "Back" affordance, never auto-redirect into a different context.
 */
export function InvoiceDeletedState({ backHref }: { backHref: string }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <FileXIcon className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Invoice not available</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This invoice has been deleted or you don&apos;t have access to it.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href={backHref}>
          <ArrowLeftIcon className="size-4" />
          Back
        </Link>
      </Button>
    </div>
  )
}
