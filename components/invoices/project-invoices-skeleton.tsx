import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading state for the project detail "Invoices" tab. Mirrors the layout of
 * `ProjectInvoices` — header, two metric cards, then a list of invoice rows.
 * Used both as the `dynamic()` loading fallback and as the in-tab skeleton
 * while Convex queries resolve.
 */
export function ProjectInvoicesSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header: title + Create Invoice button */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>

      {/* Invoice list — header row + 4 rows */}
      <div className="overflow-hidden rounded-xl border">
        <div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-[5px]" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
