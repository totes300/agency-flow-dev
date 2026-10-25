"use client"

import Link from "next/link"
import { Fragment } from "react"
import { DirectoryTable } from "@/components/directory/directory-table"
import { useRouter } from "next/navigation"
import {
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { ClientColorAvatar } from "@/components/clients/client-color-avatar"
import { RowActionMenu } from "@/components/row-action-menu"
import { ArchivedBadge } from "@/components/archived-badge"
import {
  DropdownMenuGroup,
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
            <ClientColorAvatar
              name={client.name}
              logoUrl={client.logoUrl}
              className="size-6 rounded-md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/clients/${client._id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="truncate rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {client.name}
                </Link>
                {client.archivedAt ? <ArchivedBadge /> : null}
              </div>
            </div>
          </div>
        </TableCell>

        <TableCell>
          {client.primaryContact ? (
            <div className="min-w-0">
              <p className="truncate text-sm">{client.primaryContact.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {client.primaryContact.email}
              </p>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        <TableCell>
          {client.billingName ? (
            <div className="min-w-0">
              <p className="truncate text-sm">{client.billingName}</p>
              {client.billingCity || client.billingCountry ? (
                <p className="truncate text-xs text-muted-foreground">
                  {[client.billingCity, client.billingCountry]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        <TableCell>
          <span className="tabular-nums text-muted-foreground">
            {client.activeProjectCount}
          </span>
        </TableCell>

        <TableCell>
          <span className="text-muted-foreground">{client.currency}</span>
        </TableCell>

        <TableCell>
          {client.notes ? (
            <p className="max-w-[200px] truncate text-sm text-muted-foreground">
              {client.notes}
            </p>
          ) : (
            <span className="text-sm text-muted-foreground">&mdash;</span>
          )}
        </TableCell>

        <TableCell>
          <RowActionMenu>
            <DropdownMenuGroup>
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
            </DropdownMenuGroup>
          </RowActionMenu>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <DirectoryTable aria-label="Clients" className="min-w-[1000px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[26%]">Client</TableHead>
          <TableHead className="w-[22%]">Primary contact</TableHead>
          <TableHead className="w-[20%]">Billing</TableHead>
          <TableHead
            className="w-24"
            aria-sort={sortBy === "projects" ? "descending" : "none"}
          >
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
        {groupedClients
          ? Array.from(groupedClients.entries()).map(([currency, group]) => (
              <Fragment key={currency}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="bg-muted/40 py-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{currency}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.length}{" "}
                        {group.length === 1 ? "client" : "clients"}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
                {group.map(renderRow)}
              </Fragment>
            ))
          : clients.map(renderRow)}
      </TableBody>
    </DirectoryTable>
  )
}
