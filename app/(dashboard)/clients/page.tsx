"use client"

import { useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { ClientsListSkeleton } from "@/components/clients/clients-list-skeleton"
import { ClientsTable } from "@/components/clients/clients-table"
import dynamic from "next/dynamic"
const ClientFormModal = dynamic(() => import("@/components/clients/client-form-modal").then(m => ({ default: m.ClientFormModal })))
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import {
  UsersIcon,
  PlusIcon,
  SearchIcon,
  ListFilterIcon,
  ArrowUpDownIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Doc } from "@/convex/_generated/dataModel"

type GroupBy = "none" | "currency"
type SortBy = "name" | "projects"

export default function ClientsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const clients = useQuery(api.clients.listWithContacts, { includeArchived })
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Doc<"clients"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Doc<"clients"> | null>(null)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const { trigger: triggerUndo } = useUndoAction()

  const processedClients = useMemo(() => {
    if (!clients) return []
    const result = []
    const q = deferredSearch.toLowerCase()
    for (const c of clients) {
      if (hiddenIds.has(c._id)) continue
      if (q && !c.name.toLowerCase().includes(q)) continue
      result.push(c)
    }
    result.sort((a, b) => {
      if (sortBy === "projects") {
        const diff = b.activeProjectCount - a.activeProjectCount
        if (diff !== 0) return diff
      }
      return a.name.localeCompare(b.name)
    })
    return result
  }, [clients, hiddenIds, deferredSearch, sortBy])

  const stats = useMemo(() => {
    if (!clients) return { active: 0, projects: 0, currencies: 0 }
    let active = 0, projects = 0
    const currencySet = new Set<string>()
    for (const c of clients) {
      if (hiddenIds.has(c._id)) continue
      if (!c.archivedAt) active++
      projects += c.activeProjectCount
      currencySet.add(c.currency)
    }
    return { active, projects, currencies: currencySet.size }
  }, [clients, hiddenIds])

  const groupedClients = useMemo(() => {
    if (groupBy === "none") return null
    const groups = new Map<string, typeof processedClients>()
    for (const client of processedClients) {
      const key = client.currency
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(client)
    }
    return groups
  }, [groupBy, processedClients])

  if (!clients) return <ClientsListSkeleton />

  function handleArchive(client: Doc<"clients"> & { activeProjectCount: number }) {
    const clientId = client._id
    setHiddenIds((prev) => new Set(prev).add(clientId))

    const unhide = () => {
      setHiddenIds((prev) => {
        const next = new Set(prev)
        next.delete(clientId)
        return next
      })
    }

    triggerUndo({
      key: clientId,
      message: `"${client.name}" archived`,
      action: async () => {
        await archiveClient({ id: clientId })
        unhide()
      },
      onUndo: unhide,
      onError: unhide,
    })
  }

  async function handleRestore(client: Doc<"clients">) {
    try {
      await restoreClient({ id: client._id })
      toast.info("Client restored. Projects and tasks are still archived — restore them individually.")
    } catch {
      toast.error("Failed to restore client")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await removeClient({ id: deleteTarget._id })
      setDeleteTarget(null)
      toast.success(`"${deleteTarget.name}" deleted`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete client")
    }
  }

  if (clients.length === 0 && !includeArchived) {
    return (
      <>
        <EmptyState
          icon={UsersIcon}
          title="No clients yet"
          description="Clients are the foundation of your work tracking. Add your first client to start creating projects and logging time."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Add your first client
            </Button>
          }
        />
        <ClientFormModal open={createOpen} onOpenChange={setCreateOpen} />
      </>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage your client directory</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-64 pl-9"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            Add Client
          </Button>
        </div>
      </div>

      {/* Stats + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center divide-x">
          <div className="pr-4">
            <p className="text-xs text-muted-foreground">Active clients</p>
            <p className="text-lg font-semibold">{stats.active}</p>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">Active projects</p>
            <p className="text-lg font-semibold">{stats.projects}</p>
          </div>
          <div className="pl-4">
            <p className="text-xs text-muted-foreground">Currencies</p>
            <p className="text-lg font-semibold">{stats.currencies}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-9 w-fit rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ListFilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Group:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="py-2 pl-2.5">None</SelectItem>
              <SelectItem value="currency" className="py-2 pl-2.5">Currency</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 w-fit rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ArrowUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Sort:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name" className="py-2 pl-2.5">Name</SelectItem>
              <SelectItem value="projects" className="py-2 pl-2.5">Projects</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex h-9 items-center gap-2.5 rounded-full border border-input px-3.5">
            <Switch
              id="show-archived"
              size="sm"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="show-archived" className="whitespace-nowrap text-sm font-normal text-muted-foreground">
              Archived
            </Label>
          </div>
        </div>
      </div>

      {/* Table */}
      {processedClients.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {deferredSearch ? "No clients match your search." : "No clients found."}
        </p>
      ) : (
        <ClientsTable
          clients={processedClients}
          groupedClients={groupedClients}
          sortBy={sortBy}
          onSortToggle={() => setSortBy(sortBy === "projects" ? "name" : "projects")}
          onEdit={setEditingClient}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onDelete={setDeleteTarget}
        />
      )}

      {/* Create modal */}
      <ClientFormModal open={createOpen} onOpenChange={setCreateOpen} />

      {/* Edit modal */}
      <ClientFormModal
        open={!!editingClient}
        onOpenChange={(open) => { if (!open) setEditingClient(null) }}
        client={editingClient}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete client"
        description={`This will permanently delete "${deleteTarget?.name}" and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
