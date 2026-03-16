"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  DEFAULT_ROUNDING,
  DEFAULT_STATUSES,
  DEFAULT_CATEGORIES,
} from "@/convex/lib/constants"
import type { Currency, RoundingMinutes } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"
import { StepGeneral } from "./step-general"
import { StepStatuses } from "./step-statuses"
import { StepCategories } from "./step-categories"
import { validateStatuses, validateCategories } from "./shared"
import type { StatusDraft, CategoryDraft } from "./shared"

const STEPS = ["General", "Statuses", "Work Categories"]

export function OnboardingModal() {
  const createOrgSettings = useMutation(api.orgSettings.create)

  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Step 0: General
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [rounding, setRounding] = useState<RoundingMinutes>(DEFAULT_ROUNDING)

  // Step 1: Statuses
  const [statuses, setStatuses] = useState<StatusDraft[]>(
    DEFAULT_STATUSES.map((s) => ({ ...s, id: crypto.randomUUID() }))
  )

  // Step 2: Work Categories
  const [categories, setCategories] = useState<CategoryDraft[]>(
    DEFAULT_CATEGORIES.map((c) => ({
      id: crypto.randomUUID(),
      name: c.name,
      color: c.color,
      defaultCostRate: "",
      defaultBillRate: "",
      currency: DEFAULT_CURRENCY,
    }))
  )

  function handleCurrencyChange(newCurrency: Currency) {
    const previousDefault = currency
    setCurrency(newCurrency)
    setCategories((prev) =>
      prev.map((c) =>
        c.currency === previousDefault
          ? { ...c, currency: newCurrency }
          : c
      )
    )
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    setError("")
    try {
      await createOrgSettings({
        defaultCurrency: currency,
        timezone,
        roundingMinutes: rounding,
        statuses: statuses.map((s) => ({
          name: s.name.trim(),
          color: s.color,
          type: s.type,
        })),
        workCategories: categories.map((c) => {
          const cost = Number(c.defaultCostRate)
          const bill = Number(c.defaultBillRate)
          return {
            name: c.name.trim(),
            color: c.color,
            defaultCostRate: Number.isFinite(cost) ? Math.max(0, cost) : undefined,
            defaultBillRate: Number.isFinite(bill) ? Math.max(0, bill) : undefined,
            currency: c.currency,
          }
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setIsSubmitting(false)
    }
  }

  const canNext =
    step === 0
      ? true
      : step === 1
        ? validateStatuses(statuses)
        : validateCategories(categories)

  return (
    <Dialog open>
      <DialogContent
        className="flex max-h-[90vh] flex-col sm:max-w-lg"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set up your organization</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 3 — {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div
          className="flex gap-1"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-label={`Step ${step + 1} of 3`}
        >
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= step ? "bg-foreground/80" : "bg-muted"
              )}
            />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          {step === 0 && (
            <StepGeneral
              timezone={timezone}
              currency={currency}
              rounding={rounding}
              onTimezoneChange={setTimezone}
              onCurrencyChange={handleCurrencyChange}
              onRoundingChange={setRounding}
            />
          )}
          {step === 1 && (
            <StepStatuses statuses={statuses} onChange={setStatuses} />
          )}
          {step === 2 && (
            <StepCategories
              categories={categories}
              onChange={setCategories}
              orgCurrency={currency}
            />
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          {error && (
            <p className="mr-auto text-sm text-destructive">{error}</p>
          )}
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
              Back
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext} className="flex-1">
              Next
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canNext || isSubmitting} className="flex-1">
              {isSubmitting ? "Setting up..." : "Complete Setup"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
