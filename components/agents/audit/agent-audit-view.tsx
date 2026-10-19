"use client"

/**
 * Admin audit view (`?view=audit`, slice 11 · US 52, 54). A table of every run
 * in the org — who ran which agent, when, outcome, token usage — with
 * URL-persisted filters (agent / user / status / date range) per repo
 * convention. A row opens the thread read-only (admins get read access via
 * `threadAccess` (read, not write); the composer + proposal controls are inert there).
 * Admin-gated: members never reach the data query (server-enforced too).
 */

import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { ClipboardListIcon, ExternalLinkIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { WorkspaceEmptyState } from "@/components/agents/workspace-empty-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const ALL = "all"

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "stopped_by_skill", label: "Stopped by skill" },
]

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label]),
)

export function AgentAuditView() {
  const { membership } = useOrganization()
  if (membership === undefined) return <AuditSkeleton />
  if (membership?.role !== "org:admin") return <WorkspaceEmptyState />
  return <AuditContent />
}

function AuditContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Namespaced so they never collide with the pane-routing params
  // (`thread` / `agent` / `view`) that `thread-pane.tsx` dispatches on.
  const agent = searchParams.get("runAgent") ?? ALL
  const user = searchParams.get("runUser") ?? ALL
  const status = searchParams.get("runStatus") ?? ALL
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""

  const hasFilters =
    agent !== ALL || user !== ALL || status !== ALL || from !== "" || to !== ""

  /** Persist a single filter param in the URL (replace — no history spam). */
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    next.set("view", "audit")
    if (value === null || value === "" || value === ALL) next.delete(key)
    else next.set(key, value)
    router.replace(`/agents?${next.toString()}`)
  }

  const runs = useQuery(api.agentAudit.listRuns, {
    agentId: agent === ALL ? undefined : agent,
    userId: user === ALL ? undefined : user,
    status: status === ALL ? undefined : status,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  })
  const agents = useQuery(api.agents.listAll, { includeSystem: true })
  const members = useQuery(api.orgMembers.listOrgMembers, {})

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <ClipboardListIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Audit</span>
        <span className="text-xs text-muted-foreground">All runs</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          {/* Filter bar (URL-persisted) */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              value={agent}
              onValueChange={(v) => setParam("runAgent", v)}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All agents</SelectItem>
                {(agents ?? []).map((a) => (
                  <SelectItem key={a._id} value={a._id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={user} onValueChange={(v) => setParam("runUser", v)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All users</SelectItem>
                {(members ?? []).map((m) => (
                  <SelectItem key={m._id} value={m._id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status}
              onValueChange={(v) => setParam("runStatus", v)}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              aria-label="From date"
              value={from}
              max={to || undefined}
              onChange={(e) => setParam("from", e.target.value)}
              className="h-8 w-[9.5rem] text-sm"
            />
            <Input
              type="date"
              aria-label="To date"
              value={to}
              min={from || undefined}
              onChange={(e) => setParam("to", e.target.value)}
              className="h-8 w-[9.5rem] text-sm"
            />

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground"
                onClick={() => router.replace("/agents?view=audit")}
              >
                Clear
              </Button>
            )}
          </div>

          {runs === undefined ? (
            <AuditTableSkeleton />
          ) : runs.length === 0 ? (
            <EmptyState
              icon={ClipboardListIcon}
              title={hasFilters ? "No runs match these filters" : "No runs yet"}
              description={
                hasFilters
                  ? "Adjust or clear the filters to see more runs."
                  : "Every agent run in the org will appear here — who ran it, the outcome, and token usage."
              }
              action={
                hasFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => router.replace("/agents?view=audit")}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow
                      key={r._id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/agents?thread=${r.threadId}`)}
                    >
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground"
                        title={new Date(r.startedAt).toLocaleString()}
                      >
                        {formatRelativeTime(r.startedAt)}
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate font-medium">
                        {r.agentName}
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                        {r.userName}
                      </TableCell>
                      <TableCell>
                        <RunStatusText status={r.status} error={r.error} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatDuration(r.durationMs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.totalTokens?.toLocaleString() ?? "—"}
                      </TableCell>
                      <TableCell>
                        <ExternalLinkIcon
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Quiet status text — destructive only for failure, muted otherwise. */
function RunStatusText({
  status,
  error,
}: {
  status: string
  error: string | null
}) {
  const label = STATUS_LABEL[status] ?? status
  const isFail = status === "failed"
  return (
    <span
      className={cn(
        "text-sm",
        isFail ? "text-destructive" : "text-muted-foreground",
        status === "succeeded" && "text-foreground",
      )}
      title={error ?? undefined}
    >
      {label}
    </span>
  )
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ─── Skeletons (content-aware) ──────────────────────────────────────────────

function AuditTableSkeleton() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="rounded-lg border">
        <div className="flex flex-col divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function AuditSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <AuditTableSkeleton />
      </div>
    </div>
  )
}
