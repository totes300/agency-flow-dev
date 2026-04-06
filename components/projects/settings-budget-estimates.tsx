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
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { PlusIcon, XIcon } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { useDefaultAssignees, type DefaultAssignee } from "@/lib/hooks/use-default-assignees"

type Row = {
  id?: string
  workCategoryId: string
  hours: string
  costRate: string
  billRate: string
}

const INLINE_INPUT = "h-8 w-full border-0 bg-transparent px-0 text-sm shadow-none outline-none ring-0 focus-visible:ring-0 focus-visible:border-0 tabular-nums"
const INLINE_TRIGGER = "h-8 border-0 bg-transparent px-0 shadow-none ring-0 text-sm focus:ring-0 hover:bg-transparent data-[state=open]:bg-transparent [&_svg:last-child]:hidden"

export function SettingsBudgetEstimates({
  projectId,
  currency,
  teamMembers = [],
  defaultAssignees = [],
}: {
  projectId: Id<"projects">
  currency: string
  teamMembers?: Id<"users">[]
  defaultAssignees?: DefaultAssignee[]
}) {
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const upsertEstimate = useMutation(api.projectCategoryEstimates.upsert)
  const removeEstimate = useMutation(api.projectCategoryEstimates.remove)

  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const teamMemberOptions = orgMembers?.filter((m) => teamMembers.some((id) => id.toString() === m._id.toString())) ?? []
  const hasTeam = teamMemberOptions.length > 0
  const { assigneeForCategory, handleAssigneeChange } = useDefaultAssignees(projectId, defaultAssignees)

  useEffect(() => {
    if (estimates && !initialized) {
      setRows(
        estimates.map((e) => ({
          id: e._id,
          workCategoryId: e.workCategoryId,
          hours: String(e.estimatedMinutes / 60),
          costRate: e.internalCostRate !== undefined ? String(e.internalCostRate) : "",
          billRate: e.clientBillingRate !== undefined ? String(e.clientBillingRate) : "",
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
    setRows((prev) => [...prev, { workCategoryId: "", hours: "", costRate: "", billRate: "" }])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function handleCategorySelect(index: number, catId: string) {
    updateRow(index, "workCategoryId", catId)
    if (categories) {
      const cat = categories.find((c) => c._id === catId)
      if (cat?.defaultCostRate !== undefined) updateRow(index, "costRate", String(cat.defaultCostRate))
      if (cat?.defaultBillRate !== undefined) updateRow(index, "billRate", String(cat.defaultBillRate))
    }
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
              internalCostRate: row.costRate ? parseFloat(row.costRate) : undefined,
              clientBillingRate: row.billRate ? parseFloat(row.billRate) : undefined,
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
      toast.success("Budget estimates saved")
    } catch (err) {
      toastError(err, "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const gridCols = hasTeam
    ? "grid-cols-[minmax(120px,2fr)_80px_100px_100px_minmax(110px,1.5fr)_28px]"
    : "grid-cols-[minmax(140px,2fr)_80px_100px_100px_28px]"

  return (
    <Card id="budget-estimates-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Budget Estimates</CardTitle>
          <Button variant="outline" size="sm" onClick={addRow}>
            <PlusIcon data-icon="inline-start" /> Add category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
          <p className="text-sm font-medium">No budget estimates</p>
          <p className="text-xs text-muted-foreground">
            Add categories to estimate hours and set rates.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Header */}
          <div className={`grid min-w-[520px] ${gridCols} items-center gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground`}>
            <span>Category</span>
            <span>Hours</span>
            <span>Cost ({currency}/h)</span>
            <span>Bill ({currency}/h)</span>
            {hasTeam && <span>Assignee</span>}
            <span />
          </div>
          {/* Rows */}
          {rows.map((row, i) => (
            <div key={i} className={`grid min-w-[520px] ${gridCols} items-center gap-3 border-b px-1 py-1.5 last:border-0`}>
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
              <Input
                type="number" min="0" step="0.01"
                value={row.costRate} onChange={(e) => updateRow(i, "costRate", e.target.value)}
                placeholder="0"
                className={INLINE_INPUT}
              />
              <Input
                type="number" min="0" step="0.01"
                value={row.billRate} onChange={(e) => updateRow(i, "billRate", e.target.value)}
                placeholder="0"
                className={INLINE_INPUT}
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
              <Button variant="ghost" size="icon-xs" onClick={() => removeRow(i)} className="opacity-0 focus-visible:opacity-100 [div:hover>&]:opacity-100">
                <XIcon />
              </Button>
            </div>
          ))}
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
