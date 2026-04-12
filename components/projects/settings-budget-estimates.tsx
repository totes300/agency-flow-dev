"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { PlusIcon, Trash2Icon, RotateCcwIcon } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { useDefaultAssignees, type DefaultAssignee } from "@/lib/hooks/use-default-assignees"
import { cn } from "@/lib/utils"

type Row = {
  id?: string
  workCategoryId: string
  hours: string
}

type ProjectData = {
  currency: string
}

const INLINE_INPUT = "h-8 w-full border-0 bg-transparent px-0 text-sm shadow-none outline-none ring-0 focus-visible:ring-0 focus-visible:border-0 tabular-nums"
const INLINE_TRIGGER = "h-8 border-0 bg-transparent px-0 shadow-none ring-0 text-sm focus:ring-0 hover:bg-transparent data-[state=open]:bg-transparent [&_svg:last-child]:hidden"

export function SettingsBudgetEstimates({
  projectId,
  project,
  teamMembers = [],
  defaultAssignees = [],
}: {
  projectId: Id<"projects">
  project: ProjectData
  teamMembers?: Id<"users">[]
  defaultAssignees?: DefaultAssignee[]
}) {
  const currency = project.currency
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const categoryRates = useQuery(api.categoryRates.list, {})
  const overrides = useQuery(api.projectRateOverrides.listForProject, { projectId })
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const upsertEstimate = useMutation(api.projectCategoryEstimates.upsert)
  const removeEstimate = useMutation(api.projectCategoryEstimates.remove)
  const upsertOverride = useMutation(api.projectRateOverrides.upsert)
  const removeOverride = useMutation(api.projectRateOverrides.remove)

  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const teamMemberOptions = orgMembers?.filter((m) => teamMembers.some((id) => id.toString() === m._id.toString())) ?? []
  const hasTeam = teamMemberOptions.length > 0
  const { assigneeForCategory, handleAssigneeChange } = useDefaultAssignees(projectId, defaultAssignees)

  // Rate maps
  const overrideMap = new Map(
    (overrides ?? []).map((o) => [o.workCategoryId.toString(), o])
  )
  const defaultRateMap = new Map(
    (categoryRates ?? [])
      .filter((r) => r.currency === currency)
      .map((r) => [r.workCategoryId.toString(), r.defaultBillRate])
  )

  useEffect(() => {
    if (estimates && !initialized) {
      setRows(
        estimates.map((e) => ({
          id: e._id,
          workCategoryId: e.workCategoryId,
          hours: String(e.estimatedMinutes / 60),
        }))
      )
      setInitialized(true)
    }
  }, [estimates, initialized])

  useEffect(() => {
    setInitialized(false)
  }, [projectId])

  const usedCategoryIds = new Set(rows.map((r) => r.workCategoryId))

  function addRow() {
    setRows((prev) => [...prev, { workCategoryId: "", hours: "" }])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function handleCategorySelect(index: number, catId: string) {
    updateRow(index, "workCategoryId", catId)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await Promise.all(
        rows
          .filter((row) => row.workCategoryId)
          .map((row) =>
            upsertEstimate({
              projectId,
              workCategoryId: row.workCategoryId as Id<"workCategories">,
              estimatedMinutes: (parseFloat(row.hours) || 0) * 60,
            })
          )
      )

      if (estimates) {
        const currentCatIds = new Set(rows.map((r) => r.workCategoryId))
        await Promise.all(
          estimates
            .filter((est) => !currentCatIds.has(est.workCategoryId))
            .map((est) => removeEstimate({ id: est._id }))
        )
      }

      setInitialized(false)
      toast.success("Budget saved")
    } catch (err) {
      toastError(err, "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleRateSave(workCategoryId: Id<"workCategories">, rateStr: string) {
    const rate = parseFloat(rateStr)
    if (isNaN(rate) || rate < 0) return
    try {
      await upsertOverride({ projectId, workCategoryId, billableRate: rate })
      toast.success("Rate saved")
    } catch (err) {
      toastError(err, "Failed to save rate")
    }
  }

  async function handleRateReset(overrideId: Id<"projectRateOverrides">) {
    try {
      await removeOverride({ id: overrideId })
      toast.success("Reset to workspace default")
    } catch (err) {
      toastError(err, "Failed to reset rate")
    }
  }

  const gridCols = hasTeam
    ? "grid-cols-[minmax(120px,2fr)_70px_90px_minmax(100px,1.5fr)_28px]"
    : "grid-cols-[minmax(140px,2fr)_70px_90px_28px]"

  return (
    <Card id="budget-estimates-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Budget & Rates</CardTitle>
          <Button variant="outline" size="sm" onClick={addRow}>
            <PlusIcon data-icon="inline-start" /> Add category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Set estimated hours and billable rates per category. Rates default to workspace settings.
        </p>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
          <p className="text-sm font-medium">No categories added</p>
          <p className="text-xs text-muted-foreground">
            Add categories to estimate hours and set rates.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Header */}
          <div className={`grid min-w-[420px] ${gridCols} items-center gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground`}>
            <span>Category</span>
            <span>Hours</span>
            <span>Rate ({currency}/h)</span>
            {hasTeam && <span>Assignee</span>}
            <span />
          </div>
          {/* Rows */}
          {rows.map((row, i) => {
            const override = row.workCategoryId ? overrideMap.get(row.workCategoryId) : undefined
            const defaultRate = row.workCategoryId ? defaultRateMap.get(row.workCategoryId) : undefined
            const isRateOverride = override != null

            return (
              <div key={i} className={`grid min-w-[420px] ${gridCols} items-center gap-3 border-b px-1 py-1.5 last:border-0`}>
                <Select
                  value={row.workCategoryId}
                  onValueChange={(v) => handleCategorySelect(i, v)}
                >
                  <SelectTrigger className={INLINE_TRIGGER}>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {categories
                        ?.filter((c) => !usedCategoryIds.has(c._id) || c._id === row.workCategoryId)
                        .map((c) => (
                          <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input
                  type="number" min="0" step="0.5"
                  value={row.hours} onChange={(e) => updateRow(i, "hours", e.target.value)}
                  placeholder="0"
                  className={INLINE_INPUT}
                />
                <RateCell
                  workCategoryId={row.workCategoryId as Id<"workCategories">}
                  overrideRate={override?.billableRate}
                  overrideId={override?._id}
                  defaultRate={defaultRate}
                  onSave={(rate) => row.workCategoryId && void handleRateSave(row.workCategoryId as Id<"workCategories">, rate)}
                  onReset={override ? () => void handleRateReset(override._id) : undefined}
                />
                {hasTeam && (
                  <Select
                    value={assigneeForCategory(row.workCategoryId)}
                    onValueChange={(v) => handleAssigneeChange(row.workCategoryId, v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className={INLINE_TRIGGER}>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__none__">None</SelectItem>
                        {teamMemberOptions.map((m) => (
                          <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                <button
                  onClick={() => removeRow(i)}
                  className="flex size-6 items-center justify-center rounded text-transparent transition-colors [div:hover>&]:text-muted-foreground/40 hover:!text-destructive"
                  aria-label="Remove row"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <><Spinner data-icon="inline-start" /> Saving...</> : "Save"}
        </Button>
      </CardFooter>
    </Card>
  )
}

function RateCell({
  overrideRate,
  overrideId,
  defaultRate,
  onSave,
  onReset,
}: {
  workCategoryId: Id<"workCategories"> | undefined
  overrideRate: number | undefined
  overrideId: Id<"projectRateOverrides"> | undefined
  defaultRate: number | undefined
  onSave: (rate: string) => void
  onReset: (() => void) | undefined
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const isOverride = overrideRate != null
  const displayValue = draft ?? (isOverride ? String(overrideRate) : "")
  const placeholderText = defaultRate != null ? String(defaultRate) : "—"

  function handleBlur() {
    if (draft === null) return
    const parsed = parseFloat(draft)
    if (draft && !isNaN(parsed) && parsed >= 0) {
      onSave(draft)
    }
    setDraft(null)
  }

  return (
    <div className="flex items-center gap-0.5">
      <Input
        type="number"
        min="0"
        step="0.01"
        value={displayValue}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(displayValue)}
        onBlur={handleBlur}
        placeholder={placeholderText}
        className={cn(
          INLINE_INPUT,
          !isOverride && draft === null && "text-muted-foreground",
        )}
      />
      {isOverride && onReset && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onReset}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                aria-label="Reset to default"
              >
                <RotateCcwIcon className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Reset to default{defaultRate != null ? ` (${defaultRate})` : ""}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
