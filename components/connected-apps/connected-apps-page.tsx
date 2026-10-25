"use client"

import { useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { toastError } from "@/lib/toast-helpers"
import { ConnectedAppsList } from "./connected-apps-list"
import { ConnectHelp } from "./connect-help"

function ListSkeleton() {
  return (
    <div className="flex flex-col border-t border-border/60">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5 border-b border-border/60 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      ))}
    </div>
  )
}

/**
 * /connected-apps (docs/prd-mcp.md D17; owner decisions D-PAGE, D-REVOKE):
 * every member's own MCP connections in the active workspace, then how to
 * connect. Admin Settings is unchanged.
 */
export function ConnectedAppsPage({ mcpUrl }: { mcpUrl: string | null }) {
  const { isAuthenticated } = useConvexAuth()
  const connections = useQuery(api.connectedApps.listMine, isAuthenticated ? {} : "skip")
  const revoke = useMutation(api.connectedApps.revoke)
  const allowAgain = useMutation(api.connectedApps.allowAgain)
  // Relative "last used" times are computed against the page's open time.
  const [now] = useState(() => Date.now())

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connected apps</h1>
        <p className="text-sm text-muted-foreground">
          AI apps that use Agency Flow as you in this workspace, through the MCP server.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        {connections === undefined ? (
          <ListSkeleton />
        ) : (
          <ConnectedAppsList
            connections={connections}
            now={now}
            onRevoke={async (id) => {
              try {
                await revoke({ id })
              } catch (error) {
                toastError(error, "Couldn't revoke the app")
              }
            }}
            onAllowAgain={async (id) => {
              try {
                await allowAgain({ id })
              } catch (error) {
                toastError(error, "Couldn't allow the app again")
              }
            }}
          />
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-8">
        <h2 className="text-base font-semibold">How to connect</h2>
        <ConnectHelp mcpUrl={mcpUrl} />
      </section>
    </div>
  )
}
