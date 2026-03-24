"use client"

import { useOrganization } from "@clerk/nextjs"

/** Returns whether the current user has the org:admin role. */
export function useIsAdmin(): boolean | undefined {
  const { membership } = useOrganization()
  return membership ? membership.role === "org:admin" : undefined
}
