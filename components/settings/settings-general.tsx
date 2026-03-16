"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { CURRENCIES, ROUNDING_OPTIONS } from "@/convex/lib/constants"
import type { Currency, RoundingMinutes } from "@/convex/lib/constants"
import { COMMON_TIMEZONES, ROUNDING_LABELS } from "@/lib/display-constants"

function SettingsGeneralSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full max-w-xs" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-2">
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
}: {
  initialCurrency: Currency
  initialTimezone: string
  initialRounding: RoundingMinutes
}) {
  const updateSettings = useMutation(api.orgSettings.update)

  const [currency, setCurrency] = useState<Currency>(initialCurrency)
  const [timezone, setTimezone] = useState(initialTimezone)
  const [rounding, setRounding] = useState<RoundingMinutes>(initialRounding)
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
    rounding !== initialRounding

  async function handleSave() {
    setIsSaving(true)
    setSaved(false)
    setError("")
    try {
      await updateSettings({
        defaultCurrency: currency,
        timezone,
        roundingMinutes: rounding,
      })
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium">General</h2>
        <p className="text-sm text-muted-foreground">
          Default settings for your organization. These apply to new projects
          unless overridden.
        </p>
      </div>

      <div className="space-y-6">
        <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
          <Label htmlFor="settings-timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="settings-timezone" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
          <Label htmlFor="settings-currency">Default currency</Label>
          <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
            <SelectTrigger id="settings-currency" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-start">
          <Label className="pt-0.5">Time rounding</Label>
          <RadioGroup
            value={String(rounding)}
            onValueChange={(v) => setRounding(Number(v) as RoundingMinutes)}
            className="space-y-1"
          >
            {ROUNDING_OPTIONS.map((opt) => (
              <div key={opt} className="flex items-center gap-2">
                <RadioGroupItem value={String(opt)} id={`settings-rounding-${opt}`} />
                <Label htmlFor={`settings-rounding-${opt}`} className="font-normal">
                  {ROUNDING_LABELS[opt]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </div>

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
    />
  )
}
