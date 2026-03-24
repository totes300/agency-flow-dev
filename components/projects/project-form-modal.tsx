"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { DatePicker } from "@/components/ui/date-picker"
import { AlertTriangleIcon, PlusIcon, XIcon, InfoIcon } from "lucide-react"
import { CURRENCIES } from "@/convex/lib/constants"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDateToYMD } from "@/lib/format"

type ProjectFormModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type BillingType = "fixed" | "t_and_m" | "retainer"
type TmRateMode = "flat" | "per_category"
type CategoryRate = { workCategoryId: string; rate: string }

export function ProjectFormModal({ open, onOpenChange }: ProjectFormModalProps) {
  const createProject = useMutation(api.projects.create)
  const clients = useQuery(api.clients.list, open ? { includeArchived: false } : "skip")
  const categories = useQuery(api.workCategories.list, open ? { includeArchived: false } : "skip")
  const nextCode = useQuery(api.projects.nextCode, open ? {} : "skip")
  const orgSettings = useQuery(api.orgSettings.get, open ? {} : "skip")
  const router = useRouter()

  const [clientId, setClientId] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [billingType, setBillingType] = useState<BillingType>("fixed")
  const [currency, setCurrency] = useState("USD")
  // Fixed state
  const [fixedPrice, setFixedPrice] = useState("")
  // T&M state
  const [tmRateMode, setTmRateMode] = useState<TmRateMode>("flat")
  const [hourlyRate, setHourlyRate] = useState("")
  const [categoryRates, setCategoryRates] = useState<CategoryRate[]>([])
  // Retainer state
  const [monthlyHours, setMonthlyHours] = useState("")
  const [overageRate, setOverageRate] = useState("")
  const [retainerStartDate, setRetainerStartDate] = useState<Date | undefined>(undefined)
  const [cycleLength, setCycleLength] = useState("3")
  const [rolloverEnabled, setRolloverEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setClientId("")
      setName("")
      setCode("")
      setBillingType("fixed")
      setCurrency("USD")
      setFixedPrice("")
      setTmRateMode("flat")
      setHourlyRate(orgSettings?.defaultTmFlatRate?.toString() ?? "")
      setCategoryRates([])
      setMonthlyHours("")
      setOverageRate("")
      // Default start date: 1st of current month
      const now = new Date()
      setRetainerStartDate(new Date(now.getFullYear(), now.getMonth(), 1))
      setCycleLength("3")
      setRolloverEnabled(true)
      setError("")
    }
  }, [open])

  // Pre-fill code when nextCode loads
  useEffect(() => {
    if (nextCode && !code) {
      setCode(nextCode)
    }
  }, [nextCode, code])

  // Auto-fill currency from selected client
  useEffect(() => {
    if (clientId && clients) {
      const client = clients.find((c) => c._id === clientId)
      if (client) setCurrency(client.currency)
    }
  }, [clientId, clients])

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

  // Pre-populate rate from category defaults
  function handleCategorySelect(index: number, catId: string) {
    updateCategoryRate(index, "workCategoryId", catId)
    if (categories) {
      const cat = categories.find((c) => c._id === catId)
      if (cat?.defaultBillRate !== undefined) {
        updateCategoryRate(index, "rate", String(cat.defaultBillRate))
      }
    }
  }

  const usedCategoryIds = new Set(categoryRates.map((cr) => cr.workCategoryId))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId || !name.trim()) return

    setSubmitting(true)
    setError("")

    try {
      const newId = await createProject({
        clientId: clientId as Id<"clients">,
        name: name.trim(),
        billingType,
        currency: currency as typeof CURRENCIES[number],
        code: code.trim() || undefined,
        ...(billingType === "fixed" ? {
          fixedPrice: parseFloat(fixedPrice) || 0,
        } : {}),
        ...(billingType === "t_and_m" ? {
          tmRateMode,
          ...(tmRateMode === "flat" ? {
            hourlyRate: parseFloat(hourlyRate) || 0,
          } : {
            tmCategoryRates: categoryRates
              .filter((cr) => cr.workCategoryId && cr.rate)
              .map((cr) => ({
                workCategoryId: cr.workCategoryId as Id<"workCategories">,
                rate: parseFloat(cr.rate) || 0,
              })),
          }),
        } : {}),
        ...(billingType === "retainer" ? {
          includedMinutesPerMonth: Math.round((parseFloat(monthlyHours) || 0) * 60),
          overageRate: parseFloat(overageRate) || 0,
          startDate: retainerStartDate ? formatDateToYMD(retainerStartDate) : "",
          cycleLength: parseInt(cycleLength) || 3,
          rolloverEnabled,
        } : {}),
      })
      onOpenChange(false)
      router.push(`/projects/${newId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  const hasNoClients = clients && clients.length === 0

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Add a new project to start tracking time and budgets.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup>
          {/* Client */}
          <Field>
            <FieldLabel htmlFor="project-client">Client</FieldLabel>
            {hasNoClients ? (
              <p className="text-sm text-muted-foreground">
                No clients available. Create a client first.
              </p>
            ) : (
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="project-client">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {clients?.map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </Field>

          {/* Project name */}
          <Field>
            <FieldLabel htmlFor="project-name">Project name</FieldLabel>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Website Redesign"
              maxLength={100}
              autoFocus
            />
          </Field>

          {/* Project code */}
          <Field>
            <FieldLabel htmlFor="project-code">Project code</FieldLabel>
            <Input
              id="project-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PRJ-001"
              className="font-mono"
            />
          </Field>

          {/* Billing type */}
          <Field>
            <FieldLabel>Billing type</FieldLabel>
            <FieldDescription className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              Cannot be changed after creation.
            </FieldDescription>
            <RadioGroup
              value={billingType}
              onValueChange={(v) => setBillingType(v as BillingType)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="fixed" id="bt-fixed" />
                <FieldLabel htmlFor="bt-fixed" className="font-normal">Fixed</FieldLabel>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="t_and_m" id="bt-tm" />
                <FieldLabel htmlFor="bt-tm" className="font-normal">T&M</FieldLabel>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="retainer" id="bt-retainer" />
                <FieldLabel htmlFor="bt-retainer" className="font-normal">Retainer</FieldLabel>
              </div>
            </RadioGroup>
          </Field>

          {/* Fixed fields */}
          {billingType === "fixed" && (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
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
                  />
                  <span className="text-sm text-muted-foreground">{currency}</span>
                </div>
                <FieldDescription>
                  The sold project price. Used to calculate profit and effective rate.
                </FieldDescription>
              </Field>
            </div>
          )}

          {/* T&M fields */}
          {billingType === "t_and_m" && (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
              <Field>
                <FieldLabel>Rate mode</FieldLabel>
                <FieldDescription className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangleIcon className="size-3.5 shrink-0" />
                  Cannot be changed.
                </FieldDescription>
                <RadioGroup
                  value={tmRateMode}
                  onValueChange={(v) => setTmRateMode(v as TmRateMode)}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="flat" id="rm-flat" />
                    <FieldLabel htmlFor="rm-flat" className="font-normal">Flat rate</FieldLabel>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="per_category" id="rm-percat" />
                    <FieldLabel htmlFor="rm-percat" className="font-normal">Per-category</FieldLabel>
                  </div>
                </RadioGroup>
              </Field>

              {tmRateMode === "flat" ? (
                <Field>
                  <FieldLabel htmlFor="hourly-rate">Hourly rate</FieldLabel>
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
                    />
                    <span className="text-sm text-muted-foreground">{currency}/h</span>
                  </div>
                </Field>
              ) : (
                <div className="flex flex-col gap-3">
                  <FieldLabel>Category rates</FieldLabel>
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
            </div>
          )}

          {/* Retainer fields */}
          {billingType === "retainer" && (
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="monthly-hours">Monthly hours</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="monthly-hours"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={monthlyHours}
                      onChange={(e) => setMonthlyHours(e.target.value)}
                      placeholder="10"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">h/mo</span>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="overage-rate">Overage rate</FieldLabel>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="ret-start-date">Start date</FieldLabel>
                  <DatePicker
                    id="ret-start-date"
                    value={retainerStartDate}
                    onChange={setRetainerStartDate}
                    placeholder="Pick start date"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="cycle-length">Cycle length</FieldLabel>
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
            </div>
          )}

          {/* Currency */}
          <Field>
            <FieldLabel htmlFor="project-currency">Currency</FieldLabel>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="project-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!clientId || !name.trim() || submitting || hasNoClients}
            >
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
