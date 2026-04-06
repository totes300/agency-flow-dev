"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "@/convex/_generated/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CURRENCIES } from "@/convex/lib/constants"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDateToYMD } from "@/lib/format"
import { extractErrorMessage } from "@/lib/toast-helpers"
import { ProjectFormStepBasic, NEW_CLIENT_VALUE, type BillingType } from "./project-form-step-basic"
import { ProjectFormStepBilling, type TmRateMode, type CategoryRate } from "./project-form-step-billing"

type ProjectFormModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectFormModal({ open, onOpenChange }: ProjectFormModalProps) {
  const createProject = useMutation(api.projects.create)
  const createClient = useMutation(api.clients.create)
  const removeClient = useMutation(api.clients.remove)
  const nextCode = useQuery(api.projects.nextCode, open ? {} : "skip")
  const orgSettings = useQuery(api.orgSettings.get, open ? {} : "skip")
  const clients = useQuery(api.clients.list, open ? { includeArchived: false } : "skip")
  const router = useRouter()

  // Wizard step
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 state
  const [clientId, setClientId] = useState("")
  const [newClientName, setNewClientName] = useState("")
  const [newClientContactName, setNewClientContactName] = useState("")
  const [newClientEmail, setNewClientEmail] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [billingType, setBillingType] = useState<BillingType>("fixed")
  const [currency, setCurrency] = useState("USD")
  const [teamMembers, setTeamMembers] = useState<Id<"users">[]>([])

  // Step 2 — Fixed
  const [fixedPrice, setFixedPrice] = useState("")
  // Step 2 — T&M
  const [tmRateMode, setTmRateMode] = useState<TmRateMode>("flat")
  const [hourlyRate, setHourlyRate] = useState("")
  const [categoryRates, setCategoryRates] = useState<CategoryRate[]>([])
  // Step 2 — Retainer
  const [monthlyHours, setMonthlyHours] = useState("")
  const [overageRate, setOverageRate] = useState("")
  const [retainerStartDate, setRetainerStartDate] = useState<Date | undefined>(undefined)
  const [cycleLength, setCycleLength] = useState("1")
  const [rolloverEnabled, setRolloverEnabled] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setStep(1)
      setClientId("")
      setNewClientName("")
      setNewClientContactName("")
      setNewClientEmail("")
      setName("")
      setCode("")
      setCodePreFilled(false)
      setBillingType("fixed")
      setCurrency("USD")
      setTeamMembers([])
      setFixedPrice("")
      setTmRateMode("flat")
      setHourlyRate(orgSettings?.defaultTmFlatRate?.toString() ?? "")
      setCategoryRates([])
      setMonthlyHours("")
      setOverageRate("")
      const now = new Date()
      setRetainerStartDate(new Date(now.getFullYear(), now.getMonth(), 1))
      setCycleLength("1")
      setRolloverEnabled(false)
      setError("")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset only on open, orgSettings read is snapshot
  }, [open])

  // Pre-fill hourly rate when orgSettings loads
  useEffect(() => {
    if (open && orgSettings?.defaultTmFlatRate != null && !hourlyRate) {
      setHourlyRate(orgSettings.defaultTmFlatRate.toString())
    }
  }, [open, orgSettings?.defaultTmFlatRate, hourlyRate])

  // Pre-fill code only once when nextCode first loads (not after user clears it)
  const [codePreFilled, setCodePreFilled] = useState(false)
  useEffect(() => {
    if (nextCode && !codePreFilled) {
      setCode(nextCode)
      setCodePreFilled(true)
    }
  }, [nextCode, codePreFilled])

  // Auto-fill currency from selected client
  useEffect(() => {
    if (clientId && clientId !== NEW_CLIENT_VALUE && clients) {
      const client = clients.find((c) => c._id === clientId)
      if (client) setCurrency(client.currency)
    }
  }, [clientId, clients])

  // Reset billing-specific state when billing type changes
  function handleBillingTypeChange(newType: BillingType) {
    setBillingType(newType)
    setFixedPrice("")
    setTmRateMode("flat")
    setHourlyRate(orgSettings?.defaultTmFlatRate?.toString() ?? "")
    setCategoryRates([])
    setMonthlyHours("")
    setOverageRate("")
    const now = new Date()
    setRetainerStartDate(new Date(now.getFullYear(), now.getMonth(), 1))
    setCycleLength("1")
    setRolloverEnabled(false)
    setError("")
  }

  async function handleSubmit() {
    const isNewClient = clientId === NEW_CLIENT_VALUE
    if ((!clientId || (isNewClient && !newClientName.trim())) || !name.trim()) return

    setSubmitting(true)
    setError("")

    try {
      // Create client first if new
      let resolvedClientId: Id<"clients">
      let createdNewClient = false
      if (isNewClient) {
        resolvedClientId = await createClient({
          name: newClientName.trim(),
          currency: currency as typeof CURRENCIES[number],
          ...(newClientContactName.trim() ? { billingName: newClientContactName.trim() } : {}),
          ...(newClientEmail.trim() ? { billingEmail: newClientEmail.trim() } : {}),
        })
        createdNewClient = true
      } else {
        resolvedClientId = clientId as Id<"clients">
      }

      let newId: Id<"projects">
      try {
        newId = await createProject({
          clientId: resolvedClientId,
        name: name.trim(),
        billingType,
        currency: currency as typeof CURRENCIES[number],
        code: code.trim() || undefined,
        teamMembers: teamMembers.length > 0 ? teamMembers : undefined,
        ...(billingType === "fixed" ? {
          fixedPrice: parseFloat(fixedPrice) || 0,
        } : {}),
        ...(billingType === "t_and_m" ? {
          tmRateMode,
          ...(tmRateMode === "flat" ? {
            hourlyRate: parseFloat(hourlyRate) || 0,
          } : {
            tmCategoryRates: categoryRates
              .filter((cr) => cr.workCategoryId && cr.rate)
              .map((cr) => ({
                workCategoryId: cr.workCategoryId as Id<"workCategories">,
                rate: parseFloat(cr.rate) || 0,
              })),
          }),
        } : {}),
        ...(billingType === "retainer" ? {
          includedMinutesPerMonth: Math.round((parseFloat(monthlyHours) || 0) * 60),
          overageRate: parseFloat(overageRate) || 0,
          startDate: retainerStartDate ? formatDateToYMD(retainerStartDate) : "",
          cycleLength: parseInt(cycleLength) || 1,
          rolloverEnabled,
        } : {}),
      })
      } catch (projectErr) {
        // Rollback: delete orphan client if we just created it
        if (createdNewClient) {
          void removeClient({ id: resolvedClientId }).catch(() => {})
        }
        throw projectErr
      }
      onOpenChange(false)
      router.push(`/projects/${newId}`)
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
    } finally {
      setSubmitting(false)
    }
  }

  function handleContinue() {
    setError("")
    setStep(2)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="max-h-[85vh] gap-0 p-0 sm:max-w-xl">
        {step === 1 && (
          <div className="max-h-[85vh] overflow-y-auto px-8 py-6">
            <DialogHeader className="mb-6">
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>
                Add a new project to start tracking time and budgets.
              </DialogDescription>
            </DialogHeader>
            <ProjectFormStepBasic
              clientId={clientId}
              setClientId={setClientId}
              newClientName={newClientName}
              setNewClientName={setNewClientName}
              newClientContactName={newClientContactName}
              setNewClientContactName={setNewClientContactName}
              newClientEmail={newClientEmail}
              setNewClientEmail={setNewClientEmail}
              name={name}
              setName={setName}
              code={code}
              setCode={setCode}
              billingType={billingType}
              setBillingType={handleBillingTypeChange}
              currency={currency}
              setCurrency={setCurrency}
              teamMembers={teamMembers}
              setTeamMembers={setTeamMembers}
              onContinue={handleContinue}
              onCreateNonBillable={handleSubmit}
              submitting={submitting}
              error={error}
            />
          </div>
        )}

        {step === 2 && billingType !== "non_billable" && (
          <div className="max-h-[85vh] overflow-y-auto px-8 py-6">
            <ProjectFormStepBilling
              billingType={billingType}
              currency={currency}
              fixedPrice={fixedPrice}
              setFixedPrice={setFixedPrice}
              tmRateMode={tmRateMode}
              setTmRateMode={setTmRateMode}
              hourlyRate={hourlyRate}
              setHourlyRate={setHourlyRate}
              categoryRates={categoryRates}
              setCategoryRates={setCategoryRates}
              monthlyHours={monthlyHours}
              setMonthlyHours={setMonthlyHours}
              overageRate={overageRate}
              setOverageRate={setOverageRate}
              retainerStartDate={retainerStartDate}
              setRetainerStartDate={setRetainerStartDate}
              cycleLength={cycleLength}
              setCycleLength={setCycleLength}
              rolloverEnabled={rolloverEnabled}
              setRolloverEnabled={setRolloverEnabled}
              onBack={() => { setError(""); setStep(1) }}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={error}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
