"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { DialogClose } from "@/components/ui/dialog"
import {
  FormModal,
  FormModalDescription,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
} from "@/components/ui/form-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"

/**
 * Focused modal for editing Fixed project scope estimates — hours per work
 * category only. Power users can still tune rates in the full Settings →
 * Budget & Rates tab; this modal exists so the Fixed summary card can
 * resolve its empty state (no budget → no Expected rate → no scope-creep
 * signal) in one click without a tab jump.
 *
 * The form loads one row per active work category, seeded with any existing
 * estimate. Save upserts each category's estimate via
 * `projectCategoryEstimates.upsert`.
 */
export function BudgetEstimatesModal({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
}) {
  const categories = useQuery(
    api.workCategories.list,
    open ? { includeArchived: false } : "skip",
  )
  const estimates = useQuery(
    api.projectCategoryEstimates.list,
    open ? { projectId } : "skip",
  )
  const upsertEstimate = useMutation(api.projectCategoryEstimates.upsert)

  const [hoursByCategory, setHoursByCategory] = useState<Record<string, string>>({})
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setInitialized(false)
      setHoursByCategory({})
    }
  }, [open])

  useEffect(() => {
    if (open && categories && estimates && !initialized) {
      // Seed every category to empty string so the placeholder "0" shows.
      // Non-zero existing estimates pre-fill with their hour value.
      const map: Record<string, string> = {}
      for (const cat of categories) {
        map[cat._id.toString()] = ""
      }
      for (const est of estimates) {
        const hours = est.estimatedMinutes / 60
        if (hours > 0) map[est.workCategoryId.toString()] = String(hours)
      }
      setHoursByCategory(map)
      setInitialized(true)
    }
  }, [open, categories, estimates, initialized])

  const totalHours = Object.values(hoursByCategory).reduce(
    (sum, h) => sum + (parseFloat(h) || 0),
    0,
  )

  async function handleSave() {
    if (!categories || !estimates) return
    setSaving(true)
    // Snapshot existing estimates so we only upsert rows the user actually
    // changed. Prevents a flood of 0→0 writes on orgs with many categories.
    const existingByCategory = new Map<string, number>(
      estimates.map((e) => [e.workCategoryId.toString(), e.estimatedMinutes]),
    )
    const mutations = categories
      .map((cat) => {
        const key = cat._id.toString()
        const newMinutes = Math.round((parseFloat(hoursByCategory[key] ?? "") || 0) * 60)
        const oldMinutes = existingByCategory.get(key) ?? 0
        const hadRow = existingByCategory.has(key)
        // Skip: value unchanged.
        if (newMinutes === oldMinutes) return null
        // Skip: no row existed AND new value is still 0 — don't bloat the table.
        if (!hadRow && newMinutes === 0) return null
        return upsertEstimate({
          projectId,
          workCategoryId: cat._id,
          estimatedMinutes: newMinutes,
        })
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)

    try {
      if (mutations.length > 0) {
        await Promise.all(mutations)
        toast.success("Scope estimates saved")
      }
      onOpenChange(false)
    } catch (err) {
      toastError(err, "Failed to save estimates")
    } finally {
      setSaving(false)
    }
  }

  const loading = categories === undefined || estimates === undefined

  return (
    <FormModal
      open={open}
      onOpenChange={(v) => { if (!saving) onOpenChange(v) }}
      size="md"
    >
      <FormModalHeader align="start">
        <FormModalTitle>Set scope estimates</FormModalTitle>
        <FormModalDescription>
          Estimated hours per category. Unlocks Expected hourly rate and scope-creep tracking.
        </FormModalDescription>
      </FormModalHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner />
          </div>
        ) : categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No work categories yet. Add some in Settings → Categories first.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground">
              <span>Category</span>
              <span className="w-24 text-right">Hours</span>
            </div>
            {categories.map((cat) => (
              <div
                key={cat._id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-1 py-1"
              >
                <span className="text-sm">{cat.name}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={hoursByCategory[cat._id.toString()] ?? ""}
                  onChange={(e) =>
                    setHoursByCategory((prev) => ({
                      ...prev,
                      [cat._id.toString()]: e.target.value,
                    }))
                  }
                  placeholder="0"
                  className="h-8 w-24 text-right tabular-nums"
                />
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t px-1 pt-2 text-sm">
              <span className="font-medium">Total</span>
              <span className="font-semibold tabular-nums">{totalHours.toFixed(1)} h</span>
            </div>
          </div>
        )}

        <FormModalFooter align="row">
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Spinner data-icon="inline-start" /> Saving...</> : "Save"}
          </Button>
        </FormModalFooter>
    </FormModal>
  )
}
