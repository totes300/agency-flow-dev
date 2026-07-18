"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ArrowLeftIcon, InfoIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { InvoiceDocument } from "@/components/invoices/invoice-document"
import { InvoiceSidebar } from "@/components/invoices/invoice-sidebar"
import { InvoiceEditorSkeleton } from "@/components/invoices/invoice-editor-skeleton"
import { InvoiceDeletedState } from "@/components/invoices/invoice-deleted-state"
import { formatInvoiceIdentifier } from "@/lib/format"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"

export default function InvoiceEditorPage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const searchParams = useSearchParams()
  // The `[id]` route segment now carries the friendly identifier ("INV-035").
  // The backend resolver also accepts a raw Convex doc ID for backwards compat
  // with bookmarks saved before the URL refactor.
  const invoiceIdentifier = params.id as string
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  const data = useQuery(api.invoices.getInvoice, isAuthenticated ? { identifier: invoiceIdentifier } : "skip")
  const printRequested = searchParams.get("print") === "1"
  const breadcrumbTitle =
    data && data !== null
      ? formatInvoiceIdentifier(data.invoice.prefix, data.invoice.number)
      : null
  useBreadcrumbTitle(breadcrumbTitle)

  const fromType = searchParams.get("from")
  const fromProjectId = searchParams.get("projectId")
  const backHref = fromType === "project" && fromProjectId
    ? `/projects/${fromProjectId}?tab=invoices`
    : "/invoices"

  useEffect(() => {
    if (!printRequested || data === undefined || data === null) return
    const timeout = window.setTimeout(() => window.print(), 250)
    return () => window.clearTimeout(timeout)
  }, [data, printRequested])

  if (data === undefined) return <InvoiceEditorSkeleton />
  // `data === null` means either:
  //   (a) the invoice was just deleted (this user clicked Delete in the
  //       sidebar and the optimistic router.replace is mid-flight), or
  //   (b) another user / another tab deleted it while we were viewing, or
  //   (c) the URL points at a non-existent ID (genuinely bad link).
  //
  // We render the same "Invoice deleted" state for all three. Case (a)
  // flickers for a frame at most before the sidebar's router.replace lands;
  // cases (b) and (c) match the Linear / Notion pattern of telling the user
  // explicitly what happened with a back button rather than 404'ing.
  if (data === null) return <InvoiceDeletedState backHref={backHref} />

  const { invoice, categoryGroups, lineItems, project, client, brand, timezone, orgInvoiceCount, fixedBilled, retainerUsage, staleEntries, org } = data
  const readOnly = invoice.status !== "draft"

  const brandIncomplete = !brand?.brandName || !brand?.brandAddress
  const showBrandNudge = orgInvoiceCount <= 1 && brandIncomplete && !nudgeDismissed

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <nav
        aria-label="Document navigation"
        className="flex items-center gap-3 print:hidden"
      >
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
      </nav>

      {showBrandNudge && (
        <Alert variant="info" className="print:hidden">
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
        <div className="min-w-0 flex-1 print:w-full">
          <InvoiceDocument
            invoice={invoice}
            categoryGroups={categoryGroups}
            lineItems={lineItems}
            project={project}
            client={client}
            brand={brand}
            retainerUsage={retainerUsage}
            org={org}
            readOnly={readOnly}
          />
        </div>

        {/* Right: Sidebar */}
        <div className="w-full print:hidden lg:w-80 lg:shrink-0">
          <div className="lg:sticky lg:top-20">
            <InvoiceSidebar
              invoice={invoice}
              project={project}
              timezone={timezone}
              readOnly={readOnly}
              backHref={backHref}
              fixedBilled={fixedBilled}
              fixedLine={(() => {
                const fx = lineItems.find((li) => li.lineType === "fixed")
                return fx ? { id: fx._id, amount: fx.amount } : null
              })()}
              hasTimeLines={
                project?.billingType !== "retainer" &&
                lineItems.some((li) => li.lineType === "time")
              }
              staleEntries={staleEntries}
              onPrint={() => window.print()}
              brandMissing={!brand?.brandName}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
