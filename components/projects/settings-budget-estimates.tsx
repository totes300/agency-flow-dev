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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { PlusIcon, XIcon, Loader2Icon } from "lucide-react"
import { cn, NUMBER_INPUT_CLASS } from "@/lib/utils"

type Row = {
  id?: string
  workCategoryId: string
  hours: string
  costRate: string
  billRate: string
}

const BUDGET_NUMBER_INPUT_CLASS = cn("h-8 text-sm", NUMBER_INPUT_CLASS)

export function SettingsBudgetEstimates({
  projectId,
  currency,
}: {
  projectId: Id<"projects">
  currency: string
}) {
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const upsertEstimate = useMutation(api.projectCategoryEstimates.upsert)
  const removeEstimate = useMutation(api.projectCategoryEstimates.remove)

  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

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
      // Upsert all rows in parallel
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

      // Remove deleted rows in parallel
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
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const gridCols = "grid-cols-[minmax(140px,2fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(100px,1fr)_32px]"

  return (
    <Card id="budget-estimates-section">
      <CardHeader>
        <CardTitle>Budget Estimates</CardTitle>
      </CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Add budget estimates per category.</p>
          <Button variant="outline" size="sm" onClick={addRow}>
            <PlusIcon className="size-3.5" /> Add category
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={`grid ${gridCols} gap-2 text-xs font-medium text-muted-foreground`}>
            <span>Category</span>
            <span>Est. hours</span>
            <span>Cost rate ({currency})</span>
            <span>Bill rate ({currency})</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className={`grid ${gridCols} items-center gap-2`}>
              <Select
                value={row.workCategoryId}
                onValueChange={(v) => handleCategorySelect(i, v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    ?.filter((c) => !usedCategoryIds.has(c._id) || c._id === row.workCategoryId)
                    .map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                type="number" min="0" step="0.5"
                value={row.hours} onChange={(e) => updateRow(i, "hours", e.target.value)}
                className="h-8 text-sm"
              />
              <div className="relative">
                <Input
                  type="number" min="0" step="0.01"
                  value={row.costRate} onChange={(e) => updateRow(i, "costRate", e.target.value)}
                  className={BUDGET_NUMBER_INPUT_CLASS}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/h</span>
              </div>
              <div className="relative">
                <Input
                  type="number" min="0" step="0.01"
                  value={row.billRate} onChange={(e) => updateRow(i, "billRate", e.target.value)}
                  className={BUDGET_NUMBER_INPUT_CLASS}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/h</span>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
                <XIcon className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button variant="outline" size="sm" onClick={addRow}>
              <PlusIcon className="size-3.5" /> Add category
            </Button>
          </div>
        </div>
      )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <><Loader2Icon className="size-3.5 animate-spin" /> Saving...</> : "Save"}
        </Button>
      </CardFooter>
    </Card>
  )
}
