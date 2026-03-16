import type { Metadata } from "next"
import { ClockIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = {
  title: "My Time",
}

export default function MyTimePage() {
  return (
    <EmptyState
      icon={ClockIcon}
      title="Track your time"
      description="Your time entries and timer will appear here."
    />
  )
}
