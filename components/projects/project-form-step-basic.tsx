"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { FormModalBody, FormModalFooter } from "@/components/ui/form-modal"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DialogClose } from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"
// CURRENCIES import removed — currency is now derived from client
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"
import { useState } from "react"

export type BillingType = "fixed" | "t_and_m" | "retainer" | "non_billable"

export const NEW_CLIENT_VALUE = "__new__"

type StepBasicProps = {
  clientId: string
  setClientId: (v: string) => void
  newClientName: string
  setNewClientName: (v: string) => void
  newClientContactName: string
  setNewClientContactName: (v: string) => void
  newClientEmail: string
  setNewClientEmail: (v: string) => void
  name: string
  setName: (v: string) => void
  code: string
  setCode: (v: string) => void
  billingType: BillingType
  setBillingType: (v: BillingType) => void
  currency: string
  setCurrency: (v: string) => void
  teamMembers: Id<"users">[]
  setTeamMembers: (v: Id<"users">[]) => void
  onContinue: () => void
  onCreateNonBillable: () => void
  submitting: boolean
  error: string
}

const BILLING_TYPE_OPTIONS: { value: BillingType; label: string }[] = [
  { value: "fixed", label: "Fixed Fee" },
  { value: "t_and_m", label: "Time & Materials" },
  { value: "retainer", label: "Retainer" },
  { value: "non_billable", label: "Non-Billable" },
]

export function ProjectFormStepBasic({
  clientId,
  setClientId,
  newClientName,
  setNewClientName,
  newClientContactName,
  setNewClientContactName,
  newClientEmail,
  setNewClientEmail,
  name,
  setName,
  code,
  setCode,
  billingType,
  setBillingType,
  currency,
  setCurrency,
  teamMembers,
  setTeamMembers,
  onContinue,
  onCreateNonBillable,
  submitting,
  error,
}: StepBasicProps) {
  const clients = useQuery(api.clients.list, { includeArchived: false })
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const [teamPickerOpen, setTeamPickerOpen] = useState(false)

  const isNewClient = clientId === NEW_CLIENT_VALUE
  const hasValidClient = isNewClient ? Boolean(newClientName.trim()) : Boolean(clientId)
  const canProceed = hasValidClient && Boolean(name.trim()) && !submitting
  const displayedCurrency = isNewClient
    ? currency || ""
    : clients?.find((c) => c._id === clientId)?.currency ?? currency ?? ""

  function handleToggleMember(userId: Id<"users">) {
    if (teamMembers.includes(userId)) {
      setTeamMembers(teamMembers.filter((id) => id !== userId))
    } else {
      setTeamMembers([...teamMembers, userId])
    }
  }

  function handleRemoveMember(userId: Id<"users">) {
    setTeamMembers(teamMembers.filter((id) => id !== userId))
  }

  function handleAction() {
    if (billingType === "non_billable") {
      onCreateNonBillable()
    } else {
      onContinue()
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleAction()
      }}
    >
      <FormModalBody>
        {/* Client */}
        <Field>
          <FieldLabel htmlFor="project-client">Client</FieldLabel>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="project-client">
              <SelectValue placeholder="Select a client..." />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NEW_CLIENT_VALUE} className="font-medium">
                  + New Client
                </SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {/* New Client inline fields */}
        {isNewClient && (
          <div className="flex flex-col gap-4 border-l-2 border-primary/30 pl-4">
            <Field>
              <FieldLabel htmlFor="new-client-name">Company Name</FieldLabel>
              <Input
                id="new-client-name"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Company Name"
                maxLength={200}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="new-client-contact">Contact Name</FieldLabel>
                <Input
                  id="new-client-contact"
                  value={newClientContactName}
                  onChange={(e) => setNewClientContactName(e.target.value)}
                  placeholder="Contact Name"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-client-email">Email</FieldLabel>
                <Input
                  id="new-client-email"
                  type="email"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="Email"
                />
              </Field>
            </div>
          </div>
        )}

        {/* Project Title */}
        <Field>
          <FieldLabel htmlFor="project-name">Project Title</FieldLabel>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website Redesign"
            maxLength={100}
            autoFocus
          />
        </Field>

        {/* Project Code */}
        <Field>
          <FieldLabel htmlFor="project-code">Project Code</FieldLabel>
          <Input
            id="project-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PRJ-001"
            className="font-mono"
          />
        </Field>

        {/* Billing Type */}
        <Field>
          <FieldLabel>Billing Type</FieldLabel>
          <ToggleGroup
            type="single"
            value={billingType}
            onValueChange={(v) => { if (v) setBillingType(v as BillingType) }}
            variant="pill"
            spacing={2}
            className="flex-wrap"
            aria-label="Billing Type"
          >
            {BILLING_TYPE_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="px-3.5"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription className="text-xs text-muted-foreground">
            Cannot be changed after creation.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="project-currency">Currency</FieldLabel>
          <Select value={displayedCurrency} disabled>
            <SelectTrigger id="project-currency">
              <SelectValue placeholder="Set by org default" />
            </SelectTrigger>
            <SelectContent>
              {displayedCurrency && (
                <SelectItem value={displayedCurrency}>{displayedCurrency}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs text-muted-foreground">
            Inherited from the client. Cannot be changed.
          </FieldDescription>
        </Field>

        {/* Project Team */}
        <Field>
          <FieldLabel>Project Team</FieldLabel>
          <Popover open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={teamPickerOpen}
                className="h-auto min-h-10 w-full justify-between px-3 font-normal"
              >
                <div className="flex flex-wrap gap-1">
                  {teamMembers.length === 0 && (
                    <span className="text-muted-foreground">Select team members...</span>
                  )}
                  {teamMembers.map((id) => {
                    const member = orgMembers?.find((m) => m._id === id)
                    if (!member) return null
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="gap-1"
                        onPointerDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleRemoveMember(id)
                        }}
                      >
                        {member.name}
                        <XIcon className="size-3 opacity-70" aria-hidden />
                      </Badge>
                    )
                  })}
                </div>
                <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search members..." />
                <CommandList>
                  <CommandEmpty>No members found.</CommandEmpty>
                  <CommandGroup>
                    {orgMembers?.map((member) => (
                      <CommandItem
                        key={member._id}
                        value={member.name}
                        onSelect={() => handleToggleMember(member._id)}
                      >
                        <CheckIcon
                          className={cn(
                            "mr-2 size-4",
                            teamMembers.includes(member._id)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {member.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </FormModalBody>

      <FormModalFooter>
        <Button type="submit" disabled={!canProceed} size="lg" className="h-11 w-full text-base">
          {submitting
            ? "Creating..."
            : billingType === "non_billable"
              ? "Create Project"
              : "Continue"
          }
        </Button>
        <DialogClose asChild>
          <button
            type="button"
            disabled={submitting}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
        </DialogClose>
      </FormModalFooter>
    </form>
  )
}
