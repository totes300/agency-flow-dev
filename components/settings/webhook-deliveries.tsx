"use client"
/**
 * The endpoint's last 20 delivery attempts (W6; mockup frame B): a quiet
 * list — status icon, event, task ref, outcome, time. Plain text, no pills.
 */
import { useQuery } from "convex/react"
import { format, isToday } from "date-fns"
import { CircleCheckIcon, CircleXIcon, ClockIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { webhookEventLabel } from "@/lib/webhook-events"

/** Attempts per event: the first plus three retries (convex/webhooks.ts). */
const MAX_ATTEMPTS = 4

type Delivery = {
  status: "pending" | "ok" | "failed"
  attempt: number
  httpStatus: number | null
  error: string | null
  nextAttemptAt: number | null
}

const time = (at: number) => format(at, isToday(at) ? "HH:mm" : "d MMM HH:mm")

/** What happened, in a few words: the HTTP code or error, the attempt, the next retry. */
export function deliveryOutcome(d: Delivery): string {
  if (d.status === "pending") return `Pending · attempt ${d.attempt} of ${MAX_ATTEMPTS}`
  const result = d.httpStatus !== null ? String(d.httpStatus) : (d.error ?? "Failed")
  const parts = [result]
  if (d.status === "ok" && d.attempt > 1) parts.push(`attempt ${d.attempt}`)
  if (d.status === "failed" && d.nextAttemptAt !== null) parts.push(`retry at ${time(d.nextAttemptAt)}`)
  return parts.join(" · ")
}

export function WebhookDeliveries({ endpointId }: { endpointId: Id<"webhookEndpoints"> }) {
  const deliveries = useQuery(api.webhooks.recentDeliveries, { endpointId })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Recent deliveries</h3>
        <span className="text-xs text-muted-foreground">Last 20 · kept 7 days</span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {deliveries === undefined ? (
          <div className="flex flex-col">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex h-[38px] items-center gap-3 border-t px-4 first:border-t-0">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        ) : deliveries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No deliveries yet. Send a test event to check your endpoint.
          </p>
        ) : (
          deliveries.map((d) => (
            <div
              key={d._id}
              className="grid h-[38px] grid-cols-[16px_minmax(0,1fr)_56px] items-center gap-3 border-t px-4 text-sm first:border-t-0 hover:bg-muted sm:grid-cols-[16px_minmax(0,1.3fr)_84px_minmax(0,1fr)_72px]"
            >
              {d.status === "ok" ? (
                <CircleCheckIcon className="size-4 text-success" aria-label="Delivered" />
              ) : d.status === "failed" ? (
                <CircleXIcon className="size-4 text-destructive" aria-label="Failed" />
              ) : (
                <ClockIcon className="size-4 text-muted-foreground" aria-label="Pending" />
              )}
              <span className="truncate">{webhookEventLabel(d.event)}</span>
              <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">{d.task ?? ""}</span>
              <span className="hidden truncate text-muted-foreground sm:block" title={d.error ?? undefined}>
                {deliveryOutcome(d)}
              </span>
              <span className="text-right text-muted-foreground tabular-nums">{time(d.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
