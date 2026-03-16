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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Loader2Icon, InfoIcon } from "lucide-react"
import { formatDateToYMD } from "@/lib/format"

type RetainerProject = {
  retainerStatus?: string
  includedHoursPerMonth?: number
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
    project.includedHoursPerMonth ? String(project.includedHoursPerMonth / 60) : ""
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

  const isActive = project.retainerStatus === "active"

  // Validation
  const parsedHours = parseFloat(monthlyHours)
  const parsedRate = parseFloat(overageRate)
  const hoursValid = !isNaN(parsedHours) && parsedHours > 0
  const rateValid = !isNaN(parsedRate) && parsedRate >= 0
  const canSave = hoursValid && rateValid && !!startDate

  // Sync from props when project changes
  useEffect(() => {
    setMonthlyHours(project.includedHoursPerMonth ? String(project.includedHoursPerMonth / 60) : "")
    setOverageRate(project.overageRate !== undefined ? String(project.overageRate) : "")
    setStartDate(project.startDate ? new Date(project.startDate + "T00:00:00") : undefined)
    setCycleLength(String(project.cycleLength ?? 3))
    setRolloverEnabled(project.rolloverEnabled ?? true)
  }, [project.includedHoursPerMonth, project.overageRate, project.startDate, project.cycleLength, project.rolloverEnabled])

  // Determine if any config fields differ from the saved project state
  function hasConfigChanges(): boolean {
    const newMinutes = Math.round(parsedHours * 60)
    const newRate = parsedRate
    const newStartDate = startDate ? formatDateToYMD(startDate) : undefined
    const newCycleLength = parseInt(cycleLength) || 3
    return (
      newMinutes !== project.includedHoursPerMonth ||
      newRate !== project.overageRate ||
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
      await updateRetainer({
        id: projectId,
        includedHoursPerMonth: Math.round(parsedHours * 60),
        overageRate: parsedRate,
        startDate: startDate ? formatDateToYMD(startDate) : undefined,
        cycleLength: parseInt(cycleLength) || 3,
        rolloverEnabled,
        confirmed: true,
      })
      toast.success("Retainer settings saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusToggle() {
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
      toast.error(err instanceof Error ? err.message : "Failed to update status")
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
              <RetainerStatusBadge status={project.retainerStatus ?? "active"} />
              <Switch
                checked={isActive}
                onCheckedChange={handleStatusToggle}
                aria-label="Retainer status"
              />
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <InfoIcon className="size-4" />
            <AlertDescription>
              Changes to hours, rate, cycle length, or rollover retroactively affect the current billing cycle.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ret-hours">Monthly hours <span className="text-destructive">*</span></Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ret-hours"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={monthlyHours}
                  onChange={(e) => setMonthlyHours(e.target.value)}
                  aria-invalid={monthlyHours !== "" && !hoursValid}
                />
                <span className="shrink-0 text-sm text-muted-foreground">h/mo</span>
              </div>
              {monthlyHours !== "" && !hoursValid && (
                <p className="text-xs text-destructive">Must be greater than 0</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ret-overage">Overage rate <span className="text-destructive">*</span></Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ret-overage"
                  type="number"
                  min="0"
                  step="0.01"
                  value={overageRate}
                  onChange={(e) => setOverageRate(e.target.value)}
                  aria-invalid={overageRate !== "" && !rateValid}
                />
                <span className="shrink-0 text-sm text-muted-foreground">{project.currency}/h</span>
              </div>
              {overageRate !== "" && !rateValid && (
                <p className="text-xs text-destructive">Must be 0 or greater</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ret-start-date">Start date <span className="text-destructive">*</span></Label>
              <DatePicker
                id="ret-start-date"
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick start date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ret-cycle">Cycle length</Label>
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
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ret-rollover" className="font-normal">Rollover</Label>
              <Switch
                id="ret-rollover"
                checked={rolloverEnabled}
                onCheckedChange={setRolloverEnabled}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {rolloverEnabled
                ? "Unused hours carry forward within each cycle. Forfeited at cycle end."
                : "Each month is independent. Overage billed monthly."
              }
            </p>
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button onClick={handleSaveClick} disabled={!canSave || saving} size="sm">
            {saving ? <><Loader2Icon className="size-3.5 animate-spin" /> Saving...</> : "Save"}
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
