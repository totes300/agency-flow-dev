"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { connectionMeta, type ConnectionView } from "@/lib/connected-apps"
import { cn } from "@/lib/utils"

export type ConnectionRowData = ConnectionView & { id: string }

type Pending = { kind: "revoke" | "allow"; row: ConnectionRowData } | null

/**
 * The user's MCP connections (owner decision D-REVOKE): name, connected or
 * revoked date and last use as quiet text, one ghost action per row —
 * Revoke, or Allow again on a revoked row — each confirmed first.
 * Presentational: the page passes the rows and the two actions.
 */
export function ConnectedAppsList({
  connections,
  now,
  onRevoke,
  onAllowAgain,
}: {
  connections: ConnectionRowData[]
  now: number
  onRevoke: (id: string) => Promise<void>
  onAllowAgain: (id: string) => Promise<void>
}) {
  const [pending, setPending] = useState<Pending>(null)

  if (connections.length === 0) {
    return (
      <p className="border-y border-border/60 py-6 text-sm text-muted-foreground">
        No apps connected yet. An app appears here after its first request to Agency Flow.
      </p>
    )
  }

  async function confirm() {
    if (!pending) return
    const { kind, row } = pending
    setPending(null)
    if (kind === "revoke") await onRevoke(row.id)
    else await onAllowAgain(row.id)
  }

  return (
    <>
      <ul className="border-t border-border/60">
        {connections.map((row) => {
          const revoked = row.revokedAt !== null
          return (
            <li key={row.id} className="flex items-center gap-4 border-b border-border/60 py-3">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium", revoked && "text-muted-foreground")}>{row.clientName}</p>
                <p className="truncate text-xs text-muted-foreground">{connectionMeta(row, now)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending({ kind: revoked ? "allow" : "revoke", row })}
              >
                {revoked ? "Allow again" : "Revoke"}
              </Button>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={pending?.kind === "allow" ? `Allow ${pending.row.clientName} again?` : `Revoke ${pending?.row.clientName ?? ""}?`}
        description={
          pending?.kind === "allow"
            ? "It can use Agency Flow as you again in this workspace, with the connection it already has. If you disconnected it in the app, connect it there again."
            : "It is blocked in Agency Flow from its next request, in this workspace. The app still keeps its stored connection: to remove that too, disconnect Agency Flow in the app (Claude: Settings → Connectors; Codex: codex mcp logout agency-flow)."
        }
        confirmLabel={pending?.kind === "allow" ? "Allow again" : "Revoke"}
        variant={pending?.kind === "allow" ? "default" : "destructive"}
        onConfirm={() => void confirm()}
      />
    </>
  )
}
