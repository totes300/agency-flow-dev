"use client"

import { useCallback } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"

/** Shared hook for navigating to task detail via ?detail=taskId query param.
 *  Preserves existing query params (e.g. ?tab=settings). */
export function useTaskDetailNav() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("detail", taskId)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )
}
