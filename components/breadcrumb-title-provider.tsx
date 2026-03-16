"use client"

import { BreadcrumbTitleContext, useBreadcrumbTitleState } from "@/lib/hooks/use-breadcrumb-title"

export function BreadcrumbTitleProvider({ children }: { children: React.ReactNode }) {
  const state = useBreadcrumbTitleState()

  return (
    <BreadcrumbTitleContext.Provider value={state}>
      {children}
    </BreadcrumbTitleContext.Provider>
  )
}
