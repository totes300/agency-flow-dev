"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ColorPickerDropdown } from "@/components/color-picker-dropdown"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { CATEGORY_COLOR_NAMES, CURRENCIES } from "@/convex/lib/constants"
import type { CategoryColor, Currency } from "@/convex/lib/constants"
import { CATEGORY_COLOR_LABELS } from "@/lib/display-constants"
import type { Id } from "@/convex/_generated/dataModel"
import {
  PlusIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { CategoryBadge } from "@/components/category-badge"
import { CategoryColorSwatch } from "@/components/category-color-swatch"

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatRate(rate: number | undefined) {
  if (rate === undefined) return "\u2014"
  return rate.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function SettingsWorkCategoriesSkeleton() {
  return (
    <div className="space-y-1">
      <div className="flex items-center border-b py-2 text-xs text-muted-foreground">
        <Skeleton className="ml-10 h-3 w-16 flex-1" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="ml-4 h-3 w-10" />
        <Skeleton className="ml-4 h-3 w-14" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center py-2">
          <Skeleton className="h-6 w-full" />
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function SettingsWorkCategories() {
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const orgSettings = useQuery(api.orgSettings.get)
  const createCategory = useMutation(api.workCategories.create)
  const updateCategory = useMutation(api.workCategories.update)
  const removeCategory = useMutation(api.workCategories.remove)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<Id<"workCategories"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"workCategories">
    name: string
  } | null>(null)

  if (!categories || !orgSettings) return <SettingsWorkCategoriesSkeleton />

  const defaultCurrency = orgSettings.defaultCurrency
  const editingCategory = editingId
    ? categories.find((c) => c._id === editingId)
    : null

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>Name</TableHead>
            <TableHead className="w-20 text-right">Cost</TableHead>
            <TableHead className="w-20 text-right">Bill</TableHead>
            <TableHead className="w-20 text-right">Currency</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category._id} className="group">
              <TableCell className="w-8">
                <GripVerticalIcon className="size-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50" />
              </TableCell>
              <TableCell>
                <CategoryBadge name={category.name} color={category.color} />
              </TableCell>
              <TableCell className="w-20 text-right tabular-nums text-muted-foreground">
                {formatRate(category.defaultCostRate)}
              </TableCell>
              <TableCell className="w-20 text-right tabular-nums text-muted-foreground">
                {formatRate(category.defaultBillRate)}
              </TableCell>
              <TableCell className="w-20 text-right text-muted-foreground">
                {category.currency}
              </TableCell>
              <TableCell className="w-16 text-right">
                <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditingId(category._id)}
                    aria-label="Edit"
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() =>
                      setDeleteTarget({ id: category._id, name: category.name })
                    }
                    aria-label="Delete"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Add row */}
      <Button
        variant="ghost"
        type="button"
        className="flex w-full items-center justify-start gap-2 py-2 pl-10 text-sm text-muted-foreground/50 hover:text-muted-foreground"
        onClick={() => setCreateOpen(true)}
      >
        <PlusIcon className="size-3.5" />
        <span>Add category</span>
      </Button>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete category"
        description={`Are you sure you want to delete \u201c${deleteTarget?.name}\u201d? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            removeCategory({ id: deleteTarget.id })
            setDeleteTarget(null)
          }
        }}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Category</DialogTitle>
            <DialogDescription>Create a new work category.</DialogDescription>
          </DialogHeader>
          <CategoryForm
            defaultCurrency={defaultCurrency}
            submitLabel="Create Category"
            onSubmit={async (values) => {
              await createCategory(values)
              setCreateOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>Modify this work category.</DialogDescription>
          </DialogHeader>
          {editingCategory && (
            <CategoryForm
              key={editingId!}
              initialValues={{
                name: editingCategory.name,
                color: editingCategory.color as CategoryColor,
                defaultCostRate: editingCategory.defaultCostRate,
                defaultBillRate: editingCategory.defaultBillRate,
                currency: editingCategory.currency,
              }}
              defaultCurrency={defaultCurrency}
              submitLabel="Save Changes"
              onSubmit={async (values) => {
                await updateCategory({ id: editingId!, ...values })
                setEditingId(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Category Form ──────────────────────────────────────────────────────────────

function CategoryForm({
  initialValues,
  defaultCurrency,
  onSubmit,
  submitLabel,
}: {
  initialValues?: {
    name: string
    color: CategoryColor
    defaultCostRate?: number
    defaultBillRate?: number
    currency: string
  }
  defaultCurrency: string
  onSubmit: (values: {
    name: string
    color: CategoryColor
    defaultCostRate?: number
    defaultBillRate?: number
    currency: Currency
  }) => Promise<void>
  submitLabel: string
}) {
  const [name, setName] = useState(initialValues?.name ?? "")
  const [color, setColor] = useState<CategoryColor>(
    initialValues?.color ?? "blue",
  )
  const [costRate, setCostRate] = useState(
    initialValues?.defaultCostRate?.toString() ?? "",
  )
  const [billRate, setBillRate] = useState(
    initialValues?.defaultBillRate?.toString() ?? "",
  )
  const [currency, setCurrency] = useState(
    initialValues?.currency ?? defaultCurrency,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  function handleRateChange(setter: (v: string) => void, value: string) {
    if (value && Number(value) < 0) return
    setter(value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError("")
    try {
      await onSubmit({
        name: name.trim(),
        color,
        defaultCostRate: costRate ? Math.max(0, Number(costRate)) : undefined,
        defaultBillRate: billRate ? Math.max(0, Number(billRate)) : undefined,
        currency: currency as Currency,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Design, Development, PM"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <ColorPickerDropdown
          value={color}
          onChange={setColor}
          colors={CATEGORY_COLOR_NAMES}
          renderSwatch={(c) => ({
            swatch: <CategoryColorSwatch color={c} />,
            label: CATEGORY_COLOR_LABELS[c] ?? c,
          })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Default Cost Rate</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={costRate}
            onChange={(e) => handleRateChange(setCostRate, e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label>Default Bill Rate</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={billRate}
            onChange={(e) => handleRateChange(setBillRate, e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Currency</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={!name.trim() || submitting}
        className="w-full"
      >
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  )
}
