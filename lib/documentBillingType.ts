type BillingType = "t_and_m" | "fixed" | "retainer" | "non_billable"

export function getDocumentBillingType({
  billingType,
  retainerRolloverEnabled,
  retainerCycleLength,
}: {
  billingType: BillingType | string | undefined
  retainerRolloverEnabled?: boolean | null
  retainerCycleLength?: number | null
}): string {
  switch (billingType) {
    case "retainer": {
      const rolloverEnabled = retainerRolloverEnabled ?? true
      if (!rolloverEnabled) {
        return "Monthly retainer"
      }

      return `${retainerCycleLength ?? 3}-month rollover retainer`
    }
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
