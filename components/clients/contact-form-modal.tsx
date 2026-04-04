"use client"

import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Id, Doc } from "@/convex/_generated/dataModel"
import { extractErrorMessage } from "@/lib/toast-helpers"

type ContactFormModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: Id<"clients">
  contact?: Doc<"clientContacts"> | null
  isFirstContact?: boolean
}

export function ContactFormModal({
  open,
  onOpenChange,
  clientId,
  contact,
  isFirstContact,
}: ContactFormModalProps) {
  const createContact = useMutation(api.clientContacts.create)
  const updateContact = useMutation(api.clientContacts.update)

  const isEdit = !!contact

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [isPrimary, setIsPrimary] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      if (contact) {
        setName(contact.name)
        setEmail(contact.email)
        setPhone(contact.phone ?? "")
        setIsPrimary(contact.isPrimary)
      } else {
        setName("")
        setEmail("")
        setPhone("")
        setIsPrimary(isFirstContact ?? false)
      }
      setError("")
    }
  }, [open, contact, isFirstContact])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return

    setSubmitting(true)
    setError("")

    try {
      if (isEdit && contact) {
        await updateContact({
          id: contact._id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
        })
      } else {
        await createContact({
          clientId,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          isPrimary,
        })
      }
      onOpenChange(false)
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update contact details." : "Add a new contact for this client."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
            />
          </div>

          {!isEdit && !isFirstContact && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-primary"
                checked={isPrimary}
                onCheckedChange={(checked) => setIsPrimary(checked === true)}
              />
              <Label htmlFor="is-primary" className="font-normal">
                Set as primary contact
              </Label>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={!name.trim() || !email.trim() || submitting}
            className="w-full"
          >
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Add Contact"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
