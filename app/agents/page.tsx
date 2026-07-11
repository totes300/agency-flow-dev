import { Suspense } from "react"
import { ThreadPane } from "@/components/agents/thread-pane"
import { ThreadViewSkeleton } from "@/components/agents/thread-view"

export default function AgentsPage() {
  return (
    // Suspense: useSearchParams inside ThreadPane opts this route into CSR
    // at the boundary; the fallback mirrors the thread layout.
    <Suspense fallback={<ThreadViewSkeleton />}>
      <ThreadPane />
    </Suspense>
  )
}
