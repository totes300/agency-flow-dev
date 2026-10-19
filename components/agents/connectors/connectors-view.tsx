"use client"

/**
 * Connectors surface (`?view=connectors`, slice 10) — the per-user connector
 * lifecycle UI inside the agent workspace. Lists every catalog connector with
 * the caller's OWN connection state; connect (paste token) / disconnect /
 * status. Not admin-gated: a connector authenticates the running user's own
 * account (US 37–39).
 *
 * Security posture (mirrors Settings → Integrations):
 *   - The token plaintext lives in memory only during the paste→save flow;
 *     the field is cleared on close. After save only the mask is shown.
 *   - `api.connectors.list` never returns ciphertext — the mask is the only
 *     credential-derived value that reaches this client.
 */

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  CheckCircle2Icon,
  Loader2Icon,
  PlugIcon,
  PlugZapIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { ConnectorListItem } from "@/convex/connectors"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

export function ConnectorsView() {
  const connectors = useQuery(api.connectors.list, {})

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <PlugIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Connectors</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-base font-semibold">Your connectors</h2>
            <p className="text-sm text-muted-foreground">
              Connect an external account for your own use. Agents you run can
              then use it — nobody else&apos;s runs can. Credentials are
              encrypted and never shown to the agent.
            </p>
          </div>

          {connectors === undefined ? (
            <ConnectorsSkeleton />
          ) : (
            <div className="flex flex-col gap-3">
              {connectors.map((c) => (
                <ConnectorCard key={c.type} connector={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

function ConnectorCard({ connector }: { connector: ConnectorListItem }) {
  const disconnect = useMutation(api.connectors.disconnect)
  const [connectOpen, setConnectOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const isConnected = connector.status === "connected"

  async function handleDisconnect() {
    try {
      await disconnect({ type: connector.type })
      toast.success(`Disconnected ${connector.displayName}.`)
      setDisconnectOpen(false)
    } catch (err) {
      toastError(err, `Couldn't disconnect ${connector.displayName}`)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{connector.displayName}</h3>
            <ConnectorStatusBadge status={connector.status} />
          </div>

          {isConnected ? (
            <div className="flex flex-col gap-1 text-sm">
              {connector.mask && (
                <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80">
                  {connector.mask}
                </code>
              )}
              <p className="text-xs text-muted-foreground">
                {connector.connectedAt
                  ? `Connected ${new Date(connector.connectedAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" },
                    )}`
                  : null}
                {connector.lastUsedAt
                  ? ` · last used ${new Date(connector.lastUsedAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )}`
                  : null}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {connector.description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConnectOpen(true)}
              >
                Reconnect
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDisconnectOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              <PlugZapIcon className="size-3.5" aria-hidden />
              {connector.status === null ? "Connect" : "Reconnect"}
            </Button>
          )}
        </div>
      </div>

      <ConnectTokenDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        connector={connector}
      />
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`Disconnect ${connector.displayName}?`}
        description="Agents you run will no longer be able to use it until you reconnect. Nothing else is affected."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={handleDisconnect}
      />
    </div>
  )
}

// ─── Status badge ───────────────────────────────────────────────────────────

function ConnectorStatusBadge({
  status,
}: {
  status: ConnectorListItem["status"]
}) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900">
        <CheckCircle2Icon className="size-3" aria-hidden />
        Connected
      </span>
    )
  }
  if (status === "expired" || status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
        <TriangleAlertIcon className="size-3" aria-hidden />
        {status === "expired" ? "Expired" : "Error"}
      </span>
    )
  }
  // revoked or never-connected (null) both read as "not connected".
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
      <PlugIcon className="size-3" aria-hidden />
      Not connected
    </span>
  )
}

// ─── Connect (token) dialog ─────────────────────────────────────────────────

function ConnectTokenDialog({
  open,
  onOpenChange,
  connector,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  connector: ConnectorListItem
}) {
  const connect = useMutation(api.connectors.connect)
  const [token, setToken] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setToken("")
      setError(null)
      setPending(false)
    }
    onOpenChange(next)
  }

  async function handleSubmit() {
    if (!token.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      await connect({ type: connector.type, token: token.trim() })
      toast.success(`${connector.displayName} connected.`)
      handleOpenChange(false)
    } catch (err) {
      // ConvexError messages (too short / encryption not configured) are safe
      // to show inline; anything else falls back to a toast.
      const message =
        err && typeof err === "object" && "data" in err
          ? String((err as { data: unknown }).data)
          : null
      if (message) setError(message)
      else toastError(err, `Couldn't connect ${connector.displayName}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {connector.displayName}</DialogTitle>
          <DialogDescription>
            Paste an access token for your {connector.displayName} account. It
            is encrypted at rest and never shown to agents — they only use it to
            do the work you ask for.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <Label htmlFor="connector-token">Access token</Label>
          <Input
            id="connector-token"
            type="password"
            placeholder="Paste token…"
            autoComplete="off"
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending && token.trim()) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            disabled={pending}
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !token.trim()}
          >
            {pending ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : null}
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Skeleton (content-aware) ───────────────────────────────────────────────

function ConnectorsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 1 }, (_, i) => (
        <div key={i} className="rounded-lg border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className={cn("h-8 w-24")} />
          </div>
        </div>
      ))}
    </div>
  )
}
