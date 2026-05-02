"use client"

import { useQuery, useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"

/** Must match the server fallback in `convex/timeEntries.ts` / `convex/timer.ts`. */
export const ORG_TIMEZONE_FALLBACK = "America/New_York"

/** Org timezone + `isReady` gate. Save handlers should block until ready
 *  so we don't anchor with the fallback before settings load. */
export function useOrgTimezone(): {
  timezone: string
  isReady: boolean
} {
  const { isAuthenticated } = useConvexAuth()
  const orgSettings = useQuery(
    api.orgSettings.get,
    isAuthenticated ? {} : "skip",
  )
  return {
    timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
    isReady: orgSettings !== undefined,
  }
}
