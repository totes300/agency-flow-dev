import { Toaster } from "@/components/ui/sonner"
import { WorkspaceShell } from "@/components/agents/workspace-shell"

// /agents lives OUTSIDE the (dashboard) route group on purpose: the Agents
// workspace is a full-screen surface with its own shell (PRD slice 00).
export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <WorkspaceShell>{children}</WorkspaceShell>
      <Toaster />
    </>
  )
}
