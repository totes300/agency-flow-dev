"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { extractErrorMessage } from "@/lib/toast-helpers"

/**
 * Company details — the "From" identity printed on every invoice and used
 * by the seller-identity gate (an invoice cannot be marked as invoiced
 * until at least the company name is set). The org-settings mutation has
 * carried these `brand*` fields since Phase 0; this form is their first
 * edit surface — before it existed, the invoice document's "No name set"
 * placeholder had no fix path.
 */
function SettingsCompanyDetailsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-64" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsCompanyDetailsForm({
  initialName,
  initialAddress,
  initialTaxId,
  initialEmail,
  initialPhone,
}: {
  initialName: string
  initialAddress: string
  initialTaxId: string
  initialEmail: string
  initialPhone: string
}) {
  const updateSettings = useMutation(api.orgSettings.update)

  const [name, setName] = useState(initialName)
  const [address, setAddress] = useState(initialAddress)
  const [taxId, setTaxId] = useState(initialTaxId)
  const [email, setEmail] = useState(initialEmail)
  const [phone, setPhone] = useState(initialPhone)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const hasChanges =
    name !== initialName ||
    address !== initialAddress ||
    taxId !== initialTaxId ||
    email !== initialEmail ||
    phone !== initialPhone

  async function handleSave() {
    setIsSaving(true)
    setSaved(false)
    setError("")
    try {
      const patch: {
        brandName?: string
        brandAddress?: string
        brandTaxId?: string
        brandEmail?: string
        brandPhone?: string
      } = {}
      if (name !== initialName) patch.brandName = name.trim()
      if (address !== initialAddress) patch.brandAddress = address.trim()
      if (taxId !== initialTaxId) patch.brandTaxId = taxId.trim()
      if (email !== initialEmail) patch.brandEmail = email.trim()
      if (phone !== initialPhone) patch.brandPhone = phone.trim()
      await updateSettings(patch)
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-sm font-semibold">Company details</h2>
        <p className="text-[13px] text-muted-foreground">
          Shown as the &ldquo;From&rdquo; party on invoices and reports. The
          company name is required before an invoice can be issued.
        </p>
      </div>

      <FieldGroup className="gap-6">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-brand-name">Company name</FieldLabel>
          <Input
            id="settings-brand-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-72"
            placeholder="Acme Studio Kft."
          />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-brand-address">Address</FieldLabel>
          <Textarea
            id="settings-brand-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="w-72 resize-none"
            placeholder="1052 Budapest, Váci utca 1."
          />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-brand-tax-id">Tax ID</FieldLabel>
          <Input
            id="settings-brand-tax-id"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className="w-72"
            placeholder="12345678-2-41"
          />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-brand-email">Email</FieldLabel>
          <Input
            id="settings-brand-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-72"
            placeholder="billing@acme.studio"
          />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-brand-phone">Phone</FieldLabel>
          <Input
            id="settings-brand-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-72"
            placeholder="+36 30 123 4567"
          />
        </Field>
      </FieldGroup>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3 border-t pt-6">
        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>
    </div>
  )
}

export function SettingsCompanyDetails() {
  const settings = useQuery(api.orgSettings.get)

  if (!settings) return <SettingsCompanyDetailsSkeleton />

  return (
    <SettingsCompanyDetailsForm
      key={settings._id}
      initialName={settings.brandName ?? ""}
      initialAddress={settings.brandAddress ?? ""}
      initialTaxId={settings.brandTaxId ?? ""}
      initialEmail={settings.brandEmail ?? ""}
      initialPhone={settings.brandPhone ?? ""}
    />
  )
}
