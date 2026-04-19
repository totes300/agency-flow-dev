"use client"

import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { DialogClose } from "@/components/ui/dialog"
import {
  FormModal,
  FormModalBody,
  FormModalDescription,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
} from "@/components/ui/form-modal"
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

  const isEdit = Boolean(contact)

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
    <FormModal
      open={open}
      onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}
      size="md"
    >
      <FormModalHeader>
        <FormModalTitle>{isEdit ? "Edit Contact" : "Add Contact"}</FormModalTitle>
        <FormModalDescription srOnly>
          {isEdit ? "Update contact details." : "Add a new contact for this client."}
        </FormModalDescription>
      </FormModalHeader>

      <form onSubmit={handleSubmit}>
        <FormModalBody>
          <Field>
            <FieldLabel htmlFor="contact-name">Name</FieldLabel>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              autoFocus
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="contact-email">Email</FieldLabel>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
            <Input
              id="contact-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
            />
          </Field>

          {!isEdit && !isFirstContact && (
            <Field orientation="horizontal">
              <Checkbox
                id="is-primary"
                checked={isPrimary}
                onCheckedChange={(checked) => setIsPrimary(checked === true)}
              />
              <FieldLabel htmlFor="is-primary" className="font-normal">
                Set as primary contact
              </FieldLabel>
            </Field>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </FormModalBody>

        <FormModalFooter>
          <Button
            type="submit"
            disabled={!name.trim() || !email.trim() || submitting}
            size="lg"
            className="h-11 w-full text-base"
          >
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Add Contact"}
          </Button>
          <DialogClose asChild>
            <button
              type="button"
              disabled={submitting}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Cancel
            </button>
          </DialogClose>
        </FormModalFooter>
      </form>
    </FormModal>
  )
}
