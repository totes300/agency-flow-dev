"use client"

import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Spinner } from "@/components/ui/spinner"

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
        ...(project.billingType === "fixed" && fixedPrice
          ? { fixedPrice: parseFloat(fixedPrice) }
          : {}),
      })
      toast.success("Project updated")
    } catch (err) {
      toastError(err, "Failed to update")
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
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="s-name">Project name</FieldLabel>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field>
            <FieldLabel htmlFor="s-code">Project code</FieldLabel>
            <Input id="s-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" />
          </Field>
          <Field>
            <FieldLabel>Currency</FieldLabel>
            <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
              {currency}
            </div>
            <span className="text-xs text-muted-foreground">Inherited from client</span>
          </Field>
          {project.billingType === "fixed" && (
            <Field>
              <FieldLabel htmlFor="s-fixed-price">Fixed Fee</FieldLabel>
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
              <FieldDescription>
                The sold project price. Used to calculate profit and effective rate.
              </FieldDescription>
            </Field>
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
          {saving ? <><Spinner data-icon="inline-start" /> Saving...</> : "Save"}
        </Button>
      </CardFooter>
    </Card>
  )
}
