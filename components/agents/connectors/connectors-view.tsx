"use client"

/**
 * Connectors surface (`?view=connectors`, slice 10) — the per-user connector
 * lifecycle UI inside the agent workspace. Lists every catalog connector with
 * the caller's OWN connection state; connect (paste token, or the OAuth
 * redirect for Gmail) / disconnect / status. Not admin-gated: a connector
 * authenticates the running user's own account (US 37–39).
 *
 * Gmail (email triage B1, D17; B3 sync): listed only when the org has
 * `emailTriageEnabled` (the server decides — `api.connectors.list`). Connect
 * calls the `oauth.startGmailConnect` action and navigates to Google; the
 * callback sends the user back here with `?gmail=pending&t=…` — this page,
 * signed in, finishes it through `oauth.finishGmailConnect` (only the user
 * who started the flow can) — or `?gmail=error&reason=…`. Either becomes a
 * toast and the params are removed from the URL first. A connected Gmail row
 * shows its last sync, the sync error with its fix, and `Resync last 7 days`
 * (`email/sync.resyncMyMailbox`, D34).
 *
 * Security posture (mirrors Settings → Integrations):
 *   - The token plaintext lives in memory only during the paste→save flow;
 *     the field is cleared on close. After save only the mask is shown.
 *   - `api.connectors.list` never returns ciphertext — the mask is the only
 *     credential-derived value that reaches this client.
 */

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { Loader2Icon, PlugIcon, PlugZapIcon } from "lucide-react"
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
import { formatRelativeTime } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/** `?reason=` from the OAuth callback (convex/lib/googleOAuth.ts) → copy. */
const GMAIL_CONNECT_ERRORS: Record<string, string> = {
  denied: "Gmail wasn't connected — the Google sign-in was cancelled.",
  invalid_state: "That sign-in link was already used. Try Connect again.",
  expired: "The Google sign-in took longer than 10 minutes. Try Connect again.",
  disabled: "Email triage isn't enabled for this organization.",
  permission: "Gmail needs both read and send access. Connect again and allow both.",
  demo_mailbox: "Remove the demo mailbox first (devSeedEmail:reset), then connect.",
  not_member: "You're no longer a member of this organization.",
  config: "Gmail sign-in isn't configured on this deployment yet.",
}
const GMAIL_CONNECT_FALLBACK_ERROR = "Couldn't connect Gmail. Try again."

/**
 * Handle the OAuth callback's return once: `pending` → finish the connect
 * (signed in), `error` → explain. The params (incl. the one-time token) are
 * dropped from the URL before anything else.
 */
function useGmailReturn() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useConvexAuth()
  const finishGmailConnect = useMutation(api.oauth.finishGmailConnect)
  const handled = useRef<string | null>(null)
  const outcome = searchParams.get("gmail")
  const reason = searchParams.get("reason")
  const token = searchParams.get("t")

  useEffect(() => {
    if (!outcome) return
    // The finish step needs the session; wait for Convex auth.
    if (outcome === "pending" && token && !isAuthenticated) return
    const key = `${outcome}:${reason ?? ""}:${token ?? ""}`
    if (handled.current === key) return
    handled.current = key

    const next = new URLSearchParams(searchParams.toString())
    next.delete("gmail")
    next.delete("reason")
    next.delete("t")
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })

    if (outcome === "pending" && token) {
      finishGmailConnect({ t: token })
        .then((result) => {
          if (result.ok) toast.success(`Gmail connected: ${result.emailAddress}.`)
          else toast.error(result.message)
        })
        .catch((err: unknown) => toastError(err, GMAIL_CONNECT_FALLBACK_ERROR))
    } else if (outcome === "error") {
      toast.error(GMAIL_CONNECT_ERRORS[reason ?? ""] ?? GMAIL_CONNECT_FALLBACK_ERROR)
    }
  }, [outcome, reason, token, isAuthenticated, searchParams, router, pathname, finishGmailConnect])
}

export function ConnectorsView() {
  const connectors = useQuery(api.connectors.list, {})
  useGmailReturn()

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
  const startGmailConnect = useAction(api.oauth.startGmailConnect)
  const resyncMyMailbox = useMutation(api.email.sync.resyncMyMailbox)
  const [resyncing, setResyncing] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  const isOAuth = connector.authKind === "oauth"
  const isConnected = connector.status === "connected"
  const needsReconnect = connector.status === "expired" || connector.status === "error"

  async function handleDisconnect() {
    try {
      await disconnect({ type: connector.type })
      toast.success(`Disconnected ${connector.displayName}.`)
      setDisconnectOpen(false)
    } catch (err) {
      toastError(err, `Couldn't disconnect ${connector.displayName}`)
    }
  }

  async function handleResync() {
    setResyncing(true)
    try {
      const { alreadyRunning } = await resyncMyMailbox({})
      toast.success(
        alreadyRunning
          ? "A resync is already running."
          : "Resyncing the last 7 days — new client emails show up in Triage.",
      )
    } catch (err) {
      toastError(err, "Couldn't start the resync")
    } finally {
      setResyncing(false)
    }
  }

  async function handleConnect() {
    if (!isOAuth) {
      setConnectOpen(true)
      return
    }
    setRedirecting(true)
    try {
      const params = new URLSearchParams(window.location.search)
      params.delete("gmail")
      params.delete("reason")
      params.delete("t")
      const query = params.toString()
      const { url } = await startGmailConnect({
        returnTo: `${window.location.pathname}${query ? `?${query}` : ""}`,
      })
      window.location.assign(url)
    } catch (err) {
      setRedirecting(false)
      toastError(err, `Couldn't start the ${connector.displayName} sign-in`)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{connector.displayName}</h3>
            {!connector.isDemo && <ConnectorStatus status={connector.status} />}
          </div>

          {connector.isDemo ? (
            <p className="text-sm text-muted-foreground">
              Demo mailbox with seed data — not connected to Google. Remove it
              (devSeedEmail:reset) to connect your own.
            </p>
          ) : isConnected || (isOAuth && needsReconnect) ? (
            <div className="flex flex-col gap-1 text-sm">
              {connector.mask &&
                (isOAuth ? (
                  <span className="truncate text-foreground/90">{connector.mask}</span>
                ) : (
                  <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80">
                    {connector.mask}
                  </code>
                ))}
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
                {isOAuth ? ` · ${syncLabel(connector.sync)}` : null}
              </p>
              {isOAuth && connector.sync?.error && (
                <p className="text-xs text-destructive">
                  Sync error: {connector.sync.error.message}
                  {connector.sync.error.fix ? (
                    <span className="text-muted-foreground"> {connector.sync.error.fix}</span>
                  ) : null}
                </p>
              )}
              {isOAuth && connector.sync?.unprocessable && (
                <p className="text-xs text-muted-foreground">
                  {connector.sync.unprocessable.count === 1
                    ? "1 email couldn't be read and was skipped — open it in Gmail."
                    : `${connector.sync.unprocessable.count} emails couldn't be read and were skipped — open them in Gmail.`}
                </p>
              )}
              {isOAuth && needsReconnect && (
                <p className="text-xs text-muted-foreground">
                  {connector.status === "expired"
                    ? "Google ended this connection. Reconnect to keep syncing."
                    : "This connection can't be used. Reconnect to fix it."}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {connector.description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connector.isDemo ? null : isConnected ? (
            <>
              {isOAuth && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleResync()}
                  disabled={resyncing || connector.sync?.resyncing === true}
                >
                  {resyncing || connector.sync?.resyncing ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Resync last 7 days
                </Button>
              )}
              {!isOAuth && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConnectOpen(true)}
                >
                  Reconnect
                </Button>
              )}
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
            <>
              {isOAuth && needsReconnect && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDisconnectOpen(true)}
                  className="text-destructive hover:text-destructive"
                >
                  Disconnect
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void handleConnect()}
                disabled={redirecting}
              >
                {redirecting ? (
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <PlugZapIcon className="size-3.5" aria-hidden />
                )}
                {connector.status === null || connector.status === "revoked"
                  ? "Connect"
                  : "Reconnect"}
              </Button>
            </>
          )}
        </div>
      </div>

      {!isOAuth && (
        <ConnectTokenDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          connector={connector}
        />
      )}
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`Disconnect ${connector.displayName}?`}
        description={
          isOAuth
            ? "Access is revoked at Google and the stored credentials are deleted. Syncing and sending from this mailbox stop until you reconnect."
            : "Agents you run will no longer be able to use it until you reconnect. Nothing else is affected."
        }
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={handleDisconnect}
      />
    </div>
  )
}

function syncLabel(sync: ConnectorListItem["sync"]): string {
  if (sync?.resyncing) return "resyncing the last 7 days…"
  if (!sync?.lastSyncAt) return "not synced yet"
  // An idle mailbox records its sync at most every 5 minutes (B3).
  if (Date.now() - sync.lastSyncAt < 6 * 60_000) return "last sync · a few minutes ago"
  return `last sync ${formatRelativeTime(sync.lastSyncAt)}`
}

// ─── Status (quiet: dot + muted text, no pill) ──────────────────────────────

const STATUS_COPY: Record<NonNullable<ConnectorListItem["status"]>, { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-500" },
  expired: { label: "Expired", dot: "bg-amber-500" },
  error: { label: "Error", dot: "bg-red-500" },
  revoked: { label: "Disconnected", dot: "bg-muted-foreground/40" },
}

function ConnectorStatus({ status }: { status: ConnectorListItem["status"] }) {
  const copy = status ? STATUS_COPY[status] : { label: "Not connected", dot: "bg-muted-foreground/40" }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", copy.dot)} aria-hidden />
      {copy.label}
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
