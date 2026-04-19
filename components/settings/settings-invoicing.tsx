"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { extractErrorMessage } from "@/lib/toast-helpers"

const PAYMENT_TERMS_OPTIONS = [
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "custom", label: "Custom" },
] as const

function SettingsInvoicingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
    </div>
  )
}

function SettingsInvoicingForm({
  initialPrefix,
  initialNextNumber,
  initialPaymentTermsDays,
  counterLocked,
}: {
  initialPrefix: string
  initialNextNumber: number
  initialPaymentTermsDays: number
  counterLocked: boolean
}) {
  const updateSettings = useMutation(api.orgSettings.update)

  const [prefix, setPrefix] = useState(initialPrefix)
  const [nextNumber, setNextNumber] = useState(String(initialNextNumber))
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(initialPaymentTermsDays))
  const [isCustomTerms, setIsCustomTerms] = useState(
    ![15, 30, 45, 60].includes(initialPaymentTermsDays)
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const parsedNumber = parseInt(nextNumber, 10)
  const parsedTerms = parseInt(paymentTermsDays, 10)
  const isValid =
    prefix.trim().length > 0 &&
    !isNaN(parsedNumber) && parsedNumber >= 1 &&
    !isNaN(parsedTerms) && parsedTerms >= 1 && parsedTerms <= 365

  const hasChanges =
    prefix !== initialPrefix ||
    (!counterLocked && parsedNumber !== initialNextNumber) ||
    parsedTerms !== initialPaymentTermsDays

  function handleTermsSelect(value: string) {
    if (value === "custom") {
      setIsCustomTerms(true)
    } else {
      setIsCustomTerms(false)
      setPaymentTermsDays(value)
    }
  }

  async function handleSave() {
    if (!isValid) return
    setIsSaving(true)
    setSaved(false)
    setError("")
    try {
      // Send only changed fields so the server never sees an unchanged
      // `nextInvoiceNumber` (the counter is locked once the sequence starts).
      const patch: {
        invoicePrefix?: string
        nextInvoiceNumber?: number
        defaultPaymentTermsDays?: number
      } = {}
      if (prefix !== initialPrefix) patch.invoicePrefix = prefix
      if (!counterLocked && parsedNumber !== initialNextNumber) {
        patch.nextInvoiceNumber = parsedNumber
      }
      if (parsedTerms !== initialPaymentTermsDays) {
        patch.defaultPaymentTermsDays = parsedTerms
      }
      await updateSettings(patch)
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
    } finally {
      setIsSaving(false)
    }
  }

  const isStandardTerm = [15, 30, 45, 60].includes(parsedTerms)
  const selectValue = isCustomTerms || !isStandardTerm ? "custom" : String(parsedTerms)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-sm font-semibold">Invoicing</h2>
        <p className="text-[13px] text-muted-foreground">
          Configure invoice numbering and default payment terms.
        </p>
      </div>

      <FieldGroup className="gap-6">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-invoice-prefix">Invoice prefix</FieldLabel>
          <Input
            id="settings-invoice-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="w-32"
            placeholder="INV-"
          />
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-next-invoice-number">Next invoice number</FieldLabel>
          <div className="flex flex-col gap-1">
            <Input
              id="settings-next-invoice-number"
              type="number"
              min={1}
              value={nextNumber}
              onChange={(e) => setNextNumber(e.target.value)}
              disabled={counterLocked}
              aria-describedby={counterLocked ? "settings-next-invoice-number-hint" : undefined}
              className="w-24"
            />
            {counterLocked && (
              <p
                id="settings-next-invoice-number-hint"
                className="text-xs text-muted-foreground"
              >
                Locked — the counter advances automatically.
              </p>
            )}
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-payment-terms">Default payment terms</FieldLabel>
          <div className="flex items-center gap-2">
            <Select value={selectValue} onValueChange={handleTermsSelect}>
              <SelectTrigger id="settings-payment-terms" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PAYMENT_TERMS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {isCustomTerms && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            )}
          </div>
        </Field>
      </FieldGroup>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t pt-6">
        <Button onClick={handleSave} disabled={!hasChanges || !isValid || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  )
}

export function SettingsInvoicing() {
  const settings = useQuery(api.orgSettings.get)
  const hasAnyInvoice = useQuery(api.invoices.hasAnyInvoice)

  if (!settings || hasAnyInvoice === undefined) return <SettingsInvoicingSkeleton />

  return (
    <SettingsInvoicingForm
      key={settings._id}
      initialPrefix={settings.invoicePrefix ?? "INV-"}
      initialNextNumber={settings.nextInvoiceNumber ?? 1}
      initialPaymentTermsDays={settings.defaultPaymentTermsDays ?? 30}
      counterLocked={hasAnyInvoice}
    />
  )
}
