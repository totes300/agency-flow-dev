"use client"

import { useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  DirectoryView,
  DirectoryEmpty,
  DirectorySkeleton,
} from "@/components/directory/directory-view"
import {
  DirectoryDisplayMenu,
  DirectoryMenuOptions,
} from "@/components/directory/directory-menu"
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ClientsTable } from "@/components/clients/clients-table"
import dynamic from "next/dynamic"
const ClientFormModal = dynamic(() =>
  import("@/components/clients/client-form-modal").then((m) => ({
    default: m.ClientFormModal,
  })),
)
import { useUndoAction } from "@/lib/hooks/use-undo-action"

import { toast } from "sonner"
import type { Doc } from "@/convex/_generated/dataModel"

type GroupBy = "none" | "currency"
type SortBy = "name" | "projects"

export default function ClientsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  // One subscription for both tabs: Active/All re-filters loaded rows, so a
  // switch never drops back to the skeleton (or loses keyboard focus).
  const clients = useQuery(api.clients.listWithContacts, {
    includeArchived: true,
  })
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Doc<"clients"> | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<Doc<"clients"> | null>(null)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const { trigger: triggerUndo } = useUndoAction()

  const processedClients = useMemo(() => {
    if (!clients) return []
    const result = []
    const q = deferredSearch.toLowerCase()
    for (const c of clients) {
      if (hiddenIds.has(c._id)) continue
      if (!includeArchived && c.archivedAt) continue
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
  }, [clients, hiddenIds, includeArchived, deferredSearch, sortBy])

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

  if (!clients) return <DirectorySkeleton />

  function handleArchive(
    client: Doc<"clients"> & { activeProjectCount: number },
  ) {
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
      toast.info(
        "Client restored. Projects and tasks are still archived — restore them individually.",
      )
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
      toast.error(
        err instanceof Error ? err.message : "Failed to delete client",
      )
    }
  }

  return (
    <DirectoryView
      name="clients"
      includeArchived={includeArchived}
      onIncludeArchivedChange={setIncludeArchived}
      search={search}
      onSearchChange={setSearch}
      onCreate={() => setCreateOpen(true)}
      controls={
        <DirectoryDisplayMenu
          label="Client display options"
          modified={sortBy !== "name" || groupBy !== "none"}
        >
          <DirectoryMenuOptions<GroupBy>
            label="Group by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "none", label: "No grouping" },
              { value: "currency", label: "Currency" },
            ]}
          />
          <DropdownMenuSeparator />
          <DirectoryMenuOptions<SortBy>
            label="Sort by"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "name", label: "Name" },
              { value: "projects", label: "Active projects" },
            ]}
          />
        </DirectoryDisplayMenu>
      }
    >
      {/* Table */}
      {processedClients.length === 0 ? (
        <DirectoryEmpty
          name="clients"
          filtered={!!search}
          hasArchived={!includeArchived && clients.some((c) => c.archivedAt)}
          onReset={() => {
            setSearch("")
          }}
          onShowAll={() => setIncludeArchived(true)}
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <ClientsTable
          clients={processedClients}
          groupedClients={groupedClients}
          sortBy={sortBy}
          onSortToggle={() =>
            setSortBy(sortBy === "projects" ? "name" : "projects")
          }
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
        onOpenChange={(open) => {
          if (!open) setEditingClient(null)
        }}
        client={editingClient}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete client"
        description={`This will permanently delete "${deleteTarget?.name}" and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </DirectoryView>
  )
}
