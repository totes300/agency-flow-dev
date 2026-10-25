"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { BillingTypeBadge } from "@/components/billing-type-badge"
import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ClientFormModal } from "@/components/clients/client-form-modal"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { ContactList } from "@/components/clients/contact-list"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"
import {
  MoreHorizontalIcon,
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  FolderIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ClientDetailSkeleton() {
  return (
    <div
      data-full-bleed
      aria-busy="true"
      aria-label="Loading client"
      className="border-t border-border/60"
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

// ─── Billing row ──────────────────────────────────────────────────────────────

function BillingRow({
  label,
  value,
  multiline,
}: {
  label: string
  value?: string
  multiline?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-[13px]",
          multiline && "whitespace-pre-line",
        )}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Format address ───────────────────────────────────────────────────────────

function formatAddress(client: {
  billingStreet?: string
  billingStreet2?: string
  billingZip?: string
  billingCity?: string
  billingCountry?: string
}): string | undefined {
  const lines: string[] = []
  if (client.billingStreet) lines.push(client.billingStreet)
  if (client.billingStreet2) lines.push(client.billingStreet2)
  const cityLine = [client.billingZip, client.billingCity]
    .filter(Boolean)
    .join(" ")
  if (cityLine) lines.push(cityLine)
  if (client.billingCountry) lines.push(client.billingCountry)
  return lines.length > 0 ? lines.join("\n") : undefined
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as Id<"clients">

  const client = useQuery(api.clients.get, { id: clientId })
  const projects = useQuery(api.projects.list, { includeArchived: false })
  const contacts = useQuery(api.clientContacts.list, { clientId })
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { trigger: triggerUndo } = useUndoAction()

  useBreadcrumbTitle(client?.name ?? null)

  if (client === undefined || contacts === undefined)
    return <ClientDetailSkeleton />
  if (client === null) {
    router.replace("/clients")
    return null
  }

  const hasBilling =
    client.billingName ||
    client.taxId ||
    client.billingEmail ||
    client.billingStreet ||
    client.billingCity ||
    client.billingCountry
  const address = formatAddress(client)

  const clientProjects = projects?.filter(
    (project) => project.clientId === clientId,
  )

  function handleArchive() {
    if (!client) return
    triggerUndo({
      key: clientId,
      message: `"${client.name}" archived`,
      action: async () => {
        await archiveClient({ id: clientId })
      },
      onUndo: async () => {
        try {
          await restoreClient({ id: clientId })
        } catch {
          toast.error("Failed to undo archive")
        }
      },
    })
  }

  async function handleRestore() {
    try {
      await restoreClient({ id: clientId })
      toast.info(
        "Client restored. Projects and tasks are still archived — restore them individually.",
      )
    } catch {
      toast.error("Failed to restore client")
    }
  }

  async function handleDelete() {
    try {
      await removeClient({ id: clientId })
      toast.success(`"${client!.name}" deleted`)
      router.push("/clients")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete client",
      )
    }
  }

  return (
    <div
      data-full-bleed
      className="flex min-w-0 flex-col border-t border-border/60"
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-4 md:px-6">
        <div className="flex items-center gap-3.5">
          <ClientAvatar
            clientId={clientId}
            clientName={client.name}
            logoUrl={client.logoUrl}
            logoStorageId={client.logoStorageId}
            editable
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-medium tracking-tight">
                {client.name}
              </h1>
              {client.archivedAt && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Archived
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {[client.currency, client.prefix ?? client.invoicePrefix]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setEditOpen(true)}
          >
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" className="rounded-full">
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {client.archivedAt ? (
                <DropdownMenuItem onClick={handleRestore}>
                  <ArchiveRestoreIcon className="size-4" />
                  Restore
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={handleArchive}>
                  <ArchiveIcon className="size-4" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Two-column content ──────────────────────── */}
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left column — Projects, Notes, Documents */}
        <div className="flex min-w-0 flex-col gap-8 p-4 md:p-6">
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Projects</h2>
              {clientProjects && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {clientProjects.length}
                </span>
              )}
            </div>
            {clientProjects === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : clientProjects.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                No active projects for this client.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 border-y border-border/60">
                {clientProjects.map((project) => (
                  <li key={project._id}>
                    <Link
                      href={`/projects/${project._id}`}
                      className="flex min-h-11 items-center gap-3 px-2 py-2 text-[13px] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {project.name}
                      </span>
                      <BillingTypeBadge type={project.billingType} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Notes */}
          {client.notes ? (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {client.notes}
              </p>
            </section>
          ) : null}
        </div>

        {/* Right column — Billing, Contacts */}
        <div className="flex min-w-0 flex-col gap-6 border-t border-border/60 p-4 md:p-6 lg:border-t-0 lg:border-l">
          {/* Billing */}
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">Billing</h2>
            {hasBilling ? (
              <div className="flex flex-col gap-2.5">
                <BillingRow label="Company" value={client.billingName} />
                {client.billingName && <Separator />}
                <BillingRow label="Tax ID" value={client.taxId} />
                {client.taxId && <Separator />}
                <BillingRow label="Email" value={client.billingEmail} />
                {client.billingEmail && <Separator />}
                <BillingRow label="Address" value={address} multiline />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No billing details yet. Click Edit to add them.
              </p>
            )}
          </div>

          {/* Contacts */}
          <div className="border-t border-border/60 pt-5">
            <ContactList clientId={clientId} contacts={contacts} />
          </div>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────── */}
      <ClientFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete client"
        description={`This will permanently delete \u201c${client.name}\u201d and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
