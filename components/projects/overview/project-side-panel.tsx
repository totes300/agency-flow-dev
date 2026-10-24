"use client"

import type { ReactNode } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProjectBillingPeriods } from "@/convex/lib/billing/projectPeriods"
import { UserAvatar } from "@/components/user-avatar"
import { SideCard } from "@/components/projects/overview/period-card"
import { formatMinor, formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

type PanelProject = {
  _id: Id<"projects">
  billingType: "fixed" | "retainer" | "t_and_m" | "non_billable"
  clientName: string
  teamMembers?: Id<"users">[]
  retainerStatus?: string
  archivedAt?: number
}

/**
 * The side panel's project cards (docs/prd-project-billing-redesign.md §7.2
 * step 5): Properties, then the billing type's terms. The period card sits
 * above them (rendered by the caller).
 */
export function ProjectPropertiesCards({
  project,
  model,
}: {
  project: PanelProject
  model: ProjectBillingPeriods | null
}) {
  const { isAuthenticated } = useConvexAuth()
  const refs = useQuery(api.workspaceRefs.get, isAuthenticated ? {} : "skip")
  const members = new Map((refs?.members ?? []).map((m) => [m._id, m]))
  const team = (project.teamMembers ?? []).flatMap((id) => members.get(id) ?? [])
  const inactive = project.archivedAt !== undefined || project.retainerStatus === "inactive"

  return (
    <>
      <SideCard className="px-2 pt-2.5 pb-2">
        <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Properties</h4>
        <KV label="Status">
          <span className={cn("size-[7px] rounded-full", inactive ? "bg-muted-foreground/50" : "bg-green-500")} />
          {project.archivedAt !== undefined ? "Archived" : project.retainerStatus === "inactive" ? "Inactive" : "Active"}
        </KV>
        <KV label="Client">{project.clientName}</KV>
        <KV label="Team">
          {team.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="flex -space-x-1">
              {team.map((m) => (
                <UserAvatar key={m._id} name={m.name} imageUrl={m.imageUrl} size="sm" className="size-[18px] ring-2 ring-background" />
              ))}
            </span>
          )}
        </KV>
      </SideCard>
      {model ? <TermsCard project={project} model={model} /> : null}
    </>
  )
}

function TermsCard({ project, model }: { project: PanelProject; model: ProjectBillingPeriods }) {
  const { terms, currency } = model
  const { isAuthenticated } = useConvexAuth()
  // Fixed fee: the estimate comes from the finance card's summary (same query, cached).
  const summary = useQuery(
    api.projects.getSummary,
    isAuthenticated && project.billingType === "fixed" ? { projectId: project._id } : "skip",
  )
  const money = (minor: number | null, suffix = "") => (minor === null ? "Not set" : `${formatMinor(minor, currency)}${suffix}`)

  if (project.billingType === "retainer") {
    return (
      <SideCard className="px-2 pt-2.5 pb-2">
        <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Retainer</h4>
        <KV label="Included">{terms.includedMinutesPerMonth !== null ? `${formatMinutes(terms.includedMinutesPerMonth)} / month` : "Not set"}</KV>
        <KV label="Fee">{money(terms.monthlyFeeMinor, " / month")}</KV>
        <KV label="Overage rate">{money(terms.overageRateMinor, " / h")}</KV>
        <KV label="Rollover">{terms.rolloverEnabled ? `On · ${terms.cycleLength}-month cycle` : "Off"}</KV>
      </SideCard>
    )
  }
  if (project.billingType === "t_and_m") {
    return (
      <SideCard className="px-2 pt-2.5 pb-2">
        <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Rates</h4>
        <KV label="Rate">{rateRangeLabel(terms.rateRangeMinor, currency) ?? "Not set"}</KV>
        <KV label="Rounding">{terms.roundingMinutes > 1 ? `${terms.roundingMinutes} min per line` : "None"}</KV>
      </SideCard>
    )
  }
  if (project.billingType === "fixed") {
    const estimate = summary?.billingType === "fixed" ? summary.timeBreakdown.estimatedBudgetMinutes : null
    return (
      <SideCard className="px-2 pt-2.5 pb-2">
        <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Fixed fee</h4>
        <KV label="Fee">{money(terms.fixedPriceMinor)}</KV>
        <KV label="Estimate">{estimate ? formatMinutes(estimate) : "Not set"}</KV>
      </SideCard>
    )
  }
  return null
}

/** "$95.00 / h" or "$80.00–$120.00 / h" (T&M category rates). */
export function rateRangeLabel(range: { min: number; max: number } | null, currency: string): string | null {
  if (!range) return null
  return range.min === range.max
    ? `${formatMinor(range.min, currency)} / h`
    : `${formatMinor(range.min, currency)}–${formatMinor(range.max, currency)} / h`
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[96px_1fr] items-center rounded-md px-2 text-sm hover:bg-muted/60">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate tabular-nums">{children}</span>
    </div>
  )
}
