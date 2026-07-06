"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toastError } from "@/lib/toast-helpers"

/**
 * Inline "seller identity" fill-in for the invoice editor. Finalizing needs a
 * company name (Stripe-style gate); instead of bouncing the admin to Settings
 * and back, this dialog captures the details right where the block appears.
 * Saves to orgSettings — the same fields Settings → General edits.
 */
export function CompanyDetailsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const updateSettings = useMutation(api.orgSettings.update)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [taxId, setTaxId] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await updateSettings({
        brandName: trimmed,
        ...(address.trim() ? { brandAddress: address.trim() } : {}),
        ...(taxId.trim() ? { brandTaxId: taxId.trim() } : {}),
      })
      toast.success("Company details saved")
      onOpenChange(false)
    } catch (err) {
      toastError(err, "Failed to save company details")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add your company details</DialogTitle>
          <DialogDescription>
            Issued invoices must name the seller. This is saved to your
            workspace settings — you only do it once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Studio Ltd."
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-address">
              Address{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={"12 Main Street\nBrooklyn, NY 11201"}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-tax-id">
              Tax ID{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="company-tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="EU12345678"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
