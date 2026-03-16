"use client"

import { useState, useEffect, useRef } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ImageIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import { CURRENCIES } from "@/convex/lib/constants"
import { toast } from "sonner"
import Image from "next/image"
import type { Doc, Id } from "@/convex/_generated/dataModel"

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"]

type ClientFormModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: Doc<"clients"> | null
}

export function ClientFormModal({ open, onOpenChange, client }: ClientFormModalProps) {
  const orgSettings = useQuery(api.orgSettings.get)
  const clientData = useQuery(
    api.clients.get,
    client ? { id: client._id } : "skip",
  )
  const createClient = useMutation(api.clients.create)
  const updateClient = useMutation(api.clients.update)
  const generateUploadUrl = useMutation(api.clients.generateUploadUrl)
  const removeFile = useMutation(api.clients.removeFile)

  const isEdit = !!client
  const defaultCurrency = orgSettings?.defaultCurrency ?? "USD"

  // General
  const [name, setName] = useState("")
  const [currency, setCurrency] = useState(defaultCurrency)
  const [invoicePrefix, setInvoicePrefix] = useState("")
  // Logo
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null)
  const [removeExistingLogo, setRemoveExistingLogo] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logoPreviewUrlRef = useRef<string | null>(null)
  // Billing
  const [billingName, setBillingName] = useState("")
  const [taxId, setTaxId] = useState("")
  const [billingEmail, setBillingEmail] = useState("")
  const [billingCountry, setBillingCountry] = useState("")
  const [billingCity, setBillingCity] = useState("")
  const [billingZip, setBillingZip] = useState("")
  const [billingStreet, setBillingStreet] = useState("")
  const [billingStreet2, setBillingStreet2] = useState("")
  // Notes
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Resolve logo URL for edit mode
  const resolvedLogoUrl = clientData?.logoUrl ?? null
  const resolvedLogoStorageId = clientData?.logoStorageId ?? null

  useEffect(() => {
    if (open) {
      if (client) {
        setName(client.name)
        setCurrency(client.currency)
        setInvoicePrefix(client.invoicePrefix)
        setBillingName(client.billingName ?? "")
        setTaxId(client.taxId ?? "")
        setBillingEmail(client.billingEmail ?? "")
        setBillingCountry(client.billingCountry ?? "")
        setBillingCity(client.billingCity ?? "")
        setBillingZip(client.billingZip ?? "")
        setBillingStreet(client.billingStreet ?? "")
        setBillingStreet2(client.billingStreet2 ?? "")
        setNotes(client.notes ?? "")
      } else {
        setName("")
        setCurrency(defaultCurrency)
        setInvoicePrefix("")
        setBillingName("")
        setTaxId("")
        setBillingEmail("")
        setBillingCountry("")
        setBillingCity("")
        setBillingZip("")
        setBillingStreet("")
        setBillingStreet2("")
        setNotes("")
      }
      if (logoPreviewUrlRef.current) {
        URL.revokeObjectURL(logoPreviewUrlRef.current)
        logoPreviewUrlRef.current = null
      }
      setLogoPreview(null)
      setPendingLogoFile(null)
      setRemoveExistingLogo(false)
      setError("")
    }
  }, [open, client, defaultCurrency])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Please upload a PNG, JPG, or SVG file")
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File must be smaller than 2MB")
      return
    }

    if (logoPreviewUrlRef.current) {
      URL.revokeObjectURL(logoPreviewUrlRef.current)
    }
    const url = URL.createObjectURL(file)
    logoPreviewUrlRef.current = url
    setPendingLogoFile(file)
    setLogoPreview(url)
  }

  function handleRemoveLogo() {
    if (logoPreviewUrlRef.current) {
      URL.revokeObjectURL(logoPreviewUrlRef.current)
      logoPreviewUrlRef.current = null
    }
    setPendingLogoFile(null)
    setLogoPreview(null)
    if (resolvedLogoStorageId) {
      setRemoveExistingLogo(true)
    }
  }

  async function uploadLogo(clientId: Id<"clients">) {
    if (!pendingLogoFile) return

    setUploading(true)
    try {
      const uploadUrl = await generateUploadUrl()
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": pendingLogoFile.type },
        body: pendingLogoFile,
      })
      if (!response.ok) throw new Error("Upload failed")
      const json = await response.json()
      const storageId = json?.storageId
      if (!storageId) throw new Error("Upload did not return a storage ID")

      // Remove old logo if exists
      if (resolvedLogoStorageId) {
        await removeFile({ storageId: resolvedLogoStorageId })
      }

      await updateClient({ id: clientId, logoStorageId: storageId })
    } catch {
      toast.error("Failed to upload logo")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setSubmitting(true)
    setError("")

    const payload = {
      name: name.trim(),
      currency,
      invoicePrefix: invoicePrefix.trim() || undefined,
      billingName: billingName || undefined,
      billingEmail: billingEmail || undefined,
      billingCountry: billingCountry || undefined,
      billingCity: billingCity || undefined,
      billingZip: billingZip || undefined,
      billingStreet: billingStreet || undefined,
      billingStreet2: billingStreet2 || undefined,
      taxId: taxId || undefined,
      notes: notes || undefined,
    }

    try {
      if (isEdit && client) {
        // Include logo removal in the same update to avoid reactive flash
        const updatePayload = {
          id: client._id,
          ...payload,
          ...(removeExistingLogo && resolvedLogoStorageId && !pendingLogoFile
            ? { logoStorageId: null as null }
            : {}),
        }
        await updateClient(updatePayload)
        if (removeExistingLogo && resolvedLogoStorageId && !pendingLogoFile) {
          await removeFile({ storageId: resolvedLogoStorageId })
        } else if (pendingLogoFile) {
          await uploadLogo(client._id)
        }
      } else {
        const newId = await createClient(payload)
        if (pendingLogoFile) {
          await uploadLogo(newId)
        }
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  // Which logo to show: pending preview > existing logo (unless flagged for removal) > nothing
  const displayLogoUrl = logoPreview ?? (removeExistingLogo ? null : resolvedLogoUrl)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Client" : "New Client"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update client details and billing information." : "Add a new client to your organization."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6 sm:flex-row sm:gap-0">
            {/* ── Left column: Client ──────────────────── */}
            <div className="flex flex-1 flex-col gap-6 sm:pr-8">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Client
              </p>

              {/* Logo */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Upload client logo"
              />
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/50 transition-colors hover:bg-muted"
                >
                  {uploading ? (
                    <Loader2Icon className="m-auto size-4 animate-spin text-muted-foreground" />
                  ) : displayLogoUrl ? (
                    <div className="relative size-full">
                      <Image src={displayLogoUrl} alt="" fill className="object-contain" />
                    </div>
                  ) : (
                    <ImageIcon className="m-auto size-4 text-muted-foreground/50" />
                  )}
                </button>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Label className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                      Logo
                    </Label>
                    {displayLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-5"
                        onClick={handleRemoveLogo}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">PNG, JPG or SVG · Max 2MB</p>
                </div>
              </div>

              {/* Client Name */}
              <div className="space-y-1.5">
                <Label htmlFor="client-name">Client Name</Label>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                />
              </div>

              {/* Currency + Prefix — 50/50 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="client-currency">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="client-currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-prefix">Invoice Prefix</Label>
                  <Input
                    id="invoice-prefix"
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                    placeholder="Auto from name"
                    maxLength={10}
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="client-notes">Notes</Label>
                <Textarea
                  id="client-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes about this client..."
                  rows={3}
                />
              </div>
            </div>

            {/* ── Divider ──────────────────────────────── */}
            <Separator orientation="vertical" className="mx-0 hidden h-auto sm:block" />
            <Separator className="sm:hidden" />

            {/* ── Right column: Billing ────────────────── */}
            <div className="flex flex-1 flex-col gap-6 sm:pl-8">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Billing
              </p>

              {/* Company Name — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="billing-name">Company Name</Label>
                <Input
                  id="billing-name"
                  value={billingName}
                  onChange={(e) => setBillingName(e.target.value)}
                  placeholder="e.g. Acme Corporation Kft."
                />
              </div>

              {/* Billing Email — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="billing-email">Billing Email</Label>
                <Input
                  id="billing-email"
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@example.com"
                />
              </div>

              {/* Tax ID — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="tax-id">Tax ID</Label>
                <Input
                  id="tax-id"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="e.g. HU12345678"
                />
              </div>

              {/* Country + Zip Code — 50/50 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="billing-country">Country</Label>
                  <Input
                    id="billing-country"
                    value={billingCountry}
                    onChange={(e) => setBillingCountry(e.target.value)}
                    placeholder="e.g. Hungary"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billing-zip">Zip Code</Label>
                  <Input
                    id="billing-zip"
                    value={billingZip}
                    onChange={(e) => setBillingZip(e.target.value)}
                    placeholder="e.g. 1011"
                  />
                </div>
              </div>

              {/* City — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="billing-city">City</Label>
                <Input
                  id="billing-city"
                  value={billingCity}
                  onChange={(e) => setBillingCity(e.target.value)}
                  placeholder="e.g. Budapest"
                />
              </div>

              {/* Street Address — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="billing-street">Street Address</Label>
                <Input
                  id="billing-street"
                  value={billingStreet}
                  onChange={(e) => setBillingStreet(e.target.value)}
                  placeholder="e.g. Fő utca 1."
                />
              </div>

              {/* Address Line 2 — 100% */}
              <div className="space-y-1.5">
                <Label htmlFor="billing-street2">Address Line 2</Label>
                <Input
                  id="billing-street2"
                  value={billingStreet2}
                  onChange={(e) => setBillingStreet2(e.target.value)}
                  placeholder="Floor, suite, unit (optional)"
                />
              </div>
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
