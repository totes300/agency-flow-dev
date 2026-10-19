import { Suspense } from "react"
import type { Metadata } from "next"
import { TriageView } from "@/components/triage/triage-view"
import { TriageSkeleton } from "@/components/triage/triage-skeleton"

export const metadata: Metadata = {
  title: "Triage",
}

export default function TriagePage() {
  // Email triage (docs/prd-email-triage.md §7.2, B8b): admin-only route
  // (lib/route-access.ts); the view renders not-found when the org has no
  // email triage (every query checks the flag server-side, I14).
  return (
    <Suspense fallback={<TriageSkeleton />}>
      <TriageView />
    </Suspense>
  )
}
