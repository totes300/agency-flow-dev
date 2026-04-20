"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { DialogClose } from "@/components/ui/dialog"
import {
  FormModal,
  FormModalBody,
  FormModalDescription,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
} from "@/components/ui/form-modal"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatCurrency,
  formatDateToYMDOrUndefined,
  parseYMDToLocalDate,
} from "@/lib/format"
import { extractErrorMessage } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { InfoIcon, LoaderIcon } from "lucide-react"

type Preset = "all" | "this_month" | "previous_month" | "custom"

const ROUNDING_OPTIONS = [
  { value: "0", label: "Don't round" },
  { value: "5", label: "Round to 5 min" },
  { value: "15", label: "Round to 15 min" },
  { value: "30", label: "Round to 30 min" },
  { value: "60", label: "Round to 1 hour" },
] as const

function getPresetDates(preset: Preset, timezone: string): { start?: string; end?: string } {
  if (preset === "all") return {}
  if (preset === "custom") return {}

  const now = new Date()
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
  const today = formatter.format(now)
  const [year, month] = today.split("-").map(Number)

  if (preset === "this_month") {
    const start = `${year}-${String(month).padStart(2, "0")}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    return { start, end }
  }

  if (preset === "previous_month") {
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const start = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`
    const lastDay = new Date(prevYear, prevMonth, 0).getDate()
    const end = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    return { start, end }
  }

  return {}
}

const BILLING_TYPE_LABELS: Record<string, string> = {
  t_and_m: "Time & Materials",
  fixed: "Fixed Fee",
  retainer: "Retainer",
}

export function CreateInvoiceModal({
  open,
  onOpenChange,
  projectId,
  projectName,
  billingType,
  currency,
  initialRetainerYear,
  initialRetainerMonth,
  timeEntryIds,
  skippedCount,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  projectName: string
  billingType: string
  currency: string
  /**
   * Prefills the retainer month selector. Consumed ONCE at mount via the lazy
   * `useState` initializer below — later prop changes do NOT re-prefill.
   * Parents that may switch the prefilled month (`ready-to-invoice-card`,
   * `retainer-overview`) must force a remount via a matching `key={...}`.
   */
  initialRetainerYear?: number
  initialRetainerMonth?: number
  /**
   * Selection mode (T&M only): when provided, the modal hides preset/date
   * inputs and shows a compact "N entries · date range" summary. The preview
   * and create call forward these ids to the backend. Incompatible with
   * retainer billing (enforced server-side).
   */
  timeEntryIds?: Id<"timeEntries">[]
  /**
   * How many of the parent's original selection were skipped (non-billable
   * or already invoiced). Drives the "N of M" hint in SelectionSummary so
   * the user isn't surprised by a smaller invoice than they selected.
   */
  skippedCount?: number
  onCreated?: (invoiceId: Id<"invoices">) => void
}) {
  const router = useRouter()
  const { isAuthenticated } = useConvexAuth()
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const createInvoice = useMutation(api.invoices.createInvoice)

  const timezone = orgSettings?.timezone ?? "UTC"
  const isRetainer = billingType === "retainer"
  const isFixed = billingType === "fixed"
  const isSelectionMode = timeEntryIds !== undefined && timeEntryIds.length > 0

  const [preset, setPreset] = useState<Preset>("all")
  const [customStart, setCustomStart] = useState<string | undefined>(undefined)
  const [customEnd, setCustomEnd] = useState<string | undefined>(undefined)

  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(() =>
    initialRetainerYear && initialRetainerMonth
      ? `${initialRetainerYear}-${initialRetainerMonth}`
      : undefined,
  )

  const [roundingMinutes, setRoundingMinutes] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState("")

  const dateRange = useMemo(() => {
    if (preset === "custom") return { start: customStart, end: customEnd }
    return getPresetDates(preset, timezone)
  }, [preset, customStart, customEnd, timezone])

  const retainerMonths = useQuery(
    api.invoices.getRetainerUninvoicedMonths,
    isAuthenticated && open && isRetainer ? { projectId } : "skip",
  )

  const closedUninvoicedMonths = useMemo(
    () => retainerMonths ?? [],
    [retainerMonths],
  )

  // When retainer and no prefill / manual pick yet, default to the most recent
  // closed uninvoiced month — that's the 90% path ("invoice last month").
  // `closedUninvoicedMonths` is returned oldest → newest.
  const autoSelectedMonth = useMemo(() => {
    if (!isRetainer) return undefined
    if (closedUninvoicedMonths.length === 0) return undefined
    const latest = closedUninvoicedMonths[closedUninvoicedMonths.length - 1]
    return `${latest.year}-${latest.month}`
  }, [isRetainer, closedUninvoicedMonths])

  const effectiveMonth = selectedMonth ?? autoSelectedMonth

  const retainerYear = effectiveMonth ? Number(effectiveMonth.split("-")[0]) : undefined
  const retainerMonthNum = effectiveMonth ? Number(effectiveMonth.split("-")[1]) : undefined

  const preview = useQuery(
    api.invoices.getInvoicePreview,
    isAuthenticated && open && !isRetainer
      ? isSelectionMode
        ? { projectId, roundingMinutes, timeEntryIds }
        : { projectId, startDate: dateRange.start, endDate: dateRange.end, roundingMinutes }
      : "skip",
  )

  const retainerPreview = useQuery(
    api.invoices.getRetainerInvoicePreview,
    isAuthenticated && open && isRetainer && retainerYear && retainerMonthNum
      ? { projectId, year: retainerYear, month: retainerMonthNum, roundingMinutes }
      : "skip",
  )

  const previewLoading = isRetainer
    ? (effectiveMonth ? retainerPreview === undefined : false)
    : preview === undefined
  const hasEntries = preview !== null && preview !== undefined && preview.entryCount > 0

  const canCreate = isSelectionMode
    ? hasEntries
    : isRetainer
      ? effectiveMonth !== undefined && retainerPreview !== null && retainerPreview !== undefined
      : isFixed
        ? preview !== null && preview !== undefined && (preview.billingAmount ?? 0) > 0
        : hasEntries

  function handlePresetChange(newPreset: Preset) {
    setPreset(newPreset)
    if (newPreset !== "custom") { setCustomStart(undefined); setCustomEnd(undefined) }
  }

  async function handleCreate() {
    setIsCreating(true)
    setError("")
    try {
      const invoiceId = await createInvoice({
        projectId,
        startDate: isRetainer || isSelectionMode ? undefined : dateRange.start,
        endDate: isRetainer || isSelectionMode ? undefined : dateRange.end,
        roundingMinutes,
        retainerYear: isRetainer ? retainerYear : undefined,
        retainerMonth: isRetainer ? retainerMonthNum : undefined,
        timeEntryIds: isSelectionMode ? timeEntryIds : undefined,
      })
      onOpenChange(false)
      if (onCreated) {
        onCreated(invoiceId)
      } else {
        router.push(`/invoices/${invoiceId}?from=project&projectId=${projectId}&tab=invoices`)
      }
      toast.success("Invoice created")
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to create invoice"))
    } finally {
      setIsCreating(false)
    }
  }

  const presets: { value: Preset; label: string }[] = [
    { value: "all", label: "All uninvoiced" },
    { value: "this_month", label: "This month" },
    { value: "previous_month", label: "Previous month" },
    { value: "custom", label: "Custom" },
  ]

  return (
    <FormModal
      open={open}
      onOpenChange={(v) => { if (!isCreating) onOpenChange(v) }}
      size="lg"
      // Block Esc / outside-click while the create mutation is running. The
      // onOpenChange guard covers the state flip, but preventing the event
      // at the source stops focus from bouncing out of the dialog.
      contentProps={{
        onEscapeKeyDown: (e) => { if (isCreating) e.preventDefault() },
        onInteractOutside: (e) => { if (isCreating) e.preventDefault() },
      }}
    >
      <FormModalHeader>
        <FormModalTitle>Create Invoice</FormModalTitle>
        <FormModalDescription>
          {projectName} — {BILLING_TYPE_LABELS[billingType] ?? billingType}
        </FormModalDescription>
      </FormModalHeader>

      <FormModalBody>
        {/* Period card — Selection: compact summary; T&M / Fixed: presets; Retainer: month */}
        <div className="rounded-lg border p-6">
          <p className="mb-4 text-sm font-medium">
            {isSelectionMode ? "Selected entries" : isRetainer ? "Month" : "Period"}
          </p>

          {isSelectionMode ? (
            <SelectionSummary
              count={timeEntryIds!.length}
              skippedCount={skippedCount ?? 0}
              totalMinutes={preview?.totalMinutes}
              totalAmount={preview?.totalAmount}
              currency={currency}
              loading={preview === undefined}
            />
          ) : isRetainer ? (
            <Select
              value={effectiveMonth ?? ""}
              onValueChange={(v) => setSelectedMonth(v || undefined)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a month..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {closedUninvoicedMonths.length === 0 && (
                    <SelectItem value="__none" disabled>
                      No uninvoiced months
                    </SelectItem>
                  )}
                  {closedUninvoicedMonths.map((m) => (
                    <SelectItem key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <>
              <ToggleGroup
                type="single"
                value={preset}
                onValueChange={(v) => { if (v) handlePresetChange(v as Preset) }}
                variant="pill"
                spacing={2}
                className="flex-wrap"
                aria-label="Period preset"
              >
                {presets.map((p) => (
                  <ToggleGroupItem
                    key={p.value}
                    value={p.value}
                    className="rounded-full px-3.5"
                  >
                    {p.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="invoice-start-date">Start date</FieldLabel>
                  <DatePicker
                    id="invoice-start-date"
                    value={parseYMDToLocalDate(dateRange.start)}
                    onChange={(d) => {
                      if (preset !== "custom") setPreset("custom")
                      setCustomStart(formatDateToYMDOrUndefined(d))
                    }}
                    disabled={preset !== "custom"}
                    placeholder="Start"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="invoice-end-date">End date</FieldLabel>
                  <DatePicker
                    id="invoice-end-date"
                    value={parseYMDToLocalDate(dateRange.end)}
                    onChange={(d) => {
                      if (preset !== "custom") setPreset("custom")
                      setCustomEnd(formatDateToYMDOrUndefined(d))
                    }}
                    disabled={preset !== "custom"}
                    placeholder="End"
                  />
                </Field>
              </div>
            </>
          )}
        </div>

        {/* Options card — rounding (T&M + Retainer only; Fixed doesn't roll up time) */}
        {!isFixed && (
          <div className="rounded-lg border p-6">
            <div className="mb-4 flex items-center gap-1.5">
              <p className="text-sm font-medium">Options</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Rounding only affects hours on this invoice. Original tracked time is not modified.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Select
              value={String(roundingMinutes)}
              onValueChange={(v) => setRoundingMinutes(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ROUNDING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Preview card */}
        <div className="rounded-lg border bg-muted/30 p-6">
          <p className="mb-4 text-sm font-medium">Preview</p>

          {isRetainer ? (
            !effectiveMonth ? (
              <p className="text-xs text-muted-foreground">Select a month to see the preview.</p>
            ) : previewLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            ) : retainerPreview ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Time</span>
                  <span className="text-sm font-medium tabular-nums">{(retainerPreview.totalMinutes / 60).toFixed(1)}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Retainer Fee</span>
                  <span className="text-sm font-medium tabular-nums">{formatCurrency(retainerPreview.retainerFee, currency)}</span>
                </div>
                {retainerPreview.overageAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Overage</span>
                    <span className="text-sm font-medium tabular-nums">{formatCurrency(retainerPreview.overageAmount, currency)}</span>
                  </div>
                )}
                <hr className="border-border" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(retainerPreview.total, currency)}</span>
                </div>
              </div>
            ) : null
          ) : (
            previewLoading ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Time</span>
                  <Skeleton className="h-5 w-16" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{isFixed ? "Billing Amount" : "Total Billed"}</span>
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Time</span>
                  <span className="text-sm font-medium tabular-nums">
                    {((preview?.totalMinutes ?? 0) / 60).toFixed(1)}h
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{isFixed ? "Billing Amount" : "Total Billed"}</span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(isFixed ? (preview?.billingAmount ?? 0) : (preview?.totalAmount ?? 0), currency)}
                  </span>
                </div>
                {!hasEntries && !isFixed && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No billable time found for this period.
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </FormModalBody>

      <FormModalFooter>
        <Button
          onClick={handleCreate}
          disabled={!canCreate || isCreating}
          size="lg"
          className="h-11 w-full text-base"
        >
          {isCreating && <LoaderIcon data-icon="inline-start" className="animate-spin" />}
          {isCreating ? "Creating..." : "Create Invoice"}
        </Button>
        <DialogClose asChild>
          <button
            type="button"
            disabled={isCreating}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
        </DialogClose>
      </FormModalFooter>
    </FormModal>
  )
}

function SelectionSummary({
  count,
  skippedCount,
  totalMinutes,
  totalAmount,
  currency,
  loading,
}: {
  count: number
  skippedCount: number
  totalMinutes: number | undefined
  totalAmount: number | undefined
  currency: string
  loading: boolean
}) {
  const originalTotal = count + skippedCount
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Entries selected</span>
        <span className="text-sm font-medium tabular-nums">
          {skippedCount > 0 ? `${count} of ${originalTotal}` : count}
        </span>
      </div>
      {skippedCount > 0 && (
        <p className="-mt-1 text-xs text-muted-foreground">
          {skippedCount} {skippedCount === 1 ? "entry" : "entries"} skipped —
          non-billable or already invoiced.
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Total time</span>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {((totalMinutes ?? 0) / 60).toFixed(1)}h
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Total billed</span>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {formatCurrency(totalAmount ?? 0, currency)}
          </span>
        )}
      </div>
    </div>
  )
}
