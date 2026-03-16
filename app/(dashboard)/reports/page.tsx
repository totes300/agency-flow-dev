import type { Metadata } from "next"
import { FileTextIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = {
  title: "Reports",
}

export default function ReportsPage() {
  return (
    <EmptyState
      icon={FileTextIcon}
      title="No reports yet"
      description="Reports will be generated from tracked time and projects."
    />
  )
}
