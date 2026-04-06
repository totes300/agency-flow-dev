"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DatePicker } from "@/components/ui/date-picker"
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { AlertTriangleIcon, ArrowLeftIcon, InfoIcon, PlusIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { BillingType } from "./project-form-step-basic"

export type TmRateMode = "flat" | "per_category"
export type CategoryRate = { workCategoryId: string; rate: string }

type StepBillingProps = {
  billingType: Exclude<BillingType, "non_billable">
  currency: string
  // Fixed
  fixedPrice: string
  setFixedPrice: (v: string) => void
  // T&M
  tmRateMode: TmRateMode
  setTmRateMode: (v: TmRateMode) => void
  hourlyRate: string
  setHourlyRate: (v: string) => void
  categoryRates: CategoryRate[]
  setCategoryRates: React.Dispatch<React.SetStateAction<CategoryRate[]>>
  // Retainer
  monthlyHours: string
  setMonthlyHours: (v: string) => void
  overageRate: string
  setOverageRate: (v: string) => void
  retainerStartDate: Date | undefined
  setRetainerStartDate: (v: Date | undefined) => void
  cycleLength: string
  setCycleLength: (v: string) => void
  rolloverEnabled: boolean
  setRolloverEnabled: (v: boolean) => void
  // Actions
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
  error: string
}

const BILLING_TITLES: Record<Exclude<BillingType, "non_billable">, { title: string; subtitle: string }> = {
  fixed: { title: "Billing Details", subtitle: "Fixed Fee project settings" },
  t_and_m: { title: "Billing Details", subtitle: "Time & Materials project settings" },
  retainer: { title: "Billing Details", subtitle: "Retainer project settings" },
}

export function ProjectFormStepBilling({
  billingType,
  currency,
  fixedPrice,
  setFixedPrice,
  tmRateMode,
  setTmRateMode,
  hourlyRate,
  setHourlyRate,
  categoryRates,
  setCategoryRates,
  monthlyHours,
  setMonthlyHours,
  overageRate,
  setOverageRate,
  retainerStartDate,
  setRetainerStartDate,
  cycleLength,
  setCycleLength,
  rolloverEnabled,
  setRolloverEnabled,
  onBack,
  onSubmit,
  submitting,
  error,
}: StepBillingProps) {
  const categories = useQuery(api.workCategories.list, { includeArchived: false })

  const usedCategoryIds = new Set(categoryRates.map((cr) => cr.workCategoryId))
  const cycleLengthNum = parseInt(cycleLength) || 1

  function addCategoryRate() {
    setCategoryRates((prev) => [...prev, { workCategoryId: "", rate: "" }])
  }

  function removeCategoryRate(index: number) {
    setCategoryRates((prev) => prev.filter((_, i) => i !== index))
  }

  function updateCategoryRate(index: number, field: keyof CategoryRate, value: string) {
    setCategoryRates((prev) =>
      prev.map((cr, i) => (i === index ? { ...cr, [field]: value } : cr))
    )
  }

  function handleCategorySelect(index: number, catId: string) {
    updateCategoryRate(index, "workCategoryId", catId)
    if (categories) {
      const cat = categories.find((c) => c._id === catId)
      if (cat?.defaultBillRate !== undefined) {
        updateCategoryRate(index, "rate", String(cat.defaultBillRate))
      }
    }
  }

  const { title, subtitle } = BILLING_TITLES[billingType]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {/* Step header with back */}
      <DialogHeader className="mb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <FieldGroup className="gap-6">
        {/* Fixed Fee fields */}
        {billingType === "fixed" && (
          <Field>
            <FieldLabel htmlFor="fixed-price">Fixed Fee</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="fixed-price"
                type="number"
                min="0.01"
                step="0.01"
                value={fixedPrice}
                onChange={(e) => setFixedPrice(e.target.value)}
                placeholder="10000"
                className="w-40"
                autoFocus
              />
              <span className="text-sm text-muted-foreground">{currency}</span>
            </div>
            <FieldDescription>
              The sold project price. Used to calculate profit and effective rate.
            </FieldDescription>
          </Field>
        )}

        {/* T&M fields */}
        {billingType === "t_and_m" && (
          <>
            <Field>
              <FieldLabel>Rate Mode</FieldLabel>
              <FieldDescription className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangleIcon className="size-3.5 shrink-0" />
                Cannot be changed.
              </FieldDescription>
              <div className="flex gap-2" role="radiogroup" aria-label="Rate Mode">
                {(["flat", "per_category"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={tmRateMode === mode}
                    onClick={() => setTmRateMode(mode)}
                    className={cn(
                      "rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      tmRateMode === mode
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {mode === "flat" ? "Flat rate" : "Per-category"}
                  </button>
                ))}
              </div>
            </Field>

            {tmRateMode === "flat" ? (
              <Field>
                <FieldLabel htmlFor="hourly-rate">Hourly Rate</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="hourly-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    placeholder="0"
                    className="w-32"
                    autoFocus
                  />
                  <span className="text-sm text-muted-foreground">{currency}/h</span>
                </div>
              </Field>
            ) : (
              <div className="flex flex-col gap-3">
                <FieldLabel>Category Rates</FieldLabel>
                {categoryRates.map((cr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={cr.workCategoryId}
                      onValueChange={(v) => handleCategorySelect(i, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {categories
                            ?.filter((c) => !usedCategoryIds.has(c._id) || c._id === cr.workCategoryId)
                            .map((c) => (
                              <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cr.rate}
                      onChange={(e) => updateCategoryRate(i, "rate", e.target.value)}
                      placeholder="0"
                      className="w-24"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">{currency}/h</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeCategoryRate(i)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCategoryRate}
                  className="w-full"
                >
                  <PlusIcon data-icon="inline-start" />
                  Add category rate
                </Button>
              </div>
            )}
          </>
        )}

        {/* Retainer fields */}
        {billingType === "retainer" && (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="monthly-hours">Monthly Hours</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="monthly-hours"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={monthlyHours}
                    onChange={(e) => setMonthlyHours(e.target.value)}
                    placeholder="10"
                    autoFocus
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">h/mo</span>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="overage-rate">Overage Rate</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="overage-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={overageRate}
                    onChange={(e) => setOverageRate(e.target.value)}
                    placeholder="95"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">{currency}/h</span>
                </div>
              </Field>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ret-start-date">Start Date</FieldLabel>
                <DatePicker
                  id="ret-start-date"
                  value={retainerStartDate}
                  onChange={setRetainerStartDate}
                  placeholder="Pick start date"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cycle-length">Cycle Length</FieldLabel>
                <Select value={cycleLength} onValueChange={setCycleLength}>
                  <SelectTrigger id="cycle-length">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {n === 1 ? "month" : "months"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Rollover — only shown when cycle >= 2 months */}
            {cycleLengthNum >= 2 && (
              <Field orientation="horizontal" className="rounded-md border bg-background/50 p-3">
                <FieldLabel htmlFor="rollover-toggle" className="font-normal">Rollover</FieldLabel>
                <Switch
                  id="rollover-toggle"
                  checked={rolloverEnabled}
                  onCheckedChange={setRolloverEnabled}
                />
                <FieldDescription className="flex items-start gap-1.5">
                  <InfoIcon className="mt-0.5 size-3 shrink-0" />
                  {rolloverEnabled
                    ? "Unused hours carry forward within each cycle. Forfeited at cycle end."
                    : "Each month is independent. Overage billed monthly."
                  }
                </FieldDescription>
              </Field>
            )}
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </FieldGroup>

      <div className="mt-8">
        <Button type="submit" disabled={submitting} size="lg" className="w-full">
          {submitting ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  )
}
