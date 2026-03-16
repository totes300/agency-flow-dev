"use client"

import dynamic from "next/dynamic"
import { useOrganization } from "@clerk/nextjs"
import { useConvexAuth, useQuery } from "convex/react"
import { Authenticated, AuthLoading } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"

const OnboardingModal = dynamic(
  () => import("@/components/onboarding/onboarding-modal").then((m) => ({ default: m.OnboardingModal })),
)

function LoadingSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function OnboardingCheck({ children }: { children: React.ReactNode }) {
  const { organization, membership, isLoaded } = useOrganization()
  const { isAuthenticated } = useConvexAuth()

  // Only query when: Clerk org is loaded, org exists, AND Convex auth is ready
  // This prevents the race condition where Clerk has org context but
  // Convex JWT hasn't been updated yet
  const shouldQuery = isLoaded && !!organization && !!membership && isAuthenticated

  const orgSettings = useQuery(
    api.orgSettings.get,
    shouldQuery ? {} : "skip"
  )

  // No org selected — personal workspace, render children directly
  if (isLoaded && !organization) {
    return <>{children}</>
  }

  // Still loading org, membership, or settings
  if (!shouldQuery || orgSettings === undefined) {
    return <LoadingSkeleton />
  }

  // Org exists but no settings — needs onboarding
  if (orgSettings === null) {
    if (membership?.role === "org:admin") {
      return <OnboardingModal />
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Almost there</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your admin hasn&apos;t finished setting up this organization yet.
            <br />
            Please check back shortly.
          </p>
        </div>
      </div>
    )
  }

  // Settings exist — render normally
  return <>{children}</>
}

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <LoadingSkeleton />
      </AuthLoading>
      <Authenticated>
        <OnboardingCheck>{children}</OnboardingCheck>
      </Authenticated>
    </>
  )
}
