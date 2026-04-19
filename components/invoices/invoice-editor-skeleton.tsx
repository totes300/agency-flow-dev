import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading state for `app/(dashboard)/invoices/[id]/page.tsx`. Mirrors the
 * actual `InvoiceDocument` + `InvoiceSidebar` layout (column counts, row
 * shapes, spacing) so the page doesn't reflow when data lands.
 */
export function InvoiceEditorSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header: back arrow + breadcrumb */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Two-column layout — matches the page */}
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* The Paper */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
            {/* Subject */}
            <Skeleton className="h-7 w-80" />

            {/* FROM / TO parties */}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <InvoicePartySkeleton />
              <InvoicePartySkeleton />
            </div>

            {/* Meta row: invoice number, issue date, due date */}
            <div className="flex gap-8">
              <InvoiceMetaBlockSkeleton valueWidth="w-20" />
              <InvoiceMetaBlockSkeleton valueWidth="w-28" />
              <InvoiceMetaBlockSkeleton valueWidth="w-28" />
            </div>

            <hr className="border-border" />

            {/* Work breakdown: table header + category + rows */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-6">
                <Skeleton className="h-3 flex-1 max-w-[160px]" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
              <hr className="border-border" />
              <InvoiceWorkCategorySkeleton rows={3} />
              <InvoiceWorkCategorySkeleton rows={2} />
              <hr className="border-border" />
              {/* Totals */}
              <div className="flex items-center justify-end gap-6">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-72">
          <div className="flex flex-col gap-5">
            <SidebarSectionSkeleton labelWidth="w-12" valueClass="h-6 w-24 rounded-[5px]" />
            <SidebarSectionSkeleton labelWidth="w-14" valueClass="h-8 w-32" />
            <SidebarSectionSkeleton labelWidth="w-16" valueClass="h-4 w-28" />
            <SidebarSectionSkeleton labelWidth="w-14" valueClass="h-4 w-28" />
            <hr className="border-border" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-20 rounded-md" />
            </div>
            <hr className="border-border" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InvoicePartySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-28" />
    </div>
  )
}

function InvoiceMetaBlockSkeleton({ valueWidth }: { valueWidth: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className={`h-4 ${valueWidth}`} />
    </div>
  )
}

function InvoiceWorkCategorySkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1">
      {/* Category header: badge + hours */}
      <div className="flex items-center py-1.5">
        <div className="flex flex-1 items-center gap-2">
          <Skeleton className="h-5 w-24 rounded-[5px]" />
        </div>
        <Skeleton className="h-3 w-10" />
      </div>
      {/* Line item rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 py-1 pl-4">
          <Skeleton className="h-3 flex-1 max-w-[220px]" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

function SidebarSectionSkeleton({
  labelWidth,
  valueClass,
}: {
  labelWidth: string
  valueClass: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className={`h-3 ${labelWidth}`} />
      <Skeleton className={valueClass} />
    </div>
  )
}
