"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"

type BreadcrumbTitleContextType = {
  title: string | null
  setTitle: (title: string | null) => void
}

export const BreadcrumbTitleContext = createContext<BreadcrumbTitleContextType>({
  title: null,
  setTitle: () => {},
})

/**
 * Hook for detail pages to set a dynamic breadcrumb title.
 * Call with the entity name (e.g. client name) — the breadcrumb
 * component will pick it up via context.
 */
export function useBreadcrumbTitle(title: string | null) {
  const { setTitle } = useContext(BreadcrumbTitleContext)

  useEffect(() => {
    setTitle(title)
    return () => setTitle(null)
  }, [title, setTitle])
}

/**
 * Hook for the breadcrumb provider to manage state.
 */
export function useBreadcrumbTitleState() {
  const [title, setTitleRaw] = useState<string | null>(null)
  const setTitle = useCallback((t: string | null) => setTitleRaw(t), [])
  return { title, setTitle }
}
