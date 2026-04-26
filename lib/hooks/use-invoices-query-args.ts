"use client"

import { useMemo } from "react"
import type { Filter } from "@/components/ui/filters"
import { FilterOperator } from "@/components/ui/filters"
import type { Id } from "@/convex/_generated/dataModel"

export type InvoicesStatus = "draft" | "invoiced" | "paid" | "void"

export type InvoicesQueryArgs = {
  status?: InvoicesStatus
  clientIds?: Id<"clients">[]
  clientIdsOp?: "is" | "isNot"
  projectIds?: Id<"projects">[]
  projectIdsOp?: "is" | "isNot"
  issueDateFrom?: string
  issueDateTo?: string
  dueDateFrom?: string
  dueDateTo?: string
  search?: string
}

function operatorToOp(op: FilterOperator): "is" | "isNot" {
  return op === FilterOperator.IS_NOT ||
    op === FilterOperator.DO_NOT_INCLUDE ||
    op === FilterOperator.EXCLUDE_ALL_OF ||
    op === FilterOperator.EXCLUDE_IF_ANY_OF
    ? "isNot"
    : "is"
}

/**
 * Maps the URL-backed `Filter[]` + status/search into the Convex
 * `listAllInvoices` args shape. Memoized — the returned object is stable
 * across renders as long as inputs are equal, which matters because Convex
 * `useQuery` resubscribes whenever its args reference changes.
 */
export function useInvoicesQueryArgs(options: {
  filters: Filter[]
  status: InvoicesStatus | undefined
  search: string | undefined
}): InvoicesQueryArgs {
  const { filters, status, search } = options
  return useMemo(() => {
    const args: InvoicesQueryArgs = {}
    if (status) args.status = status
    if (search) args.search = search

    for (const f of filters) {
      if (!f.value || f.value.length === 0) continue
      const op = operatorToOp(f.operator)

      switch (f.type) {
        case "client":
          args.clientIds = f.value as Id<"clients">[]
          args.clientIdsOp = op
          break
        case "project":
          args.projectIds = f.value as Id<"projects">[]
          args.projectIdsOp = op
          break
        case "issueDate": {
          const [from, to] = f.value
          if (from) args.issueDateFrom = from
          if (to) args.issueDateTo = to
          break
        }
        case "dueDate": {
          const [from, to] = f.value
          if (from) args.dueDateFrom = from
          if (to) args.dueDateTo = to
          break
        }
      }
    }

    return args
  }, [filters, status, search])
}
