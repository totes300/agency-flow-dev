import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { formatBillingAddress, type BillingAddress } from "@/lib/format-address"

type ClientBilling = BillingAddress & {
  billingName?: string
  taxId?: string
  billingEmail?: string
}

function BillingRow({
  label,
  value,
  multiline,
}: {
  label: string
  value?: string
  multiline?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-[13px]",
          multiline && "whitespace-pre-line",
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** The client detail page's Billing section. */
export function ClientBillingDetails({ client }: { client: ClientBilling }) {
  const hasBilling =
    client.billingName ||
    client.taxId ||
    client.billingEmail ||
    client.billingStreet ||
    client.billingCity ||
    client.billingCountry
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium">Billing</h2>
      {hasBilling ? (
        <div className="flex flex-col gap-2.5">
          <BillingRow label="Company" value={client.billingName} />
          {client.billingName && <Separator />}
          <BillingRow label="Tax ID" value={client.taxId} />
          {client.taxId && <Separator />}
          <BillingRow label="Email" value={client.billingEmail} />
          {client.billingEmail && <Separator />}
          <BillingRow
            label="Address"
            value={formatBillingAddress(client)}
            multiline
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No billing details yet. Click Edit to add them.
        </p>
      )}
    </div>
  )
}
