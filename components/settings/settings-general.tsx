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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { extractErrorMessage } from "@/lib/toast-helpers"
import { CURRENCIES, ROUNDING_OPTIONS } from "@/convex/lib/constants"
import type { Currency, RoundingMinutes } from "@/convex/lib/constants"
import { COMMON_TIMEZONES, ROUNDING_LABELS } from "@/lib/display-constants"

function SettingsGeneralSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full max-w-xs" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsGeneralForm({
  initialCurrency,
  initialTimezone,
  initialRounding,
  initialDefaultTmFlatRate,
}: {
  initialCurrency: Currency
  initialTimezone: string
  initialRounding: RoundingMinutes
  initialDefaultTmFlatRate: string
}) {
  const updateSettings = useMutation(api.orgSettings.update)

  const [currency, setCurrency] = useState<Currency>(initialCurrency)
  const [timezone, setTimezone] = useState(initialTimezone)
  const [rounding, setRounding] = useState<RoundingMinutes>(initialRounding)
  const [defaultTmFlatRate, setDefaultTmFlatRate] = useState(initialDefaultTmFlatRate)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current)
      }
    }
  }, [])

  const hasChanges =
    currency !== initialCurrency ||
    timezone !== initialTimezone ||
    rounding !== initialRounding ||
    defaultTmFlatRate !== initialDefaultTmFlatRate

  async function handleSave() {
    setIsSaving(true)
    setSaved(false)
    setError("")
    try {
      const parsedRate = parseFloat(defaultTmFlatRate)
      await updateSettings({
        defaultCurrency: currency,
        timezone,
        roundingMinutes: rounding,
        ...(defaultTmFlatRate ? { defaultTmFlatRate: parsedRate } : {}),
      })
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
        <h2 className="text-sm font-semibold">General</h2>
        <p className="text-[13px] text-muted-foreground">
          Default settings for your organization. These apply to new projects
          unless overridden.
        </p>
      </div>

      <FieldGroup className="gap-6">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-timezone">Timezone</FieldLabel>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="settings-timezone" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-currency">Default currency</FieldLabel>
          <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
            <SelectTrigger id="settings-currency" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel className="pt-0.5">Time rounding</FieldLabel>
          <RadioGroup
            value={String(rounding)}
            onValueChange={(v) => setRounding(Number(v) as RoundingMinutes)}
            className="flex flex-col gap-1"
          >
            {ROUNDING_OPTIONS.map((opt) => (
              <div key={opt} className="flex items-center gap-2">
                <RadioGroupItem value={String(opt)} id={`settings-rounding-${opt}`} />
                <FieldLabel htmlFor={`settings-rounding-${opt}`} className="font-normal">
                  {ROUNDING_LABELS[opt]}
                </FieldLabel>
              </div>
            ))}
          </RadioGroup>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="settings-tm-rate">Default T&M flat rate</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="settings-tm-rate"
              type="number"
              min="0"
              step="0.01"
              value={defaultTmFlatRate}
              onChange={(e) => setDefaultTmFlatRate(e.target.value)}
              placeholder="0"
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">{currency}/h</span>
          </div>
        </Field>
      </FieldGroup>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t pt-6">
        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  )
}

export function SettingsGeneral() {
  const settings = useQuery(api.orgSettings.get)

  if (!settings) return <SettingsGeneralSkeleton />

  return (
    <SettingsGeneralForm
      key={settings._id}
      initialCurrency={settings.defaultCurrency as Currency}
      initialTimezone={settings.timezone}
      initialRounding={settings.roundingMinutes as RoundingMinutes}
      initialDefaultTmFlatRate={settings.defaultTmFlatRate?.toString() ?? ""}
    />
  )
}
