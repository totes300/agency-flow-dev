"use client"

import { useContext } from "react"
import { usePathname } from "next/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Skeleton } from "@/components/ui/skeleton"
import { routeLabels } from "@/lib/navigation"
import { BreadcrumbTitleContext } from "@/lib/hooks/use-breadcrumb-title"

export function DashboardBreadcrumb() {
  const pathname = usePathname()
  const { title: dynamicTitle } = useContext(BreadcrumbTitleContext)

  const segments = pathname.split("/").filter(Boolean)

  // For simple routes like /clients, /tasks, etc.
  if (segments.length <= 1) {
    const pageLabel = routeLabels[pathname] ?? segments[segments.length - 1]
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  // For nested routes like /clients/[id]
  const parentPath = `/${segments[0]}`
  const parentLabel = routeLabels[parentPath] ?? segments[0]

  // Title resolution priority:
  //   1. Dynamic title set by the detail page via useBreadcrumbTitle()
  //   2. Static label from navigation.ts (e.g. nested static pages)
  //   3. Skeleton — we are on a dynamic detail page whose query has not
  //      resolved yet, OR has resolved to null. We never want to show the
  //      raw URL segment because that would be a Convex doc ID, an invoice
  //      number, or a slug — at best ugly, at worst (Convex IDs) hostile UX.
  const currentLabel = dynamicTitle ?? routeLabels[pathname] ?? null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href={parentPath}>
            {parentLabel}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {currentLabel === null ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
