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
import { toastError } from "@/lib/toast-helpers"
import { PlusIcon, XIcon, Loader2Icon } from "lucide-react"
import { useDefaultAssignees, type DefaultAssignee } from "@/lib/hooks/use-default-assignees"

type ProjectData = {
  billingType: string
  tmRateMode?: string
  hourlyRate?: number
  tmCategoryRates?: Array<{ workCategoryId: Id<"workCategories">; rate: number }>
  currency: string
}

const INLINE_INPUT = "h-8 w-full border-0 bg-transparent px-0 text-sm shadow-none outline-none ring-0 focus-visible:ring-0 tabular-nums"
const INLINE_TRIGGER = "h-8 border-0 bg-transparent px-0 shadow-none ring-0 text-sm focus:ring-0 [&_svg:last-child]:hidden"

export function SettingsRates({
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
  const updateProject = useMutation(api.projects.update)
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const teamMemberOptions = orgMembers?.filter((m) => teamMembers.some((id) => id.toString() === m._id.toString())) ?? []
  const hasTeam = teamMemberOptions.length > 0
  const { assigneeForCategory, handleAssigneeChange } = useDefaultAssignees(projectId, defaultAssignees)

  // Local state: only rate data (no assignees)
  const [hourlyRate, setHourlyRate] = useState(String(project.hourlyRate ?? ""))
  const [catRates, setCatRates] = useState<Array<{ workCategoryId: string; rate: string }>>(
    (project.tmCategoryRates ?? []).map((cr) => ({
      workCategoryId: cr.workCategoryId as string,
      rate: String(cr.rate),
    }))
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setHourlyRate(String(project.hourlyRate ?? ""))
    setCatRates(
      (project.tmCategoryRates ?? []).map((cr) => ({
        workCategoryId: cr.workCategoryId as string,
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
      toastError(err, "Failed to save")
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
        <div className="overflow-x-auto">
          {/* Header */}
          <div className={`grid min-w-[400px] ${hasTeam ? "grid-cols-[minmax(120px,2fr)_100px_minmax(110px,1.5fr)_28px]" : "grid-cols-[minmax(140px,2fr)_100px_28px]"} items-center gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground`}>
            <span>Category</span>
            <span>Rate ({project.currency}/h)</span>
            {hasTeam && <span>Assignee</span>}
            <span />
          </div>
          {/* Rows */}
          {catRates.map((cr, i) => (
            <div key={i} className={`grid min-w-[400px] ${hasTeam ? "grid-cols-[minmax(120px,2fr)_100px_minmax(110px,1.5fr)_28px]" : "grid-cols-[minmax(140px,2fr)_100px_28px]"} items-center gap-3 border-b px-1 py-1.5 last:border-0`}>
              <Select
                value={cr.workCategoryId}
                onValueChange={(v) =>
                  setCatRates((prev) => prev.map((r, j) => (j === i ? { ...r, workCategoryId: v } : r)))
                }
              >
                <SelectTrigger className={INLINE_TRIGGER}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    ?.filter((c) => !usedCategoryIds.has(c._id) || c._id === cr.workCategoryId)
                    .map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                type="number" min="0" step="0.01"
                value={cr.rate}
                onChange={(e) =>
                  setCatRates((prev) => prev.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))
                }
                placeholder="0"
                className={INLINE_INPUT}
              />
              {hasTeam && (
                <Select
                  value={assigneeForCategory(cr.workCategoryId)}
                  onValueChange={(v) => handleAssigneeChange(cr.workCategoryId, v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className={INLINE_TRIGGER}>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {teamMemberOptions.map((m) => (
                      <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="ghost" size="icon-xs"
                className="opacity-0 focus-visible:opacity-100 [div:hover>&]:opacity-100"
                onClick={() => setCatRates((prev) => prev.filter((_, j) => j !== i))}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <div className="pt-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setCatRates((prev) => [...prev, { workCategoryId: "", rate: "" }])}
            >
              <PlusIcon data-icon="inline-start" /> Add category rate
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
