"use client"

import { Fragment } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { ClientColorAvatar } from "@/components/clients/client-color-avatar"
import { ProjectCountBadge } from "@/components/project-count-badge"
import { RowActionMenu } from "@/components/row-action-menu"
import { ArchivedBadge } from "@/components/archived-badge"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  ChevronDownIcon,
} from "lucide-react"
import type { Doc } from "@/convex/_generated/dataModel"

type ClientWithContacts = Doc<"clients"> & {
  primaryContact: { name: string; email: string } | null
  activeProjectCount: number
  logoUrl: string | null
}

interface ClientsTableProps {
  clients: ClientWithContacts[]
  groupedClients: Map<string, ClientWithContacts[]> | null
  sortBy: "name" | "projects"
  onSortToggle: () => void
  onEdit: (client: Doc<"clients">) => void
  onArchive: (client: ClientWithContacts) => void
  onRestore: (client: Doc<"clients">) => void
  onDelete: (client: Doc<"clients">) => void
}

export function ClientsTable({
  clients,
  groupedClients,
  sortBy,
  onSortToggle,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: ClientsTableProps) {
  const router = useRouter()

  function renderRow(client: ClientWithContacts) {
    return (
      <TableRow
        key={client._id}
        className="cursor-pointer transition-colors hover:bg-muted/50"
        onClick={() => router.push(`/clients/${client._id}`)}
      >
        <TableCell>
          <div className="flex items-center gap-3">
            <ClientColorAvatar name={client.name} logoUrl={client.logoUrl} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{client.name}</span>
                {client.archivedAt && <ArchivedBadge />}
              </div>
              <p className="text-xs text-muted-foreground">{client.invoicePrefix}</p>
            </div>
          </div>
        </TableCell>

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

        <TableCell>
          <ProjectCountBadge count={client.activeProjectCount} />
        </TableCell>

        <TableCell>
          <Badge variant="secondary">{client.currency}</Badge>
        </TableCell>

        <TableCell>
          {client.notes ? (
            <p className="max-w-[200px] truncate text-sm text-muted-foreground">{client.notes}</p>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        <TableCell>
          <RowActionMenu>
            <DropdownMenuItem onClick={() => onEdit(client)}>
              <PencilIcon className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {client.archivedAt ? (
              <DropdownMenuItem onClick={() => onRestore(client)}>
                <ArchiveRestoreIcon className="size-4" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onArchive(client)}>
                <ArchiveIcon className="size-4" />
                Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(client)}
            >
              <Trash2Icon className="size-4" />
              Delete
            </DropdownMenuItem>
          </RowActionMenu>
        </TableCell>
      </TableRow>
    )
  }

  return (
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
                onClick={onSortToggle}
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
                {group.map(renderRow)}
              </Fragment>
            ))
          ) : (
            clients.map(renderRow)
          )}
        </TableBody>
      </Table>
    </div>
  )
}
