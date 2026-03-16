"use client"

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
  FileTextIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ClientDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-11 rounded-[10px]" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center border-y py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1 px-7 first:pl-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex gap-8">
        <div className="flex-1 space-y-6">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <div className="w-[340px] shrink-0 space-y-5">
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

// ─── Stat block ───────────────────────────────────────────────────────────────

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tracking-tight">{value}</span>
    </div>
  )
}

// ─── Billing row ──────────────────────────────────────────────────────────────

function BillingRow({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`text-right text-[13px] font-medium ${multiline ? "whitespace-pre-line" : ""}`}>
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
  const cityLine = [client.billingZip, client.billingCity].filter(Boolean).join(" ")
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
  const contacts = useQuery(api.clientContacts.list, { clientId })
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { trigger: triggerUndo } = useUndoAction()

  useBreadcrumbTitle(client?.name ?? null)

  if (client === undefined || contacts === undefined) return <ClientDetailSkeleton />
  if (client === null) {
    router.replace("/clients")
    return null
  }

  const hasBilling = client.billingName || client.taxId || client.billingEmail ||
    client.billingStreet || client.billingCity || client.billingCountry
  const address = formatAddress(client)

  // Placeholder stats — will be wired to real data in later phases
  const stats = {
    activeProjects: 0,
    unbilledHours: 0,
    openTasks: 0,
    revenueThisYear: "€0",
  }

  function handleArchive() {
    if (!client) return
    triggerUndo({
      key: clientId,
      message: `"${client.name}" archived`,
      action: async () => { await archiveClient({ id: clientId }) },
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
      toast.info("Client restored. Projects and tasks are still archived — restore them individually.")
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
      toast.error(err instanceof Error ? err.message : "Failed to delete client")
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
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
              <h1 className="truncate text-xl font-semibold tracking-tight">{client.name}</h1>
              {client.archivedAt && <Badge variant="secondary" className="shrink-0 text-xs">Archived</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {[client.currency, client.invoicePrefix].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm">
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

      {/* ── Stats bar ───────────────────────────────── */}
      <div className="flex items-stretch border-y">
        <div className="py-4 pr-7">
          <StatBlock label="Active projects" value={stats.activeProjects} />
        </div>
        <Separator orientation="vertical" />
        <div className="px-7 py-4">
          <StatBlock label="Unbilled hours" value={stats.unbilledHours} />
        </div>
        <Separator orientation="vertical" />
        <div className="px-7 py-4">
          <StatBlock label="Open tasks" value={stats.openTasks} />
        </div>
        <Separator orientation="vertical" />
        <div className="px-7 py-4">
          <StatBlock label="Revenue this year" value={stats.revenueThisYear} />
        </div>
      </div>

      {/* ── Two-column content ──────────────────────── */}
      <div className="flex gap-8">
        {/* Left column — Projects, Notes, Documents */}
        <div className="flex min-w-0 flex-1 flex-col gap-7">
          {/* Projects */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Projects</h2>
              <Button variant="secondary" size="sm" disabled>
                <FolderIcon className="size-3.5" />
                Add
              </Button>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
              <FolderIcon className="size-4 shrink-0 text-muted-foreground/40" />
              Projects will appear here once created.
            </div>
          </section>

          {/* Notes */}
          {client.notes && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {client.notes}
              </p>
            </section>
          )}

          {/* Documents */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Documents</h2>
              <Button variant="secondary" size="sm" disabled>
                <UploadIcon className="size-3.5" />
                Upload
              </Button>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground/40" />
              Upload proposals, agreements, or other files.
            </div>
          </section>
        </div>

        {/* Right column — Billing, Contacts */}
        <div className="flex w-[340px] shrink-0 flex-col gap-5">
          {/* Billing */}
          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Billing
            </h2>
            {hasBilling ? (
              <div className="space-y-2.5">
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
          <div className="rounded-lg bg-muted/50 p-4">
            <ContactList clientId={clientId} contacts={contacts} />
          </div>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────── */}
      <ClientFormModal open={editOpen} onOpenChange={setEditOpen} client={client} />

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
