type BillingType = "t_and_m" | "fixed" | "retainer" | "non_billable"

/**
 * Document label for an invoice. A retainer's kind comes from the period its
 * close billed (frozen at commit): one month = monthly, N months = an N-month
 * rollover cycle.
 */
export function getDocumentBillingType({
  billingType,
  periodMonths,
}: {
  billingType: BillingType | string | undefined
  /** Months in the billed period (from the invoice's close); null when unknown. */
  periodMonths?: number | null
}): string {
  switch (billingType) {
    case "retainer":
      return periodMonths != null && periodMonths > 1
        ? `${periodMonths}-month rollover retainer`
        : "Monthly retainer"
    case "fixed":
      return "Fixed price"
    case "t_and_m":
      return "T&M"
    case "non_billable":
      return "Non-billable"
    default:
      return "Invoice"
  }
}
