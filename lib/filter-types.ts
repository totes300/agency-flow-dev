/**
 * Filter domain types and operators.
 * Shared between the UI filter components and the task filter hook.
 */

export enum FilterOperator {
  IS = "is",
  IS_NOT = "is not",
  IS_ANY_OF = "is any of",
  INCLUDE = "include",
  DO_NOT_INCLUDE = "do not include",
  INCLUDE_ALL_OF = "include all of",
  INCLUDE_ANY_OF = "include any of",
  EXCLUDE_ALL_OF = "exclude all of",
  EXCLUDE_IF_ANY_OF = "exclude if any of",
}

export type FilterOption = {
  id: string
  name: string
  icon?: React.ReactNode
  label?: string
  group?: string
}

export type FilterTypeConfig = {
  key: string
  label: string
  icon?: React.ReactNode
  options: FilterOption[]
  operators?: (values: string[]) => FilterOperator[]
  popoverWidth?: string
  /** When true, the filter uses a custom date range UI instead of a combobox. */
  isDateRange?: boolean
  /** If true, the filter is hidden from the "add filter" menu for non-admins. */
  adminOnly?: boolean
}

export type Filter = {
  id: string
  type: string
  operator: FilterOperator
  value: string[]
}
