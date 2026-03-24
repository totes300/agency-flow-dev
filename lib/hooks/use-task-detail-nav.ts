"use client"

import { useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"

/** Shared hook for navigating to task detail via ?detail=taskId query param. */
export function useTaskDetailNav() {
  const router = useRouter()
  const pathname = usePathname()

  return useCallback(
    (taskId: string) => router.push(`${pathname}?detail=${taskId}`, { scroll: false }),
    [router, pathname],
  )
}
