"use client"
/**
 * Add / Edit webhook endpoint (Settings → Webhooks, mockup
 * docs/mockups/webhooks-settings.html frame C). The URL, the event filter
 * (all, or chosen families/types), an optional bearer key for receivers
 * that require one, and the OAuth clients whose writes are skipped (W5). Validation lives in convex/webhooks.ts; errors come back as
 * toasts. Create returns the signing secret, handed to `onCreated`.
 */
import { useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { ChevronRightIcon, Loader2Icon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ActivityType } from "@/convex/tasks/model"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { WEBHOOK_EVENT_FAMILIES, WEBHOOK_EVENT_LABELS, WEBHOOK_PICKER_TYPES } from "@/lib/webhook-events"

export type WebhookEndpointValues = {
  endpointId: Id<"webhookEndpoints">
  url: string
  eventTypes: string[] | null
  excludeClientIds: string[]
  /** Last 4 characters of the stored key; null when there is none. */
  authKeyHint: string | null
}

export function WebhookEndpointDialog({
  open,
  onOpenChange,
  endpoint,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absent = Add endpoint. */
  endpoint?: WebhookEndpointValues
  onCreated: (secret: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        {/* Remount per open so the form starts from the saved values. */}
        {open && <EndpointForm endpoint={endpoint} onDone={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function EndpointForm({
  endpoint,
  onDone,
  onCreated,
}: {
  endpoint?: WebhookEndpointValues
  onDone: () => void
  onCreated: (secret: string) => void
}) {
  const clients = useQuery(api.webhooks.connectedClients, {})
  const create = useAction(api.webhooks.create)
  const update = useMutation(api.webhooks.update)
  const [url, setUrl] = useState(endpoint?.url ?? "")
  const [mode, setMode] = useState<"all" | "selected">(endpoint?.eventTypes ? "selected" : "all")
  const [selected, setSelected] = useState<Set<string>>(new Set(endpoint?.eventTypes ?? []))
  const [excluded, setExcluded] = useState<Set<string>>(new Set(endpoint?.excludeClientIds ?? []))
  // Empty = keep the stored key (edit) or none (add); never prefilled with the key itself.
  const [authKey, setAuthKey] = useState("")
  const [removeKey, setRemoveKey] = useState(false)
  const hasKey = !!endpoint?.authKeyHint && !removeKey
  const [pending, setPending] = useState(false)

  const noEvents = mode === "selected" && selected.size === 0
  const canSave = url.trim().length > 0 && !noEvents && !pending

  async function handleSave() {
    if (!canSave) return
    setPending(true)
    // Every type chosen is the same as "all": store it as all, so new types are included.
    const eventTypes =
      mode === "all" || WEBHOOK_PICKER_TYPES.every((t) => selected.has(t))
        ? null
        : WEBHOOK_PICKER_TYPES.filter((t) => selected.has(t))
    const excludeClientIds = [...excluded]
    try {
      const key = authKey.trim() ? authKey : undefined
      if (endpoint) {
        await update({
          endpointId: endpoint.endpointId,
          url: url.trim(),
          eventTypes,
          excludeClientIds,
          authKey: key ?? (removeKey ? null : undefined),
        })
      } else {
        const { secret } = await create({ url: url.trim(), eventTypes: eventTypes ?? undefined, excludeClientIds, authKey: key })
        onCreated(secret)
      }
      onDone()
    } catch (err) {
      toastError(err, endpoint ? "Couldn't save the endpoint" : "Couldn't add the endpoint")
    } finally {
      setPending(false)
    }
  }

  const toggle = (set: Set<string>, keys: readonly string[], on: boolean) => {
    const next = new Set(set)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    return next
  }

  // Display names that collide get their client id next to them.
  const nameCounts = new Map<string, number>()
  for (const c of clients ?? []) nameCounts.set(c.clientName, (nameCounts.get(c.clientName) ?? 0) + 1)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{endpoint ? "Edit endpoint" : "Add endpoint"}</DialogTitle>
        <DialogDescription>
          {endpoint ? "Changes apply to the next event." : "Every task change is sent here as a signed POST."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-url">Endpoint URL</Label>
          <Input
            id="webhook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://agent.example.com/hooks/agency-flow"
            className="font-mono text-[12.5px]"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            HTTPS with a host name. No IP addresses, localhost or internal hosts.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-auth-key">
            Authorization key <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="webhook-auth-key"
            type="password"
            autoComplete="off"
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder={hasKey ? `••••••••${endpoint?.authKeyHint} · leave empty to keep` : "Paste the key your receiver gave you"}
            className="font-mono text-[12.5px]"
          />
          <p className="text-xs text-muted-foreground">
            Only if your receiver asks for one, e.g. a Cursor automation. Sent as{" "}
            <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
            {hasKey && authKey.length === 0 && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                  onClick={() => setRemoveKey(true)}
                >
                  Remove key
                </button>
              </>
            )}
            {removeKey && !authKey && " The key will be removed when you save."}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Events</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "all" | "selected")} className="gap-2">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="all" />
              All events
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="selected" />
              Only selected
            </label>
          </RadioGroup>
          {mode === "selected" && (
            <div className="mt-1 overflow-hidden rounded-lg border">
              {WEBHOOK_EVENT_FAMILIES.map((family) => (
                <EventFamilyRow
                  key={family.key}
                  label={family.label}
                  types={family.types}
                  selected={selected}
                  onToggle={(keys, on) => setSelected((s) => toggle(s, keys, on))}
                />
              ))}
            </div>
          )}
          {noEvents && <p className="text-xs text-muted-foreground">Choose at least one event.</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Skip writes by</Label>
          {clients === undefined ? null : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">No apps have connected to this workspace yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {clients.map((c) => (
                <label key={c.clientId} className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={excluded.has(c.clientId)}
                    onCheckedChange={(on) => setExcluded((s) => toggle(s, [c.clientId], on === true))}
                  />
                  <span className="truncate">{c.clientName}</span>
                  {(nameCounts.get(c.clientName) ?? 0) > 1 && (
                    <span className="truncate font-mono text-xs text-muted-foreground">{c.clientId}</span>
                  )}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            So your agent isn&apos;t woken by its own writes. Apps from this workspace&apos;s Connected apps.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {pending && <Loader2Icon className="size-3.5 animate-spin" aria-hidden />}
          {endpoint ? "Save" : "Add endpoint"}
        </Button>
      </DialogFooter>
    </>
  )
}

/** One family: a tri-state checkbox for all its types; families with several types expand to pick single ones. */
function EventFamilyRow({
  label,
  types,
  selected,
  onToggle,
}: {
  label: string
  types: readonly ActivityType[]
  selected: Set<string>
  onToggle: (keys: readonly string[], on: boolean) => void
}) {
  const chosen = types.filter((t) => selected.has(t)).length
  const state = chosen === 0 ? false : chosen === types.length ? true : ("indeterminate" as const)
  const [expanded, setExpanded] = useState(state === "indeterminate")
  const expandable = types.length > 1

  return (
    <div className="border-t first:border-t-0">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Checkbox checked={state} onCheckedChange={() => onToggle(types, state !== true)} aria-label={label} />
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left font-medium"
          onClick={() => (expandable ? setExpanded((e) => !e) : onToggle(types, state !== true))}
        >
          {label}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {state === "indeterminate" ? `${chosen} of ${types.length}` : types.length}
          </span>
          {expandable && (
            <ChevronRightIcon
              className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")}
              aria-hidden
            />
          )}
        </button>
      </div>
      {expandable && expanded && (
        <div className="grid grid-cols-1 gap-x-3 gap-y-1 pb-2.5 pl-[34px] pr-3 sm:grid-cols-2">
          {types.map((type) => (
            <label key={type} className="flex items-center gap-2 py-0.5 text-sm text-foreground/80">
              <Checkbox checked={selected.has(type)} onCheckedChange={(on) => onToggle([type], on === true)} />
              {WEBHOOK_EVENT_LABELS[type]}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
