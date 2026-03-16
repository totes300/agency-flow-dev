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
  // Build parent path: /<first-segment>
  const parentPath = `/${segments[0]}`
  const parentLabel = routeLabels[parentPath] ?? segments[0]

  // The current page label: use dynamic title from context if available,
  // otherwise fall back to the static route label or segment name
  const currentLabel = dynamicTitle ?? routeLabels[pathname] ?? segments[segments.length - 1]

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
          <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
