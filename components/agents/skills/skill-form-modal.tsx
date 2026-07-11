"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { Loader2Icon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormModal,
  FormModalDescription,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
} from "@/components/ui/form-modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { extractErrorMessage } from "@/lib/toast-helpers"

export type SkillDraft = {
  _id: Id<"skills">
  name: string
  instruction: string
  scope: "global" | "client"
  clientId: Id<"clients"> | null
  isStopCondition: boolean
}

type SkillFormModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit; absent → create. */
  skill?: SkillDraft | null
  clients: { _id: Id<"clients">; name: string }[]
}

/**
 * Create/edit a skill (admin-only). The body is keyed + only mounted while
 * open, so its fields initialize from props via `useState` — no effect-driven
 * state sync (repo convention: compute/reset, never sync in an effect).
 */
export function SkillFormModal({
  open,
  onOpenChange,
  skill,
  clients,
}: SkillFormModalProps) {
  return (
    <FormModal open={open} onOpenChange={onOpenChange} size="lg">
      {open && (
        <SkillFormBody
          key={skill?._id ?? "new"}
          skill={skill ?? null}
          clients={clients}
          onDone={() => onOpenChange(false)}
        />
      )}
    </FormModal>
  )
}

function SkillFormBody({
  skill,
  clients,
  onDone,
}: {
  skill: SkillDraft | null
  clients: { _id: Id<"clients">; name: string }[]
  onDone: () => void
}) {
  const createSkill = useMutation(api.skills.create)
  const updateSkill = useMutation(api.skills.update)
  const isEdit = Boolean(skill)

  const [name, setName] = useState(skill?.name ?? "")
  const [instruction, setInstruction] = useState(skill?.instruction ?? "")
  const [scope, setScope] = useState<"global" | "client">(skill?.scope ?? "global")
  const [clientId, setClientId] = useState<Id<"clients"> | "">(
    skill?.clientId ?? "",
  )
  const [isStopCondition, setIsStopCondition] = useState(
    skill?.isStopCondition ?? false,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  function submit() {
    if (submitting) return
    const trimmedName = name.trim()
    const trimmedInstruction = instruction.trim()
    if (!trimmedName) return setError("Name is required.")
    if (!trimmedInstruction) return setError("Instruction is required.")
    if (scope === "client" && !clientId) {
      return setError("Pick a client for a client-scoped skill.")
    }
    setSubmitting(true)
    setError("")

    const payload = {
      name: trimmedName,
      instruction: trimmedInstruction,
      scope,
      clientId: scope === "client" ? (clientId as Id<"clients">) : undefined,
      isStopCondition,
    }
    const promise = skill
      ? updateSkill({ skillId: skill._id, ...payload })
      : createSkill(payload)
    void promise
      .then(onDone)
      .catch((err) => setError(extractErrorMessage(err, "Couldn't save the skill.")))
      .finally(() => setSubmitting(false))
  }

  return (
    <>
      <FormModalHeader align="start">
        <FormModalTitle>{isEdit ? "Edit skill" : "New skill"}</FormModalTitle>
        <FormModalDescription>
          A plain-English procedure that steers the agent&apos;s judgment — it
          never changes how a number or total is computed.
        </FormModalDescription>
      </FormModalHeader>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. timesheet-format"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-instruction">Instruction</Label>
          <Textarea
            id="skill-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Write the SOP in plain English…"
            rows={5}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as "global" | "client")}
            >
              <SelectTrigger id="skill-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (all runs)</SelectItem>
                <SelectItem value="client">Client-specific</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === "client" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-client">Client</Label>
              <Select
                value={clientId}
                onValueChange={(v) => setClientId(v as Id<"clients">)}
              >
                <SelectTrigger id="skill-client">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox
            checked={isStopCondition}
            onCheckedChange={(v) => setIsStopCondition(v === true)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Stop-condition</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When this situation occurs, the run halts instead of producing
              output — the agent flags it rather than inventing an answer.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <FormModalFooter align="row">
        <Button variant="ghost" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2Icon className="size-4 animate-spin" />}
          {isEdit ? "Save changes" : "Create skill"}
        </Button>
      </FormModalFooter>
    </>
  )
}
