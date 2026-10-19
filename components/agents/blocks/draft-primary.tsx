"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

/**
 * One dark primary per screen (owner rule, B8a): when a conversation holds
 * several email drafts, only the LATEST ACTIONABLE one (the viewer can send,
 * approve or retry it now) gets the dark primary button; the others use the
 * quiet outline style. The thread view knows the drafts' order; each email
 * block reports whether it is actionable from its live record.
 */
type DraftPrimary = {
  /** The draft whose primary button is the dark one; null = none decided yet. */
  primaryId: string | null
  report: (draftId: string, actionable: boolean) => void
}

const DraftPrimaryContext = createContext<DraftPrimary | null>(null)

export function DraftPrimaryProvider({
  order,
  children,
}: {
  /** The drafts of the conversation, oldest first. */
  order: readonly string[]
  children: React.ReactNode
}) {
  const [actionable, setActionable] = useState<ReadonlySet<string>>(new Set())
  const report = useCallback((draftId: string, isActionable: boolean) => {
    setActionable((cur) => {
      if (cur.has(draftId) === isActionable) return cur
      const next = new Set(cur)
      if (isActionable) next.add(draftId)
      else next.delete(draftId)
      return next
    })
  }, [])
  const primaryId = useMemo(() => [...order].reverse().find((id) => actionable.has(id)) ?? null, [order, actionable])
  const value = useMemo(() => ({ primaryId, report }), [primaryId, report])
  return <DraftPrimaryContext.Provider value={value}>{children}</DraftPrimaryContext.Provider>
}

/**
 * Whether this draft's primary action is THE dark primary of the screen.
 * Outside a provider (a single block) it always is.
 */
export function useIsPrimaryDraft(draftId: string, actionable: boolean): boolean {
  const ctx = useContext(DraftPrimaryContext)
  const report = ctx?.report
  useEffect(() => {
    if (!report) return
    report(draftId, actionable)
    return () => report(draftId, false)
  }, [report, draftId, actionable])
  if (!ctx) return true
  return ctx.primaryId === null || ctx.primaryId === draftId
}
