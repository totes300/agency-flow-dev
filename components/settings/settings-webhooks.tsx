"use client"
/**
 * Settings → Webhooks (docs/prd-agent-first-backlog.md §5.6; approved
 * mockup docs/mockups/webhooks-settings.html, v2). One endpoint per
 * workspace (W1): empty state → Add endpoint; otherwise the endpoint's
 * header (URL, Send test, enabled switch, menu), its settings as key/value
 * rows and the recent deliveries. Every function is admin-only in Convex
 * (convex/webhooks.ts); the /settings route is admin-gated too.
 */
import { useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { formatDistanceToNow, format } from "date-fns"
import { EllipsisIcon, Loader2Icon, PencilIcon, RotateCwIcon, SendIcon, Trash2Icon, WebhookIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { summarizeEventTypes } from "@/lib/webhook-events"
import { WebhookDeliveries } from "./webhook-deliveries"
import { WebhookEndpointDialog } from "./webhook-endpoint-dialog"
import { WebhookSecretDialog } from "./webhook-secret-dialog"

const INTRO =
  "A signed POST to your agent within seconds of any task change. It names the task; your agent reads the rest through MCP."

export function SettingsWebhooks() {
  const endpoint = useQuery(api.webhooks.get, {})
  const [editOpen, setEditOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">Webhooks</h2>
        <p className="text-sm text-muted-foreground">{INTRO}</p>
      </div>

      {endpoint === undefined ? (
        <Skeleton className="h-[204px] w-full rounded-xl" />
      ) : endpoint === null ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border bg-card px-6 py-10 text-center">
          <span className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
            <WebhookIcon className="size-4" aria-hidden />
          </span>
          <h3 className="mt-1 text-sm font-semibold">No endpoint yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add your agent&apos;s HTTPS URL. Every task change is sent there, signed with a secret only you see.
          </p>
          <Button size="sm" className="mt-1.5" onClick={() => setEditOpen(true)}>
            Add endpoint
          </Button>
        </div>
      ) : (
        <>
          <EndpointCard endpoint={endpoint} onEdit={() => setEditOpen(true)} onSecret={setSecret} />
          <WebhookDeliveries endpointId={endpoint._id} />
        </>
      )}

      <WebhookEndpointDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        endpoint={
          endpoint
            ? {
                endpointId: endpoint._id,
                url: endpoint.url,
                eventTypes: endpoint.eventTypes,
                excludeClientIds: endpoint.excludeClientIds,
                authKeyHint: endpoint.authKeyHint,
              }
            : undefined
        }
        onCreated={setSecret}
      />
      <WebhookSecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  )
}

type Endpoint = NonNullable<FunctionReturnType<typeof api.webhooks.get>>

function EndpointCard({
  endpoint,
  onEdit,
  onSecret,
}: {
  endpoint: Endpoint
  onEdit: () => void
  onSecret: (secret: string) => void
}) {
  const clients = useQuery(api.webhooks.connectedClients, {})
  const update = useMutation(api.webhooks.update)
  const remove = useMutation(api.webhooks.remove)
  const sendTest = useAction(api.webhooks.sendTest)
  const rotateSecret = useAction(api.webhooks.rotateSecret)
  const [testing, setTesting] = useState(false)
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null)

  async function handleTest() {
    setTesting(true)
    try {
      const result = await sendTest({ endpointId: endpoint._id })
      if (result.status === "ok") toast.success(`Test event delivered (${result.httpStatus}).`)
      else toast.error(result.httpStatus ? `Test event failed with HTTP ${result.httpStatus}.` : "Test event failed.")
    } catch (err) {
      toastError(err, "Couldn't send the test event")
    } finally {
      setTesting(false)
    }
  }

  async function handleEnabled(enabled: boolean) {
    try {
      await update({ endpointId: endpoint._id, enabled })
    } catch (err) {
      toastError(err, "Couldn't update the endpoint")
    }
  }

  async function handleRotate() {
    try {
      const { secret } = await rotateSecret({ endpointId: endpoint._id })
      setConfirm(null)
      onSecret(secret)
    } catch (err) {
      toastError(err, "Couldn't rotate the secret")
    }
  }

  async function handleDelete() {
    try {
      await remove({ endpointId: endpoint._id })
      setConfirm(null)
      toast.success("Endpoint deleted.")
    } catch (err) {
      toastError(err, "Couldn't delete the endpoint")
    }
  }

  const clientName = new Map((clients ?? []).map((c) => [c.clientId, c.clientName]))
  const skipped = endpoint.excludeClientIds.map((id) => clientName.get(id) ?? id)

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
          <WebhookIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12.5px]">{endpoint.url}</p>
          <p className="text-xs text-muted-foreground">
            Added {format(endpoint.createdAt, "d MMM")}
            {endpoint.createdByName ? ` by ${endpoint.createdByName}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
          <span className="hidden sm:inline">Send test</span>
        </Button>
        <Switch
          checked={endpoint.enabled}
          onCheckedChange={handleEnabled}
          aria-label={endpoint.enabled ? "Disable endpoint" : "Enable endpoint"}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Endpoint actions">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              Edit endpoint
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirm("rotate")}>
              <RotateCwIcon />
              Rotate secret
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
              <Trash2Icon />
              Delete endpoint
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Row label="Events">{summarizeEventTypes(endpoint.eventTypes)}</Row>
      <Row label="Skips writes by">
        {skipped.length > 0 ? skipped.join(", ") : <span className="text-muted-foreground">No apps</span>}
      </Row>
      <Row label="Signing secret">
        <span className="font-mono text-xs text-muted-foreground">••••••••{endpoint.secretHint}</span>
      </Row>
      <Row label="Authorization">
        {endpoint.authKeyHint ? (
          <span className="font-mono text-xs text-muted-foreground">Bearer ••••••••{endpoint.authKeyHint}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </Row>
      <Row label="Last delivery">
        <LastDelivery endpoint={endpoint} />
      </Row>

      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Rotate the signing secret?"
        description="The current secret stops signing at once. Update your agent with the new secret, or it will reject the next deliveries."
        confirmLabel="Rotate"
        onConfirm={handleRotate}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this endpoint?"
        description="Agency Flow stops sending events to it at once, queued retries included. You can add an endpoint again later; it gets a new secret."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-1 items-center gap-x-3 gap-y-0.5 border-t px-4 py-2 text-sm sm:grid-cols-[168px_minmax(0,1fr)]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}

function LastDelivery({ endpoint }: { endpoint: Endpoint }) {
  if (endpoint.lastDeliveryAt === null || endpoint.lastDeliveryStatus === null) {
    return <span className="text-muted-foreground">No deliveries yet</span>
  }
  const ok = endpoint.lastDeliveryStatus === "ok"
  return (
    <span className="flex items-center gap-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} aria-hidden />
      {ok ? "Delivered" : "Failed"} {formatDistanceToNow(endpoint.lastDeliveryAt, { addSuffix: true })}
      {endpoint.lastDeliveryHttpStatus !== null && (
        <span className="text-muted-foreground">· {endpoint.lastDeliveryHttpStatus}</span>
      )}
    </span>
  )
}
