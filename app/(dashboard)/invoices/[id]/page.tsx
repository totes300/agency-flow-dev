"use client"

import { useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { notFound } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ArrowLeftIcon, InfoIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { InvoiceDocument } from "@/components/invoices/invoice-document"
import { InvoiceSidebar } from "@/components/invoices/invoice-sidebar"
import { InvoiceEditorSkeleton } from "@/components/invoices/invoice-editor-skeleton"
import { formatInvoiceNumber } from "@/lib/format"

export default function InvoiceEditorPage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const searchParams = useSearchParams()
  const invoiceId = params.id as Id<"invoices">
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  const data = useQuery(api.invoices.getInvoice, isAuthenticated ? { id: invoiceId } : "skip")

  if (data === undefined) return <InvoiceEditorSkeleton />
  if (data === null) notFound()

  const { invoice, categoryGroups, lineItems, project, client, brand, timezone, orgInvoiceCount, fixedBilled, org } = data
  const readOnly = invoice.status !== "draft"

  const fromType = searchParams.get("from")
  const fromProjectId = searchParams.get("projectId")
  const backHref = fromType === "project" && fromProjectId
    ? `/projects/${fromProjectId}?tab=invoices`
    : "/invoices"

  const invoiceLabel = formatInvoiceNumber(invoice.prefix, invoice.number)

  const brandIncomplete = !brand?.brandName || !brand?.brandAddress
  const showBrandNudge = orgInvoiceCount <= 1 && brandIncomplete && !nudgeDismissed

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          className="size-8"
          asChild
        >
          <Link href={backHref}>
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/invoices" className="hover:text-foreground">Invoices</Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-foreground">{invoiceLabel}</li>
        </ol>
      </nav>

      {showBrandNudge && (
        <Alert variant="info">
          <InfoIcon />
          <AlertDescription>
            Complete your agency details in{" "}
            <Link href="/settings" className="font-medium">Settings</Link>{" "}
            for professional invoices.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setNudgeDismissed(true)}
              aria-label="Dismiss tip"
            >
              <XIcon className="size-3.5" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Left: The Paper */}
        <div className="min-w-0 flex-1">
          <InvoiceDocument
            invoice={invoice}
            categoryGroups={categoryGroups}
            lineItems={lineItems}
            project={project}
            client={client}
            brand={brand}
            org={org}
            readOnly={readOnly}
          />
        </div>

        {/* Right: Sidebar */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="lg:sticky lg:top-20">
            <InvoiceSidebar
              invoice={invoice}
              project={project}
              timezone={timezone}
              readOnly={readOnly}
              backHref={backHref}
              fixedBilled={fixedBilled}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
