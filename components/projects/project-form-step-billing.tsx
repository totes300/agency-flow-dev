"use client"

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
import { ArrowLeftIcon, InfoIcon } from "lucide-react"
import type { BillingType } from "./project-form-step-basic"

type StepBillingProps = {
  billingType: Exclude<BillingType, "non_billable">
  currency: string
  // Fixed
  fixedPrice: string
  setFixedPrice: (v: string) => void
  // Retainer
  monthlyHours: string
  setMonthlyHours: (v: string) => void
  monthlyFee: string
  setMonthlyFee: (v: string) => void
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
  monthlyHours,
  setMonthlyHours,
  monthlyFee,
  setMonthlyFee,
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
  const cycleLengthNum = parseInt(cycleLength) || 1

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

        {/* T&M — no rate inputs at creation time */}
        {billingType === "t_and_m" && (
          <div className="flex items-start gap-3 rounded-md border bg-muted/50 p-4">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Billing rates can be configured per category after creating the project.
            </p>
          </div>
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
                <FieldLabel htmlFor="monthly-fee">Monthly Fee</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="monthly-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(e.target.value)}
                    placeholder="2000"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">{currency}</span>
                </div>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="overage-rate">Overage Rate</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="overage-rate"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={overageRate}
                  onChange={(e) => setOverageRate(e.target.value)}
                  placeholder="150"
                  className="w-40"
                />
                <span className="shrink-0 text-sm text-muted-foreground">{currency}/h</span>
              </div>
              <FieldDescription>
                Hourly rate charged for hours exceeding the monthly budget.
              </FieldDescription>
            </Field>

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
