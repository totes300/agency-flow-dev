"use client"

import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { RetainerStatusBadge } from "@/components/retainer-status-badge"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Spinner } from "@/components/ui/spinner"
import { formatDateToYMD } from "@/lib/format"

type RetainerProject = {
  retainerStatus?: string
  includedMinutesPerMonth?: number
  monthlyFee?: number
  overageRate?: number
  startDate?: string
  cycleLength?: number
  rolloverEnabled?: boolean
  currency: string
}

export function SettingsRetainer({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: RetainerProject
}) {
  const updateRetainer = useMutation(api.projects.updateRetainer)

  // Form state
  const [monthlyHours, setMonthlyHours] = useState(
    project.includedMinutesPerMonth ? String(project.includedMinutesPerMonth / 60) : ""
  )
  const [monthlyFee, setMonthlyFee] = useState(
    project.monthlyFee !== undefined ? String(project.monthlyFee) : ""
  )
  const [overageRate, setOverageRate] = useState(
    project.overageRate !== undefined ? String(project.overageRate) : ""
  )
  const [startDate, setStartDate] = useState<Date | undefined>(
    project.startDate ? new Date(project.startDate + "T00:00:00") : undefined
  )
  const [cycleLength, setCycleLength] = useState(String(project.cycleLength ?? 3))
  const [rolloverEnabled, setRolloverEnabled] = useState(project.rolloverEnabled ?? true)
  const [saving, setSaving] = useState(false)

  // Confirmation dialogs
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<"active" | "inactive" | null>(null)

  const retainerStatus = project.retainerStatus ?? "active"
  const isActive = retainerStatus === "active"

  // Validation
  const parsedHours = parseFloat(monthlyHours)
  const parsedFee = parseFloat(monthlyFee)
  const parsedOverageRate = parseFloat(overageRate)
  const hoursValid = !isNaN(parsedHours) && parsedHours > 0
  const feeValid = !isNaN(parsedFee) && parsedFee >= 0
  const overageRateValid = !isNaN(parsedOverageRate) && parsedOverageRate > 0
  const canSave = hoursValid && feeValid && overageRateValid && !!startDate

  // Sync from props when project changes
  useEffect(() => {
    setMonthlyHours(project.includedMinutesPerMonth ? String(project.includedMinutesPerMonth / 60) : "")
    setMonthlyFee(project.monthlyFee !== undefined ? String(project.monthlyFee) : "")
    setOverageRate(project.overageRate !== undefined ? String(project.overageRate) : "")
    setStartDate(project.startDate ? new Date(project.startDate + "T00:00:00") : undefined)
    setCycleLength(String(project.cycleLength ?? 3))
    setRolloverEnabled(project.rolloverEnabled ?? true)
  }, [project.includedMinutesPerMonth, project.monthlyFee, project.overageRate, project.startDate, project.cycleLength, project.rolloverEnabled])

  // Determine if any config fields differ from the saved project state
  function hasConfigChanges(): boolean {
    const newMinutes = Math.round(parsedHours * 60)
    const newFee = parsedFee
    const newOverageRate = parsedOverageRate
    const newStartDate = startDate ? formatDateToYMD(startDate) : undefined
    const newCycleLength = parseInt(cycleLength) || 3
    return (
      newMinutes !== project.includedMinutesPerMonth ||
      newFee !== project.monthlyFee ||
      newOverageRate !== project.overageRate ||
      newStartDate !== project.startDate ||
      newCycleLength !== (project.cycleLength ?? 3) ||
      rolloverEnabled !== (project.rolloverEnabled ?? true)
    )
  }

  function handleSaveClick() {
    if (!canSave) return
    if (hasConfigChanges()) {
      setConfirmSaveOpen(true)
    } else {
      executeSave()
    }
  }

  async function executeSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const newCycleLength = parseInt(cycleLength) || 3
      await updateRetainer({
        id: projectId,
        includedMinutesPerMonth: Math.round(parsedHours * 60),
        monthlyFee: parsedFee,
        overageRate: parsedOverageRate,
        startDate: startDate ? formatDateToYMD(startDate) : undefined,
        cycleLength: newCycleLength,
        // Rollover only exists across multi-month cycles (server enforces
        // the same rule) — a 1-month cycle always saves as monthly.
        rolloverEnabled: newCycleLength >= 2 ? rolloverEnabled : false,
        confirmed: true,
      })
      toast.success("Retainer settings saved")
    } catch (err) {
      toastError(err, "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  function handleStatusToggle() {
    const newStatus = isActive ? "inactive" : "active"
    setPendingStatus(newStatus)
    setConfirmStatusOpen(true)
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return
    try {
      await updateRetainer({
        id: projectId,
        retainerStatus: pendingStatus,
        confirmed: true,
      })
      toast.success(`Retainer ${pendingStatus === "active" ? "activated" : "paused"}`)
    } catch (err) {
      toastError(err, "Failed to update status")
    }
    setPendingStatus(null)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Retainer Configuration</CardTitle>
          <CardAction>
            <div className="flex items-center gap-2">
              <RetainerStatusBadge status={retainerStatus} />
              <Switch
                checked={isActive}
                onCheckedChange={handleStatusToggle}
                aria-label="Retainer status"
              />
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Budget */}
          <div className="flex flex-col gap-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Budget</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="ret-hours">Monthly hours</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="ret-hours"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={monthlyHours}
                    onChange={(e) => setMonthlyHours(e.target.value)}
                    aria-invalid={monthlyHours !== "" && !hoursValid}
                    placeholder="10"
                  />
                  <InputGroupAddon align="inline-end">hrs</InputGroupAddon>
                </InputGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="ret-fee">Monthly fee</FieldLabel>
                <InputGroup>
                  <InputGroupAddon align="inline-start">{project.currency}</InputGroupAddon>
                  <InputGroupInput
                    id="ret-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(e.target.value)}
                    aria-invalid={monthlyFee !== "" && !feeValid}
                    placeholder="500"
                  />
                  <InputGroupAddon align="inline-end">/ mo</InputGroupAddon>
                </InputGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="ret-overage-rate">Overage rate</FieldLabel>
                <InputGroup>
                  <InputGroupAddon align="inline-start">{project.currency}</InputGroupAddon>
                  <InputGroupInput
                    id="ret-overage-rate"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={overageRate}
                    onChange={(e) => setOverageRate(e.target.value)}
                    aria-invalid={overageRate !== "" && !overageRateValid}
                    placeholder="100"
                  />
                  <InputGroupAddon align="inline-end">/ hr</InputGroupAddon>
                </InputGroup>
                <FieldDescription>Billed when hours exceed the monthly budget</FieldDescription>
              </Field>
            </div>
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Schedule</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ret-start-date">Start date</FieldLabel>
                <DatePicker
                  id="ret-start-date"
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Pick start date"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ret-cycle">Cycle length</FieldLabel>
                <Select value={cycleLength} onValueChange={setCycleLength}>
                  <SelectTrigger id="ret-cycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === 1 ? "month" : "months"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          {/* Rollover — only meaningful across multi-month cycles; hidden for
              1-month cycles (same rule the creation form applies, and the
              server forces rollover off below 2 months). */}
          {(parseInt(cycleLength) || 1) >= 2 ? (
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Rollover unused hours</p>
                <p className="text-xs text-muted-foreground">
                  {rolloverEnabled
                    ? "Unused hours carry forward within each cycle. Forfeited at cycle end."
                    : "Each month is independent. Overage billed monthly."}
                </p>
              </div>
              <Switch
                id="ret-rollover"
                checked={rolloverEnabled}
                onCheckedChange={setRolloverEnabled}
                className="shrink-0"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              1-month cycle — each month settles independently. Rollover is
              available for cycles of 2+ months.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Changes retroactively affect the current billing cycle.
          </p>
        </CardContent>

        <CardFooter className="justify-end">
          <Button onClick={handleSaveClick} disabled={!canSave || saving} size="sm">
            {saving ? <><Spinner data-icon="inline-start" /> Saving...</> : "Save"}
          </Button>
        </CardFooter>
      </Card>

      {/* Confirmation: retroactive config change */}
      <ConfirmDialog
        open={confirmSaveOpen}
        onOpenChange={setConfirmSaveOpen}
        title="Recalculate cycle balances?"
        description="These changes will retroactively affect the current billing cycle. All historical balances will be recalculated. This cannot be undone."
        confirmLabel="Save changes"
        onConfirm={() => {
          setConfirmSaveOpen(false)
          executeSave()
        }}
      />

      {/* Confirmation: status toggle */}
      <ConfirmDialog
        open={confirmStatusOpen}
        onOpenChange={setConfirmStatusOpen}
        title={pendingStatus === "inactive" ? "Pause retainer?" : "Activate retainer?"}
        description={
          pendingStatus === "inactive"
            ? "Pausing will stop this retainer from appearing in the billing queue. Data is preserved and balance calculation still works."
            : "Activating will resume this retainer in the billing queue and auto-report generation."
        }
        confirmLabel={pendingStatus === "inactive" ? "Pause" : "Activate"}
        onConfirm={() => {
          setConfirmStatusOpen(false)
          confirmStatusChange()
        }}
      />
    </>
  )
}
