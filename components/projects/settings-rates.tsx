"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
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
import { Loader2Icon, RotateCcwIcon } from "lucide-react"
import { useDefaultAssignees, type DefaultAssignee } from "@/lib/hooks/use-default-assignees"
import { cn } from "@/lib/utils"

type ProjectData = {
  billingType: string
  currency: string
}

const INLINE_INPUT = "h-8 w-24 border-0 bg-transparent px-0 text-sm shadow-none outline-none ring-0 focus-visible:ring-0 tabular-nums"
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
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const overrides = useQuery(api.projectRateOverrides.listForProject, { projectId })
  const categoryRates = useQuery(api.categoryRates.list, {})
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const upsertOverride = useMutation(api.projectRateOverrides.upsert)
  const removeOverride = useMutation(api.projectRateOverrides.remove)

  const teamMemberOptions = orgMembers?.filter((m) => teamMembers.some((id) => id.toString() === m._id.toString())) ?? []
  const hasTeam = teamMemberOptions.length > 0
  const { assigneeForCategory, handleAssigneeChange } = useDefaultAssignees(projectId, defaultAssignees)

  const [savingId, setSavingId] = useState<string | null>(null)

  // Build maps
  const overrideMap = new Map(
    (overrides ?? []).map((o) => [o.workCategoryId.toString(), o])
  )
  const defaultRateMap = new Map(
    (categoryRates ?? [])
      .filter((r) => r.currency === project.currency)
      .map((r) => [r.workCategoryId.toString(), r.defaultBillRate])
  )

  async function handleRateSave(workCategoryId: Id<"workCategories">, rateStr: string) {
    const rate = parseFloat(rateStr)
    if (isNaN(rate) || rate < 0) return

    setSavingId(workCategoryId)
    try {
      await upsertOverride({ projectId, workCategoryId, billableRate: rate })
      toast.success("Rate override saved")
    } catch (err) {
      toastError(err, "Failed to save rate")
    } finally {
      setSavingId(null)
    }
  }

  async function handleResetToDefault(overrideId: Id<"projectRateOverrides">, categoryName: string) {
    setSavingId(overrideId)
    try {
      await removeOverride({ id: overrideId })
      toast.success(`${categoryName} reset to workspace default`)
    } catch (err) {
      toastError(err, "Failed to reset rate")
    } finally {
      setSavingId(null)
    }
  }

  if (!categories || overrides === undefined || !categoryRates) return null

  const activeCategories = categories.filter((c) => !c.archivedAt)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billable Rates</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Rates default to workspace category rates. Override per category for this project only.
        </p>

        {/* Header */}
        <div className={`grid ${hasTeam ? "grid-cols-[minmax(120px,2fr)_120px_minmax(110px,1.5fr)]" : "grid-cols-[minmax(140px,2fr)_120px]"} items-center gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground`}>
          <span>Category</span>
          <span>Rate ({project.currency}/h)</span>
          {hasTeam && <span>Default Assignee</span>}
        </div>

        {/* Rows */}
        {activeCategories.map((cat) => {
          const override = overrideMap.get(cat._id.toString())
          const defaultRate = defaultRateMap.get(cat._id.toString())
          return (
            <CategoryRateRow
              key={cat._id}
              categoryId={cat._id}
              categoryName={cat.name}
              overrideId={override?._id}
              overrideRate={override?.billableRate}
              defaultRate={defaultRate}
              saving={savingId === cat._id || savingId === override?._id}
              onSave={(rate) => void handleRateSave(cat._id, rate)}
              onReset={override ? () => void handleResetToDefault(override._id, cat.name) : undefined}
              hasTeam={hasTeam}
              assignee={assigneeForCategory(cat._id)}
              onAssigneeChange={(v) => handleAssigneeChange(cat._id, v)}
              teamMemberOptions={teamMemberOptions}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}

function CategoryRateRow({
  categoryName,
  overrideRate,
  defaultRate,
  saving,
  onSave,
  onReset,
  hasTeam,
  assignee,
  onAssigneeChange,
  teamMemberOptions,
}: {
  categoryId: Id<"workCategories">
  categoryName: string
  overrideId: Id<"projectRateOverrides"> | undefined
  overrideRate: number | undefined
  defaultRate: number | undefined
  saving: boolean
  onSave: (rate: string) => void
  onReset: (() => void) | undefined
  hasTeam: boolean
  assignee: string
  onAssigneeChange: (v: string) => void
  teamMemberOptions: Array<{ _id: Id<"users">; name: string }>
}) {
  // Draft tracks in-progress typing. null = not editing, show the committed value.
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
    <div className={cn(
      "grid items-center gap-3 border-b px-1 py-1.5 last:border-0",
      hasTeam ? "grid-cols-[minmax(120px,2fr)_120px_minmax(110px,1.5fr)]" : "grid-cols-[minmax(140px,2fr)_120px]",
    )}>
      <span className="text-sm">{categoryName}</span>

      <div className="flex items-center gap-1">
        {saving ? (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
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
                      className="flex size-5 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                      aria-label={`Reset ${categoryName} to workspace default`}
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
          </>
        )}
      </div>

      {/* Assignee */}
      {hasTeam && (
        <Select
          value={assignee}
          onValueChange={(v) => onAssigneeChange(v === "__none__" ? "" : v)}
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
    </div>
  )
}
