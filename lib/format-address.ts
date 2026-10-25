/** The billing address fields a client stores. */
export type BillingAddress = {
  billingStreet?: string
  billingStreet2?: string
  billingZip?: string
  billingCity?: string
  billingCountry?: string
}

/**
 * A client's billing address as display lines (street, street 2,
 * "zip city", country) joined by newlines; undefined when nothing is set.
 */
export function formatBillingAddress(address: BillingAddress): string | undefined {
  const lines: string[] = []
  if (address.billingStreet) lines.push(address.billingStreet)
  if (address.billingStreet2) lines.push(address.billingStreet2)
  const cityLine = [address.billingZip, address.billingCity]
    .filter(Boolean)
    .join(" ")
  if (cityLine) lines.push(cityLine)
  if (address.billingCountry) lines.push(address.billingCountry)
  return lines.length > 0 ? lines.join("\n") : undefined
}
