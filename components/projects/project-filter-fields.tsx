import { BillableNavIcon, ClientsNavIcon } from "@/components/icons/nav-icons"
import type { FacetFilterField } from "@/components/filters/facet-filter"
import type { BillingType } from "@/components/billing-type-badge"

export type ProjectFilterKey = "client" | "billingType"

type ProjectFacetItem = {
  clientId: string
  clientName: string
  billingType: BillingType
}

const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  fixed: "Fixed",
  t_and_m: "Time & materials",
  retainer: "Retainer",
  non_billable: "Non-billable",
}

const BILLING_TYPE_ORDER: readonly BillingType[] = [
  "fixed",
  "t_and_m",
  "retainer",
  "non_billable",
]

/**
 * The projects directory's "+ Filter" properties. Values come from the loaded
 * projects, so in "All projects" the client facet includes the clients of
 * archived projects too.
 */
export const PROJECT_FILTER_FIELDS: readonly FacetFilterField<
  ProjectFacetItem,
  ProjectFilterKey
>[] = [
  {
    key: "client",
    label: "Client",
    icon: <ClientsNavIcon className="text-muted-foreground" />,
    valueOf: (project) => project.clientId,
    labelOf: (project) => project.clientName,
  },
  {
    key: "billingType",
    label: "Billing type",
    icon: <BillableNavIcon className="text-muted-foreground" />,
    valueOf: (project) => project.billingType,
    labelOf: (project) => BILLING_TYPE_LABELS[project.billingType],
    order: BILLING_TYPE_ORDER,
  },
]
