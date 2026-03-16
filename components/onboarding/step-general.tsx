"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { CURRENCIES } from "@/convex/lib/constants"
import type { Currency, RoundingMinutes } from "@/convex/lib/constants"
import { COMMON_TIMEZONES, ROUNDING_LABELS } from "@/lib/display-constants"
import { ROUNDING_OPTIONS } from "@/convex/lib/constants"

export function StepGeneral({
  timezone,
  currency,
  rounding,
  onTimezoneChange,
  onCurrencyChange,
  onRoundingChange,
}: {
  timezone: string
  currency: Currency
  rounding: RoundingMinutes
  onTimezoneChange: (v: string) => void
  onCurrencyChange: (v: Currency) => void
  onRoundingChange: (v: RoundingMinutes) => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Select value={timezone} onValueChange={onTimezoneChange}>
          <SelectTrigger id="timezone">
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

      <div className="space-y-2">
        <Label htmlFor="currency">Default currency</Label>
        <Select value={currency} onValueChange={(v) => onCurrencyChange(v as Currency)}>
          <SelectTrigger id="currency">
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

      <div className="space-y-2">
        <Label>Time rounding</Label>
        <RadioGroup
          value={String(rounding)}
          onValueChange={(v) => onRoundingChange(Number(v) as RoundingMinutes)}
          className="space-y-1"
        >
          {ROUNDING_OPTIONS.map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              <RadioGroupItem value={String(opt)} id={`rounding-${opt}`} />
              <Label htmlFor={`rounding-${opt}`} className="font-normal">
                {ROUNDING_LABELS[opt]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  )
}
