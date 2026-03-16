"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { PlusIcon, XIcon, Loader2Icon } from "lucide-react"
import { NUMBER_INPUT_CLASS } from "@/lib/utils"

type ProjectData = {
  billingType: string
  tmRateMode?: string
  hourlyRate?: number
  tmCategoryRates?: Array<{ workCategoryId: Id<"workCategories">; rate: number }>
  currency: string
}

export function SettingsRates({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: ProjectData
}) {
  const updateProject = useMutation(api.projects.update)
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const [hourlyRate, setHourlyRate] = useState(String(project.hourlyRate ?? ""))
  const [catRates, setCatRates] = useState<Array<{ workCategoryId: string; rate: string }>>(
    (project.tmCategoryRates ?? []).map((cr) => ({
      workCategoryId: cr.workCategoryId,
      rate: String(cr.rate),
    }))
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHourlyRate(String(project.hourlyRate ?? ""))
    setCatRates(
      (project.tmCategoryRates ?? []).map((cr) => ({
        workCategoryId: cr.workCategoryId,
        rate: String(cr.rate),
      }))
    )
  }, [project.hourlyRate, project.tmCategoryRates])

  const usedCategoryIds = new Set(catRates.map((cr) => cr.workCategoryId))

  async function handleSave() {
    setSaving(true)
    try {
      if (project.tmRateMode === "flat") {
        await updateProject({ id: projectId, hourlyRate: parseFloat(hourlyRate) || 0 })
      } else {
        await updateProject({
          id: projectId,
          tmCategoryRates: catRates
            .filter((cr) => cr.workCategoryId)
            .map((cr) => ({
              workCategoryId: cr.workCategoryId as Id<"workCategories">,
              rate: parseFloat(cr.rate) || 0,
            })),
        })
      }
      toast.success("Rates saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates</CardTitle>
      </CardHeader>
      <CardContent>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Rate mode:</span>
        <span className="font-medium">
          {project.tmRateMode === "flat" ? "Flat rate" : "Per-category rates"}
        </span>
        <span className="text-xs text-muted-foreground">(read-only)</span>
      </div>

      {project.tmRateMode === "flat" ? (
        <div className="space-y-1.5">
          <Label htmlFor="tm-rate">Hourly rate</Label>
          <div className="flex items-center gap-2">
            <Input
              id="tm-rate"
              type="number" min="0" step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">{project.currency}/h</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[minmax(140px,2fr)_minmax(100px,1fr)_32px] gap-2 text-xs font-medium text-muted-foreground">
            <span>Category</span>
            <span>Rate ({project.currency}/h)</span>
            <span />
          </div>
          {catRates.map((cr, i) => (
            <div key={i} className="grid grid-cols-[minmax(140px,2fr)_minmax(100px,1fr)_32px] items-center gap-2">
              <Select
                value={cr.workCategoryId}
                onValueChange={(v) =>
                  setCatRates((prev) => prev.map((r, j) => (j === i ? { ...r, workCategoryId: v } : r)))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    ?.filter((c) => !usedCategoryIds.has(c._id) || c._id === cr.workCategoryId)
                    .map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Input
                  type="number" min="0" step="0.01"
                  value={cr.rate}
                  onChange={(e) =>
                    setCatRates((prev) => prev.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))
                  }
                  className={NUMBER_INPUT_CLASS}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/h</span>
              </div>
              <Button
                variant="ghost" size="icon-sm"
                onClick={() => setCatRates((prev) => prev.filter((_, j) => j !== i))}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline" size="sm"
            onClick={() => setCatRates((prev) => [...prev, { workCategoryId: "", rate: "" }])}
          >
            <PlusIcon className="size-3.5" /> Add category rate
          </Button>
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
