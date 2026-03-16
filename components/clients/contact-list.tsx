"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ContactFormModal } from "./contact-form-modal"
import { MoreHorizontalIcon, PlusIcon, StarIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { Id, Doc } from "@/convex/_generated/dataModel"

type ContactListProps = {
  clientId: Id<"clients">
  contacts: Doc<"clientContacts">[]
}

export function ContactList({ clientId, contacts }: ContactListProps) {
  const removeContact = useMutation(api.clientContacts.remove)
  const setPrimary = useMutation(api.clientContacts.setPrimary)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Doc<"clientContacts"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Doc<"clientContacts"> | null>(null)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Contacts
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      {contacts.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No contacts yet. Add the first contact for this client.
        </p>
      ) : (
        <div className="divide-y">
          {contacts.map((contact) => (
            <div key={contact._id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{contact.name}</span>
                  {contact.isPrimary && (
                    <Badge variant="secondary" className="text-[10px] leading-tight">
                      Primary
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0">
                    <MoreHorizontalIcon className="size-4" />
                    <span className="sr-only">Actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditingContact(contact)}>
                    <PencilIcon className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  {!contact.isPrimary && (
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          await setPrimary({ id: contact._id })
                          toast.success(`${contact.name} is now the primary contact`)
                        } catch {
                          toast.error("Failed to set primary contact")
                        }
                      }}
                    >
                      <StarIcon className="size-4" />
                      Set as Primary
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(contact)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Create contact modal */}
      <ContactFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        clientId={clientId}
        isFirstContact={contacts.length === 0}
      />

      {/* Edit contact modal */}
      <ContactFormModal
        open={!!editingContact}
        onOpenChange={(open) => { if (!open) setEditingContact(null) }}
        clientId={clientId}
        contact={editingContact}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete contact"
        description={`Are you sure you want to delete \u201c${deleteTarget?.name}\u201d? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) {
            try {
              await removeContact({ id: deleteTarget._id })
              setDeleteTarget(null)
            } catch {
              toast.error("Failed to delete contact")
            }
          }
        }}
      />
    </div>
  )
}
