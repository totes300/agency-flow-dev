"use client"

import { Fragment, useState, useDeferredValue, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState } from "@/components/empty-state"
import { ClientFormModal } from "@/components/clients/client-form-modal"
import { ClientColorAvatar } from "@/components/clients/client-color-avatar"
import { ProjectCountBadge } from "@/components/project-count-badge"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import {
  UsersIcon,
  PlusIcon,
  SearchIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  ChevronDownIcon,
  ListFilterIcon,
  ArrowUpDownIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Doc } from "@/convex/_generated/dataModel"

type GroupBy = "none" | "currency"
type SortBy = "name" | "projects"

function ClientsListSkeleton() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Stats + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center divide-x">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 first:pl-0">
              <Skeleton className="mb-1 h-3 w-16" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Client</TableHead>
              <TableHead>Primary contact</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead className="w-28">Projects</TableHead>
              <TableHead className="w-24">Currency</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-lg" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-5 w-10 rounded-md" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="size-7" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function ClientsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const clients = useQuery(api.clients.listWithContacts, { includeArchived })
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)
  const router = useRouter()

  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Doc<"clients"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Doc<"clients"> | null>(null)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const { trigger: triggerUndo } = useUndoAction()

  // Computed: filtered + sorted clients
  const processedClients = useMemo(() => {
    if (!clients) return []

    const filtered = clients
      .filter((c) => !hiddenIds.has(c._id))
      .filter((c) => c.name.toLowerCase().includes(deferredSearch.toLowerCase()))

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "projects") {
        const diff = b.activeProjectCount - a.activeProjectCount
        if (diff !== 0) return diff
      }
      return a.name.localeCompare(b.name)
    })

    return sorted
  }, [clients, hiddenIds, deferredSearch, sortBy])

  // Computed stats (from all clients, not filtered)
  const stats = useMemo(() => {
    if (!clients) return { active: 0, projects: 0, currencies: 0 }
    const nonHidden = clients.filter((c) => !hiddenIds.has(c._id))
    return {
      active: nonHidden.filter((c) => !c.archivedAt).length,
      projects: nonHidden.reduce((sum, c) => sum + c.activeProjectCount, 0),
      currencies: new Set(nonHidden.map((c) => c.currency)).size,
    }
  }, [clients, hiddenIds])

  // Grouping
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

  function handleArchive(client: Doc<"clients">) {
    const clientId = client._id
    setHiddenIds((prev) => new Set(prev).add(clientId))

    triggerUndo({
      message: `"${client.name}" archived`,
      action: async () => {
        await archiveClient({ id: clientId })
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(clientId)
          return next
        })
      },
      onUndo: () => {
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(clientId)
          return next
        })
      },
      onError: () => {
        setHiddenIds((prev) => {
          const next = new Set(prev)
          next.delete(clientId)
          return next
        })
      },
    })
  }

  function handleRestore(client: Doc<"clients">) {
    restoreClient({ id: client._id })
    toast.info("Client restored. Projects and tasks are still archived — restore them individually.")
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

  function renderClientRow(client: (typeof processedClients)[number]) {
    return (
      <TableRow
        key={client._id}
        className="cursor-pointer transition-colors hover:bg-muted/50"
        onClick={() => router.push(`/clients/${client._id}`)}
      >
        {/* Client */}
        <TableCell>
          <div className="flex items-center gap-3">
            <ClientColorAvatar name={client.name} logoUrl={client.logoUrl} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{client.name}</span>
                {client.archivedAt && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] leading-tight">Archived</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{client.invoicePrefix}</p>
            </div>
          </div>
        </TableCell>

        {/* Primary contact */}
        <TableCell>
          {client.primaryContact ? (
            <div className="min-w-0">
              <p className="truncate text-sm">{client.primaryContact.name}</p>
              <p className="truncate text-xs text-muted-foreground">{client.primaryContact.email}</p>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        {/* Billing */}
        <TableCell>
          {client.billingName ? (
            <div className="min-w-0">
              <p className="truncate text-sm">{client.billingName}</p>
              {(client.billingCity || client.billingCountry) && (
                <p className="truncate text-xs text-muted-foreground">
                  {[client.billingCity, client.billingCountry].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        {/* Projects */}
        <TableCell>
          <ProjectCountBadge count={client.activeProjectCount} />
        </TableCell>

        {/* Currency */}
        <TableCell>
          <Badge variant="secondary">{client.currency}</Badge>
        </TableCell>

        {/* Notes */}
        <TableCell>
          {client.notes ? (
            <p className="max-w-[200px] truncate text-sm text-muted-foreground">{client.notes}</p>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => setEditingClient(client)}>
                <PencilIcon className="size-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {client.archivedAt ? (
                <DropdownMenuItem onClick={() => handleRestore(client)}>
                  <ArchiveRestoreIcon className="size-4" />
                  Restore
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => handleArchive(client)}>
                  <ArchiveIcon className="size-4" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(client)}
              >
                <Trash2Icon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
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
            <SelectTrigger className="h-9 rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ListFilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Group:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="none" className="py-2 pl-2.5">None</SelectItem>
              <SelectItem value="currency" className="py-2 pl-2.5">Currency</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 rounded-full px-3.5">
              <span className="flex items-center gap-1.5">
                <ArrowUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Sort:</span>
                <span className="text-sm font-semibold"><SelectValue /></span>
              </span>
            </SelectTrigger>
            <SelectContent position="popper" align="start">
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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead className="w-28">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => setSortBy(sortBy === "projects" ? "name" : "projects")}
                  >
                    Projects
                    {sortBy === "projects" && <ChevronDownIcon className="size-3" />}
                  </button>
                </TableHead>
                <TableHead className="w-24">Currency</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedClients ? (
                Array.from(groupedClients.entries()).map(([currency, group]) => (
                  <Fragment key={currency}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-muted/30 py-2">
                        <div className="flex items-center gap-3">
                          <Badge variant="default">{currency}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {group.length} {group.length === 1 ? "client" : "clients"}
                          </span>
                          <Separator className="flex-1" />
                        </div>
                      </TableCell>
                    </TableRow>
                    {group.map(renderClientRow)}
                  </Fragment>
                ))
              ) : (
                processedClients.map(renderClientRow)
              )}
            </TableBody>
          </Table>
        </div>
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
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.name}&rdquo; and all associated
              data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
