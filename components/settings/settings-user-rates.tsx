"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { Currency } from "@/convex/lib/constants"
import { CURRENCIES } from "@/convex/lib/constants"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { PlusIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import { RateBadge, NoRatesPlaceholder } from "@/components/rate-badge"
import { CategoryBadge } from "@/components/category-badge"

// Sentinel for the "no personal default" Select option — Radix Select can't
// use an empty-string item value.
const NO_DEFAULT = "__task_category__"

export function SettingsUserRates() {
  const members = useQuery(api.orgMembers.listOrgMembers, {})
  const userRates = useQuery(api.userRates.list, {})
  const orgSettings = useQuery(api.orgSettings.get, {})
  // includeArchived: a member's default may point at a since-archived
  // category — the row must display it (so the admin can spot and fix the
  // stale default) even though only active categories are offered as options.
  const categories = useQuery(api.workCategories.list, { includeArchived: true })
  const upsertRate = useMutation(api.userRates.upsert)
  const removeRate = useMutation(api.userRates.remove)
  const setDefaultCategory = useMutation(api.orgMembers.setDefaultWorkCategory)

  async function handleSetDefaultCategory(
    memberUserId: Id<"users">,
    value: string,
  ) {
    try {
      await setDefaultCategory({
        memberUserId,
        workCategoryId:
          value === NO_DEFAULT ? undefined : (value as Id<"workCategories">),
      })
    } catch (err) {
      toastError(err, "Failed to set default category")
    }
  }

  const [editingUser, setEditingUser] = useState<{
    userId: Id<"users">
    userName: string
  } | null>(null)
  const [editCurrency, setEditCurrency] = useState<Currency>("USD")
  const [editRate, setEditRate] = useState("")

  const defaultCurrency = (orgSettings?.defaultCurrency ?? "USD") as Currency

  // Group rates by user
  const ratesByUser = new Map<string, NonNullable<typeof userRates>>()
  if (userRates) {
    for (const rate of userRates) {
      const key = rate.userId.toString()
      if (!ratesByUser.has(key)) ratesByUser.set(key, [])
      ratesByUser.get(key)!.push(rate)
    }
  }

  function handleOpenAdd(userId: Id<"users">, userName: string) {
    setEditingUser({ userId, userName })
    setEditCurrency(defaultCurrency)
    setEditRate("")
  }

  async function handleSave() {
    if (!editingUser || !editRate) return
    const rate = parseFloat(editRate)
    if (isNaN(rate) || rate < 0) return

    try {
      await upsertRate({
        userId: editingUser.userId,
        currency: editCurrency,
        costRate: rate,
      })
      setEditingUser(null)
    } catch (err) {
      toastError(err, "Failed to save rate")
    }
  }

  async function handleRemove(rateId: Id<"userRates">) {
    try {
      await removeRate({ id: rateId })
    } catch (err) {
      toastError(err, "Failed to remove rate")
    }
  }

  if (!members || !userRates) return null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">User Cost Rates</h2>
        <p className="text-sm text-muted-foreground">
          Set the internal hourly cost rate per team member per currency.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          New time entries use the member&apos;s default category; if none is
          set, the task&apos;s category. The category decides the billable rate.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Team Member</TableHead>
            <TableHead>Default category</TableHead>
            <TableHead>Cost Rates</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const rates = ratesByUser.get(member._id.toString()) ?? []
            return (
              <TableRow key={member._id} className="group">
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-7">
                      <AvatarImage src={member.imageUrl} />
                      <AvatarFallback className="text-xs">
                        {member.name?.charAt(0) ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{member.name}</span>
                      {member.email && (
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {(() => {
                    // Explicit trigger content: a default pointing at an
                    // archived category has no matching option below, and
                    // Radix would render the trigger empty — resolve the
                    // badge from the full (archived-inclusive) list instead.
                    const current = member.defaultWorkCategoryId
                      ? categories?.find(
                          (c) => c._id === member.defaultWorkCategoryId,
                        )
                      : undefined
                    return (
                      <Select
                        value={member.defaultWorkCategoryId ?? NO_DEFAULT}
                        onValueChange={(v) =>
                          void handleSetDefaultCategory(member._id, v)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-[168px] border-transparent bg-transparent shadow-none hover:bg-muted/60 data-[state=open]:bg-muted/60"
                        >
                          <SelectValue>
                            {current ? (
                              <CategoryBadge
                                name={current.name}
                                color={current.color}
                              />
                            ) : (
                              <span className="text-muted-foreground">
                                Task category
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DEFAULT}>
                            <span className="text-muted-foreground">Task category</span>
                          </SelectItem>
                          {(categories ?? [])
                            .filter((c) => !c.archivedAt)
                            .map((c) => (
                              <SelectItem key={c._id} value={c._id}>
                                <CategoryBadge name={c.name} color={c.color} />
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )
                  })()}
                </TableCell>
                <TableCell>
                  {rates.length === 0 ? (
                    <NoRatesPlaceholder />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {rates.map((rate) => (
                        <RateBadge
                          key={rate._id}
                          amount={rate.costRate}
                          currency={rate.currency}
                          onRemove={() => void handleRemove(rate._id)}
                        />
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={() => handleOpenAdd(member._id, member.name)}
                  >
                    <PlusIcon className="mr-1 size-3" />
                    Add
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Add cost rate for {editingUser?.userName}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Currency</Label>
              <Select value={editCurrency} onValueChange={(v) => setEditCurrency(v as Currency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Rate per hour</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={editRate}
                onChange={(e) => setEditRate(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={!editRate || parseFloat(editRate) < 0}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
