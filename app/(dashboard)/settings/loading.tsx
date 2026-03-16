import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b">
        <Skeleton className="h-4 w-16 mx-4 my-2" />
        <Skeleton className="h-4 w-12 mx-4 my-2" />
        <Skeleton className="h-4 w-18 mx-4 my-2" />
        <Skeleton className="h-4 w-28 mx-4 my-2" />
      </div>

      {/* Content — matches General tab (default) */}
      <div className="space-y-8">
        <div className="space-y-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="space-y-6">
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full max-w-xs" />
          </div>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-start">
            <Skeleton className="h-4 w-24" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-5 w-44" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
