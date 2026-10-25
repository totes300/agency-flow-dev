"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { FunctionReturnType } from "convex/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import {
  MoreHorizontalIcon,
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

export type ClientDetail = NonNullable<FunctionReturnType<typeof api.clients.get>>

/** Client detail header: avatar, name, Edit and the archive/restore/delete menu. */
export function ClientDetailHeader({
  client,
  onEdit,
}: {
  client: ClientDetail
  onEdit: () => void
}) {
  const router = useRouter()
  const clientId = client._id
  const archiveClient = useMutation(api.clients.archive)
  const restoreClient = useMutation(api.clients.restore)
  const removeClient = useMutation(api.clients.remove)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { trigger: triggerUndo } = useUndoAction()

  function handleArchive() {
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
      toast.success(`"${client.name}" deleted`)
      router.push("/clients")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete client",
      )
    }
  }

  return (
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
        <Button variant="ghost" size="sm" onClick={onEdit}>
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete client"
        description={`This will permanently delete “${client.name}” and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
