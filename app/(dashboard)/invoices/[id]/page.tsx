"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ArrowLeftIcon, InfoIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { InvoiceDocument } from "@/components/invoices/invoice-document"
import { InvoiceSidebar } from "@/components/invoices/invoice-sidebar"
import { InvoiceEditorSkeleton } from "@/components/invoices/invoice-editor-skeleton"
import { formatInvoiceNumber } from "@/lib/format"

export default function InvoiceEditorPage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const invoiceId = params.id as Id<"invoices">
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  const data = useQuery(api.invoices.getInvoice, isAuthenticated ? { id: invoiceId } : "skip")

  // Redirect to invoices list if invoice not found
  useEffect(() => {
    if (data === null) {
      router.replace("/invoices")
    }
  }, [data, router])

  if (data === undefined || data === null) return <InvoiceEditorSkeleton />

  const { invoice, categoryGroups, lineItems, project, client, brand, timezone, orgInvoiceCount, fixedBilled } = data
  const readOnly = invoice.status !== "draft"

  // Contextual back link from ?from= params
  const fromType = searchParams.get("from")
  const fromProjectId = searchParams.get("projectId")
  const backHref = fromType === "project" && fromProjectId
    ? `/projects/${fromProjectId}?tab=invoices`
    : "/invoices"

  const breadcrumb = `Invoices > ${formatInvoiceNumber(invoice.prefix, invoice.number)}`

  // First-time brand info nudge: show when this is the org's first invoice
  // and brand info is incomplete (missing name or address)
  const brandIncomplete = !brand?.brandName || !brand?.brandAddress
  const showBrandNudge = orgInvoiceCount <= 1 && brandIncomplete && !nudgeDismissed

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header with back link + breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          aria-label="Back"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <span className="text-sm text-muted-foreground">{breadcrumb}</span>
      </div>

      {/* First-time brand info nudge */}
      {showBrandNudge && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/50">
          <InfoIcon className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="flex-1 text-sm text-blue-800 dark:text-blue-300">
            Complete your agency details in{" "}
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Settings
            </Link>{" "}
            for professional invoices.
          </p>
          <button
            type="button"
            onClick={() => setNudgeDismissed(true)}
            aria-label="Dismiss tip"
            className="shrink-0 rounded-md p-1 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
          >
            <XIcon className="size-4" />
          </button>
        </div>
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
