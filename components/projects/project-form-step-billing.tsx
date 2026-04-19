"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  FormModalBody,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
  FormModalDescription,
} from "@/components/ui/form-modal"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
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
import { DialogClose } from "@/components/ui/dialog"
import { ArrowLeftIcon, InfoIcon } from "lucide-react"
import { formatCurrencyPrecise } from "@/lib/format"
import type { BillingType } from "./project-form-step-basic"

type StepBillingProps = {
  billingType: Exclude<BillingType, "non_billable">
  currency: string
  // Fixed
  fixedPrice: string
  setFixedPrice: (v: string) => void
  categoryEstimates: Record<string, string>
  setCategoryEstimates: (fn: (prev: Record<string, string>) => Record<string, string>) => void
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
  fixed: { title: "Billing Details", subtitle: "Set the price and scope estimates" },
  t_and_m: { title: "Billing Details", subtitle: "Rates are configured after creation" },
  retainer: { title: "Billing Details", subtitle: "Monthly recurring billing cycle" },
}

export function ProjectFormStepBilling({
  billingType,
  currency,
  fixedPrice,
  setFixedPrice,
  categoryEstimates,
  setCategoryEstimates,
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
      <FormModalHeader
        leading={
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        }
      >
        <FormModalTitle>{title}</FormModalTitle>
        <FormModalDescription>{subtitle}</FormModalDescription>
      </FormModalHeader>

      <FormModalBody>
        {/* Fixed Fee fields */}
        {billingType === "fixed" && (
          <>
            <Field>
              <FieldLabel htmlFor="fixed-price">Fixed Fee</FieldLabel>
              <InputGroup className="w-48">
                <InputGroupInput
                  id="fixed-price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder="10000"
                  autoFocus
                />
                <InputGroupAddon align="inline-end">{currency}</InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                The sold project price. Used to calculate profit and effective rate.
              </FieldDescription>
            </Field>
            <FixedScopeFieldset
              fixedPrice={fixedPrice}
              currency={currency}
              categoryEstimates={categoryEstimates}
              setCategoryEstimates={setCategoryEstimates}
            />
          </>
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
                <InputGroup>
                  <InputGroupInput
                    id="monthly-hours"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={monthlyHours}
                    onChange={(e) => setMonthlyHours(e.target.value)}
                    placeholder="10"
                    autoFocus
                  />
                  <InputGroupAddon align="inline-end">h/mo</InputGroupAddon>
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="monthly-fee">Monthly Fee</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="monthly-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(e.target.value)}
                    placeholder="2000"
                  />
                  <InputGroupAddon align="inline-end">{currency}</InputGroupAddon>
                </InputGroup>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="overage-rate">Overage Rate</FieldLabel>
              <InputGroup className="w-48">
                <InputGroupInput
                  id="overage-rate"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={overageRate}
                  onChange={(e) => setOverageRate(e.target.value)}
                  placeholder="150"
                />
                <InputGroupAddon align="inline-end">{currency}/h</InputGroupAddon>
              </InputGroup>
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
      </FormModalBody>

      <FormModalFooter>
        <Button type="submit" disabled={submitting} size="lg" className="h-11 w-full text-base">
          {submitting ? "Creating..." : "Create Project"}
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
  )
}

/**
 * Per-category scope estimate rows for Fixed project creation. Compact, optional —
 * user can skip and every row defaults to 0. The hint at the bottom computes a
 * live Expected rate so the agency sees "ezért adom el az órát" before creating.
 */
function FixedScopeFieldset({
  fixedPrice,
  currency,
  categoryEstimates,
  setCategoryEstimates,
}: {
  fixedPrice: string
  currency: string
  categoryEstimates: Record<string, string>
  setCategoryEstimates: (
    fn: (prev: Record<string, string>) => Record<string, string>,
  ) => void
}) {
  const categories = useQuery(api.workCategories.list, { includeArchived: false })

  const totalHours = Object.values(categoryEstimates).reduce(
    (sum, h) => sum + (parseFloat(h) || 0),
    0,
  )
  const priceNum = parseFloat(fixedPrice) || 0
  const expectedRate = totalHours > 0 && priceNum > 0 ? priceNum / totalHours : null

  return (
    <Field>
      <FieldLabel>Scope estimates <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
      <FieldDescription>
        Hours per category. Unlocks Expected hourly rate and scope-creep tracking after creation.
      </FieldDescription>
      {categories === undefined ? (
        <div className="mt-2 h-24 rounded-md border bg-muted/30" />
      ) : categories.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No work categories yet. You can add estimates later.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1 rounded-md border bg-background p-2">
          {categories.map((cat: { _id: Id<"workCategories">; name: string }) => (
            <div key={cat._id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-1 py-0.5">
              <span className="text-sm">{cat.name}</span>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={categoryEstimates[cat._id.toString()] ?? ""}
                onChange={(e) =>
                  setCategoryEstimates((prev) => ({
                    ...prev,
                    [cat._id.toString()]: e.target.value,
                  }))
                }
                placeholder="0"
                className="h-8 w-24 text-right tabular-nums"
              />
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t px-1 pt-2 text-xs">
            <span className="text-muted-foreground">
              Total {totalHours.toFixed(1)} h
              {expectedRate !== null && (
                <> · Expected rate <span className="font-medium text-foreground tabular-nums">{formatCurrencyPrecise(expectedRate, currency)}/h</span></>
              )}
            </span>
          </div>
        </div>
      )}
    </Field>
  )
}
