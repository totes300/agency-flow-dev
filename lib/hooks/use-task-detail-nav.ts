"use client"

import { useCallback } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { buildDetailUrl } from "@/lib/task-detail"
import type { Id } from "@/convex/_generated/dataModel"

/** Shared hook for opening a task's detail by id (`?detail=<taskId>`; the
 *  drawer canonicalises it to `?task=<identifier>`, or opens the full page
 *  when that is the user's mode). Preserves existing query params. */
export function useTaskDetailNav() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useCallback(
    (taskId: string) => {
      const url = buildDetailUrl(new URLSearchParams(searchParams.toString()), taskId as Id<"tasks">)
      router.push(`${pathname}${url}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )
}
