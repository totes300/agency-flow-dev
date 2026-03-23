"use client"

import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
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
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import { CURRENCIES } from "@/convex/lib/constants"
import type { Currency } from "@/convex/lib/constants"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"

type ProjectData = {
  name: string
  code: string
  currency: string
  billingType: BillingType
  fixedPrice?: number
}

export function SettingsGeneral({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: ProjectData
}) {
  const updateProject = useMutation(api.projects.update)
  const [name, setName] = useState(project.name)
  const [code, setCode] = useState(project.code)
  const [currency, setCurrency] = useState(project.currency)
  const [fixedPrice, setFixedPrice] = useState(project.fixedPrice?.toString() ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(project.name)
    setCode(project.code)
    setCurrency(project.currency)
    setFixedPrice(project.fixedPrice?.toString() ?? "")
  }, [project.name, project.code, project.currency, project.fixedPrice])

  async function handleSave() {
    setSaving(true)
    try {
      await updateProject({
        id: projectId,
        name: name.trim(),
        code: code.trim(),
        currency: currency as Currency,
        ...(project.billingType === "fixed" && fixedPrice
          ? { fixedPrice: parseFloat(fixedPrice) }
          : {}),
      })
      toast.success("Project updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-name">Project name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-code">Project code</Label>
            <Input id="s-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-currency">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="s-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {project.billingType === "fixed" && (
            <div className="space-y-1.5">
              <Label htmlFor="s-fixed-price">Fixed Fee</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="s-fixed-price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder="10000"
                  className="w-40"
                />
                <span className="text-sm text-muted-foreground">{currency}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The sold project price. Used to calculate profit and effective rate.
              </p>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Billing type:</span>
          <BillingTypeBadge type={project.billingType} />
          <span className="text-xs text-muted-foreground">(set at creation)</span>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSave} disabled={saving || !name.trim() || !code.trim()} size="sm">
          {saving ? <><Loader2Icon className="size-3.5 animate-spin" /> Saving...</> : "Save"}
        </Button>
      </CardFooter>
    </Card>
  )
}
