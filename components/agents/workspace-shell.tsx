"use client"

import { Authenticated, AuthLoading } from "convex/react"
import { WorkspaceRail } from "@/components/agents/workspace-rail"
import { WorkspaceSkeleton } from "@/components/agents/workspace-skeleton"

/**
 * Full-screen Agents workspace shell — the /agents counterpart of the
 * dashboard shell (deliberately outside it: no app sidebar, no header,
 * no breadcrumb, no page padding). Three-zone layout: rail | center
 * (children) | canvas (arrives in a later slice).
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <AuthLoading>
        <WorkspaceSkeleton />
      </AuthLoading>
      <Authenticated>
        <WorkspaceRail />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </Authenticated>
    </div>
  )
}
