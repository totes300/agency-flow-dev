"use client"

import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

/**
 * The org's members (id, name, email, photo, role) from the single
 * `workspaceRefs.get` subscription (docs/prd-tasks-refactor.md §5.4) —
 * `undefined` while loading. Mentions read members here instead of the
 * legacy task reference-data context (§11.9).
 */
export function useWorkspaceMembers() {
  const { isAuthenticated } = useConvexAuth()
  return useQuery(api.workspaceRefs.get, isAuthenticated ? {} : "skip")?.members
}
