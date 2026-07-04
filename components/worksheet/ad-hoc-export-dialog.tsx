"use client"

/**
 * AdHocExportDialog — picker for the project-header "Download worksheet…"
 * trigger (Phase 9 Slice 5).
 *
 * Three filter groups (PRD §Ad-hoc range export — Picker UI):
 *   1. Period: preset radio (this/last month, this/last quarter, this/last
 *      year, all time) + Custom range with start/end pickers.
 *   2. Categories: multi-select against the project's `workCategories`.
 *      Default = "All categories" (an empty selection means no filter,
 *      same as picking every category).
 *   3. Entry type radio: All / Billable / Non-billable. Default = All.
 *
 * Behavior:
 *   - Available on Fixed, T&M, and Retainer pages — one code path.
 *   - The `Download worksheet` button is disabled until the period is
 *     valid (custom range requires start ≤ end).
 *   - On submit, the dialog stays mounted until the download fires (or
 *     toasts an error); `WorksheetMenuItem`'s logic is inlined here
 *     because this trigger is a primary button, not a menu item.
 *   - Period presets resolve against `orgSettings.timezone`. If org
 *     settings haven't loaded yet, the dialog renders the period radio
 *     disabled and waits.
 *   - Cross-cycle ranges render flat (no per-month subtotals) — that
 *     behavior lives in `buildSingleScopeCsv`, no UI work here.
 */

import { useMemo, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { CalendarIcon, FileSpreadsheetIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { DatePicker } from "@/components/ui/date-picker"
import { formatDateToYMDOrUndefined } from "@/lib/format"
import {
  resolvePeriodPreset,
  type PeriodPresetKey,
  type ResolvedPeriod,
} from "@/lib/worksheet-period-presets"
import { runExportWithToast } from "@/lib/worksheet-toast"

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  projectId: Id<"projects">
  /** Project start date (`YYYY-MM-DD`) — used as the "all time" lower bound. */
  projectStartDate?: string
}

const PRESET_OPTIONS: Array<{ key: PeriodPresetKey; label: string }> = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "last-quarter", label: "Last quarter" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "all-time", label: "All time" },
  { key: "custom", label: "Custom range" },
]

const BILLABLE_OPTIONS: Array<{
  key: "all" | "billable" | "nonBillable"
  label: string
}> = [
  { key: "all", label: "All entries" },
  { key: "billable", label: "Billable only" },
  { key: "nonBillable", label: "Non-billable only" },
]

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function AdHocExportDialog({
  open,
  onOpenChange,
  projectId,
  projectStartDate,
}: Props) {
  // Skip queries when the dialog isn't open — keeps subscription cost off
  // every project page render.
  const orgSettings = useQuery(api.orgSettings.get, open ? {} : "skip")
  const workCategories = useQuery(api.workCategories.list, open ? {} : "skip")
  const exportAdHoc = useAction(api.worksheets.exportAdHoc)

  const [presetKey, setPresetKey] = useState<PeriodPresetKey>("this-month")
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined)
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<
    Set<Id<"workCategories">>
  >(new Set())
  const [billable, setBillable] = useState<"all" | "billable" | "nonBillable">(
    "all",
  )
  const [pending, setPending] = useState(false)

  const timezone = orgSettings?.timezone

  // Derived during render — no useEffect sync (CLAUDE.md derived-state rule).
  const resolvedPeriod: ResolvedPeriod | null = useMemo(() => {
    if (!timezone) return null
    return resolvePeriodPreset({
      key: presetKey,
      timezone,
      projectStartDate,
      customStart: formatDateToYMDOrUndefined(customStart),
      customEnd: formatDateToYMDOrUndefined(customEnd),
    })
  }, [presetKey, timezone, projectStartDate, customStart, customEnd])

  const submitDisabled = !resolvedPeriod || !timezone || pending

  async function handleSubmit() {
    if (!resolvedPeriod) return
    if (pending) return
    setPending(true)
    try {
      const categoryIds = Array.from(selectedCategoryIds)
      const categoryLabels = categoryIds
        .map(
          (id) =>
            (workCategories ?? []).find((c) => c._id === id)?.name ?? "",
        )
        .filter((name) => name.length > 0)
      await runExportWithToast({
        run: () =>
          exportAdHoc({
            projectId,
            periodStart: resolvedPeriod.start,
            periodEnd: resolvedPeriod.end,
            periodSlug: resolvedPeriod.slug,
            periodLabel: resolvedPeriod.label,
            categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
            categoryLabels: categoryIds.length > 0 ? categoryLabels : undefined,
            billable: billable !== "all" ? billable : undefined,
          }),
        onResult: ({ csv, filename }) => downloadCsv(csv, filename),
      })
      onOpenChange(false)
    } catch {
      // Error toast already shown by runExportWithToast; the dialog stays
      // open so the admin can adjust filters and retry without losing
      // their selections.
    } finally {
      setPending(false)
    }
  }

  function toggleCategory(id: Id<"workCategories">) {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allCategoriesSelected =
    !workCategories || selectedCategoryIds.size === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Download worksheet</DialogTitle>
          <DialogDescription>
            Pick a period and optional filters. The CSV is a fresh render —
            no draft is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {/* Period */}
          <section className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Period
            </Label>
            {timezone ? (
              <RadioGroup
                value={presetKey}
                onValueChange={(v) => setPresetKey(v as PeriodPresetKey)}
                className="grid grid-cols-2 gap-2"
              >
                {PRESET_OPTIONS.map((opt) => (
                  <div key={opt.key} className="flex items-center gap-2">
                    <RadioGroupItem
                      id={`worksheet-period-${opt.key}`}
                      value={opt.key}
                    />
                    <Label
                      htmlFor={`worksheet-period-${opt.key}`}
                      className="cursor-pointer text-sm font-normal"
                    >
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {PRESET_OPTIONS.map((opt) => (
                  <Skeleton key={opt.key} className="h-5 w-32" />
                ))}
              </div>
            )}

            {presetKey === "custom" && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                <DatePicker
                  value={customStart}
                  onChange={setCustomStart}
                  placeholder="Start date"
                />
                <DatePicker
                  value={customEnd}
                  onChange={setCustomEnd}
                  placeholder="End date"
                />
              </div>
            )}

            {resolvedPeriod && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarIcon className="size-3" aria-hidden />
                {resolvedPeriod.label}
              </p>
            )}
            {presetKey === "custom" &&
              customStart &&
              customEnd &&
              !resolvedPeriod && (
                <p className="text-xs text-destructive">
                  End date must be on or after start date.
                </p>
              )}
          </section>

          {/* Categories */}
          <section className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Categories
            </Label>
            {workCategories ? (
              workCategories.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No work categories set up.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {workCategories.map((cat) => {
                    const checked = selectedCategoryIds.has(cat._id)
                    return (
                      <div key={cat._id} className="flex items-center gap-2">
                        <Checkbox
                          id={`worksheet-cat-${cat._id}`}
                          checked={checked}
                          onCheckedChange={() => toggleCategory(cat._id)}
                        />
                        <Label
                          htmlFor={`worksheet-cat-${cat._id}`}
                          className="cursor-pointer text-sm font-normal"
                        >
                          {cat.name}
                        </Label>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-5 w-28" />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {allCategoriesSelected
                ? "All categories included."
                : `${selectedCategoryIds.size} selected.`}
            </p>
          </section>

          {/* Entry type */}
          <section className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Entry type
            </Label>
            <RadioGroup
              value={billable}
              onValueChange={(v) =>
                setBillable(v as "all" | "billable" | "nonBillable")
              }
              className="grid gap-1.5"
            >
              {BILLABLE_OPTIONS.map((opt) => (
                <div key={opt.key} className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`worksheet-billable-${opt.key}`}
                    value={opt.key}
                  />
                  <Label
                    htmlFor={`worksheet-billable-${opt.key}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
          >
            <FileSpreadsheetIcon className="size-4" aria-hidden />
            {pending ? "Generating…" : "Download worksheet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

