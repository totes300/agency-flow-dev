import type { Metadata } from "next"
import { FolderIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = {
  title: "Projects",
}

export default function ProjectsPage() {
  return (
    <EmptyState
      icon={FolderIcon}
      title="No projects yet"
      description="Create a project to start tracking time and budgets."
    />
  )
}
