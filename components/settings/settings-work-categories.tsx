"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { toast } from "sonner"
import { toastError, extractErrorMessage } from "@/lib/toast-helpers"
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
import { RateBadge, NoRatesPlaceholder } from "@/components/rate-badge"

function SettingsWorkCategoriesSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center border-b py-2 text-xs text-muted-foreground">
        <Skeleton className="ml-10 h-3 w-16 flex-1" />
        <Skeleton className="h-3 w-24" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center py-2">
          <Skeleton className="h-6 w-full" />
        </div>
      ))}
    </div>
  )
}

export function SettingsWorkCategories() {
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const categoryRates = useQuery(api.categoryRates.list, {})
  const orgSettings = useQuery(api.orgSettings.get)
  const createCategory = useMutation(api.workCategories.create)
  const updateCategory = useMutation(api.workCategories.update)
  const removeCategory = useMutation(api.workCategories.remove)
  const upsertCategoryRate = useMutation(api.categoryRates.upsert)
  const removeCategoryRate = useMutation(api.categoryRates.remove)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<Id<"workCategories"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"workCategories">
    name: string
  } | null>(null)

  if (!categories || !orgSettings || !categoryRates) return <SettingsWorkCategoriesSkeleton />

  const defaultCurrency = orgSettings.defaultCurrency as Currency

  // Group categoryRates by workCategoryId
  const ratesByCategoryId = new Map<string, typeof categoryRates>()
  for (const rate of categoryRates) {
    const key = rate.workCategoryId.toString()
    if (!ratesByCategoryId.has(key)) ratesByCategoryId.set(key, [])
    ratesByCategoryId.get(key)!.push(rate)
  }

  const editingCategory = editingId ? categories.find((c) => c._id === editingId) : null

  async function handleRemoveRate(rateId: Id<"categoryRates">) {
    try {
      await removeCategoryRate({ id: rateId })
    } catch (err) {
      toastError(err, "Failed to remove rate")
    }
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>Name</TableHead>
            <TableHead>Default Bill Rates</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => {
            const rates = ratesByCategoryId.get(category._id.toString()) ?? []
            return (
              <TableRow key={category._id} className="group">
                <TableCell className="w-8">
                  <GripVerticalIcon className="size-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50" />
                </TableCell>
                <TableCell>
                  <CategoryBadge name={category.name} color={category.color} />
                </TableCell>
                <TableCell>
                  {rates.length === 0 ? (
                    <NoRatesPlaceholder />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {rates.map((rate) => (
                        <RateBadge
                          key={rate._id}
                          amount={rate.defaultBillRate}
                          currency={rate.currency}
                          onRemove={() => void handleRemoveRate(rate._id)}
                        />
                      ))}
                    </div>
                  )}
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
            )
          })}
        </TableBody>
      </Table>

      <Button
        variant="ghost"
        type="button"
        className="flex w-full items-center justify-start gap-2 py-2 pl-10 text-sm text-muted-foreground/50 hover:text-muted-foreground"
        onClick={() => setCreateOpen(true)}
      >
        <PlusIcon className="size-3.5" />
        <span>Add category</span>
      </Button>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete category"
        description={`Are you sure you want to delete \u201c${deleteTarget?.name}\u201d? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) {
            try {
              await removeCategory({ id: deleteTarget.id })
              setDeleteTarget(null)
            } catch (err) {
              toastError(err, "Failed to delete category")
            }
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
            submitLabel="Create Category"
            onSubmit={async (values) => {
              const catId = await createCategory({
                ...values,
                currency: defaultCurrency,
              })
              // If a bill rate was provided, also create a categoryRate
              if (values.defaultBillRate !== undefined) {
                await upsertCategoryRate({
                  workCategoryId: catId,
                  currency: defaultCurrency,
                  defaultBillRate: values.defaultBillRate,
                })
              }
              setCreateOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => { if (!open) setEditingId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>Modify this work category.</DialogDescription>
          </DialogHeader>
          {editingCategory && (
            <CategoryEditForm
              key={editingId!}
              categoryId={editingId!}
              initialName={editingCategory.name}
              initialColor={editingCategory.color as CategoryColor}
              rates={ratesByCategoryId.get(editingId!.toString()) ?? []}
              defaultCurrency={defaultCurrency}
              onSaveName={async (values) => {
                await updateCategory({ id: editingId!, ...values })
              }}
              onAddRate={async (currency, rate) => {
                await upsertCategoryRate({
                  workCategoryId: editingId!,
                  currency,
                  defaultBillRate: rate,
                })
              }}
              onRemoveRate={async (rateId) => {
                await removeCategoryRate({ id: rateId })
              }}
              onClose={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Create Form (simple — name, color, optional initial rate) ──────────────

function CategoryForm({
  onSubmit,
  submitLabel,
}: {
  onSubmit: (values: {
    name: string
    color: CategoryColor
    defaultBillRate?: number
  }) => Promise<void>
  submitLabel: string
}) {
  const [name, setName] = useState("")
  const [color, setColor] = useState<CategoryColor>("blue")
  const [billRate, setBillRate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return
    const parsed = Number(billRate)
    setSubmitting(true)
    setError("")
    try {
      await onSubmit({
        name: name.trim(),
        color,
        defaultBillRate: billRate && isFinite(parsed) ? Math.max(0, parsed) : undefined,
      })
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design, Development" autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
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
      <div className="flex flex-col gap-1.5">
        <Label>Default Bill Rate (optional)</Label>
        <Input
          type="number" min={0} step="any"
          value={billRate}
          onChange={(e) => setBillRate(e.target.value)}
          placeholder="0.00"
        />
        <p className="text-xs text-muted-foreground">In your workspace default currency. You can add more currencies after creation.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!name.trim() || submitting} className="w-full">
        {submitting ? "Creating..." : submitLabel}
      </Button>
    </form>
  )
}

// ─── Edit Form (name/color + multi-currency rate management) ────────────────

type CatRate = { _id: Id<"categoryRates">; currency: string; defaultBillRate: number }

function CategoryEditForm({
  categoryId,
  initialName,
  initialColor,
  rates,
  defaultCurrency,
  onSaveName,
  onAddRate,
  onRemoveRate,
  onClose,
}: {
  categoryId: Id<"workCategories">
  initialName: string
  initialColor: CategoryColor
  rates: CatRate[]
  defaultCurrency: Currency
  onSaveName: (values: { name: string; color: CategoryColor }) => Promise<void>
  onAddRate: (currency: Currency, rate: number) => Promise<void>
  onRemoveRate: (rateId: Id<"categoryRates">) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Add rate inline state
  const [addingRate, setAddingRate] = useState(false)
  const [newCurrency, setNewCurrency] = useState<Currency>(defaultCurrency)
  const [newRate, setNewRate] = useState("")

  const usedCurrencies = new Set(rates.map((r) => r.currency))
  const hasNameChanged = name.trim() !== initialName || color !== initialColor

  async function handleSaveName() {
    if (!name.trim()) return
    setSaving(true)
    setError("")
    try {
      await onSaveName({ name: name.trim(), color })
      onClose()
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to save"))
      setSaving(false)
    }
  }

  async function handleAddRate() {
    const parsed = parseFloat(newRate)
    if (!newRate || isNaN(parsed) || parsed < 0) return
    try {
      await onAddRate(newCurrency, parsed)
      toast.success(`${newCurrency} rate saved`)
      setAddingRate(false)
      setNewRate("")
    } catch (err) {
      toastError(err, "Failed to add rate")
    }
  }

  async function handleRemoveRate(rateId: Id<"categoryRates">) {
    try {
      await onRemoveRate(rateId)
    } catch (err) {
      toastError(err, "Failed to remove rate")
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Name & Color */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
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
      </div>

      {/* Bill Rates */}
      <div className="flex flex-col gap-3">
        <Label>Default Bill Rates</Label>
        {rates.length === 0 && !addingRate && (
          <p className="text-xs text-muted-foreground">No rates set. Add a rate per currency.</p>
        )}
        {rates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rates.map((rate) => (
              <RateBadge
                key={rate._id}
                amount={rate.defaultBillRate}
                currency={rate.currency}
                onRemove={() => void handleRemoveRate(rate._id)}
              />
            ))}
          </div>
        )}
        {addingRate ? (
          <div className="flex items-end gap-2">
            <div className="w-24">
              <Select value={newCurrency} onValueChange={(v) => setNewCurrency(v as Currency)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.filter((c) => !usedCurrencies.has(c)).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="number" min={0} step="any"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder="0.00"
              className="h-8 w-24 text-xs"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddRate() } }}
            />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void handleAddRate()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAddingRate(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => {
              // Pre-select first unused currency
              const unused = CURRENCIES.find((c) => !usedCurrencies.has(c))
              if (unused) setNewCurrency(unused)
              setAddingRate(true)
            }}
          >
            <PlusIcon className="mr-1 size-3" />
            Add currency rate
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 border-t pt-4">
        {hasNameChanged ? (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSaveName()} disabled={!name.trim() || saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  )
}
