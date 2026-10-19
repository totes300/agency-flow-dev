"use client"

import { useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { buildProposalUrl, type ProposalRef } from "@/lib/task-detail"

/**
 * Open a proposal in the task drawer on the current route (`?draft=` /
 * `?change=`, email-triage B7). The route must mount a `ProposalDrawer`
 * (every `TaskDetailDrawer` does, and the Agents thread view).
 */
export function useOpenProposal(): (target: ProposalRef) => void {
  const router = useRouter()
  const pathname = usePathname()
  return useCallback(
    (target: ProposalRef) => {
      const current = new URLSearchParams(window.location.search)
      router.replace(`${pathname}${buildProposalUrl(current, target)}`, { scroll: false })
    },
    [pathname, router],
  )
}
