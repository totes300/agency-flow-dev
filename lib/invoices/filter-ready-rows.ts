// Client-side filtering for the Ready feed.
//
// Ready rows aren't invoices — they're pre-issuance projections — so the
// `listAllInvoices` Convex args (issueDateFrom, dueDateTo, …) don't apply.
// We still want the same filter pills to work on the Ready tab where they
// do make sense (client, project, search). Date pills are intentionally
// ignored: a Ready row has no issueDate/dueDate, so applying them would
// silently empty the list whenever a user navigates from a date-filtered
// Outstanding tab to Ready.

import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { FilterOperator, type Filter } from "@/lib/filter-types"

type ReadyRow = FunctionReturnType<typeof api.invoices.getReadyToInvoiceUnified>[number]

function isExcludeOp(op: FilterOperator): boolean {
  return (
    op === FilterOperator.IS_NOT ||
    op === FilterOperator.DO_NOT_INCLUDE ||
    op === FilterOperator.EXCLUDE_ALL_OF ||
    op === FilterOperator.EXCLUDE_IF_ANY_OF
  )
}

export function filterReadyRows(
  rows: ReadyRow[],
  filters: Filter[],
  search: string | undefined,
): ReadyRow[] {
  const clientFilter = filters.find((f) => f.type === "client")
  const projectFilter = filters.find((f) => f.type === "project")
  const term = search?.trim().toLowerCase()

  if (!clientFilter && !projectFilter && !term) return rows

  // Pre-build the lookup sets once per filter (not per row). Predicates and
  // their negations are also captured here so the hot loop just reads a
  // boolean per check.
  const clientSet =
    clientFilter && clientFilter.value.length > 0
      ? new Set(clientFilter.value)
      : null
  const clientExclude = clientFilter ? isExcludeOp(clientFilter.operator) : false
  const projectSet =
    projectFilter && projectFilter.value.length > 0
      ? new Set(projectFilter.value)
      : null
  const projectExclude = projectFilter
    ? isExcludeOp(projectFilter.operator)
    : false

  return rows.filter((row) => {
    if (clientSet) {
      const match = clientSet.has(row.clientId)
      if (clientExclude ? match : !match) return false
    }
    if (projectSet) {
      const match = projectSet.has(row.projectId)
      if (projectExclude ? match : !match) return false
    }
    // Search box says "invoice number or subject" but ready rows have
    // neither — fall back to project + client name so the input is still
    // useful while on this tab.
    if (term) {
      const haystack = `${row.projectName} ${row.clientName}`.toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
}
