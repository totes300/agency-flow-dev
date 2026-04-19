"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ClientColorAvatar } from "@/components/clients/client-color-avatar"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export type ReadyToInvoiceRow = {
  clientId: string
  clientName: string
  clientLogoUrl: string | null
  projectId: string
  projectName: string
  monthlyFee: number
  currency: string
  year: number
  month: number
  label: string
  startDate: string
  endDate: string
}

type ActiveRow = {
  projectId: Id<"projects">
  projectName: string
  currency: string
  year: number
  month: number
}

export function ReadyToInvoiceCard({ rows }: { rows: ReadyToInvoiceRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null)

  if (rows.length === 0) return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Ready to invoice</h2>
            <Badge variant="secondary">{rows.length}</Badge>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>

        {open && (
          <ul className="flex flex-col divide-y divide-border/60">
            {rows.map((row) => (
              <li
                key={`${row.projectId}-${row.year}-${row.month}`}
                className="flex items-center gap-3 py-2.5"
              >
                <ClientColorAvatar name={row.clientName} logoUrl={row.clientLogoUrl} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{row.clientName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {row.projectName} · {row.label}
                  </span>
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  {formatCurrency(row.monthlyFee, row.currency)}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    setActiveRow({
                      projectId: row.projectId as Id<"projects">,
                      projectName: row.projectName,
                      currency: row.currency,
                      year: row.year,
                      month: row.month,
                    })
                  }
                >
                  <PlusIcon className="mr-1.5 size-3.5" />
                  Create
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {activeRow && (
        <CreateInvoiceModal
          // Remount per row so prefill resets cleanly
          key={`${activeRow.projectId}-${activeRow.year}-${activeRow.month}`}
          open={true}
          onOpenChange={(next) => {
            if (!next) setActiveRow(null)
          }}
          projectId={activeRow.projectId}
          projectName={activeRow.projectName}
          billingType="retainer"
          currency={activeRow.currency}
          initialRetainerYear={activeRow.year}
          initialRetainerMonth={activeRow.month}
          onCreated={(invoiceId) => router.push(`/invoices/${invoiceId}`)}
        />
      )}
    </Card>
  )
}
