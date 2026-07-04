"use client"

import Link from "next/link"

type PartyInfo = {
  name?: string
  address?: string
  taxId?: string
  email?: string
  phone?: string
  // Client-specific structured address
  street?: string
  street2?: string
  city?: string
  zip?: string
  country?: string
}

function AddressLine({ value, placeholder }: { value?: string; placeholder: string }) {
  if (value) return <p className="text-sm">{value}</p>
  return <p className="text-sm text-muted-foreground/50">{placeholder}</p>
}

function PartyBlock({ label, info }: { label: string; info: PartyInfo }) {
  const hasAddress = info.address || info.street || info.city || info.zip || info.country
  const addressDisplay = info.street
    ? [info.street, info.street2, [info.city, info.zip].filter(Boolean).join(" "), info.country]
        .filter(Boolean)
        .join(", ")
    : info.address

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <AddressLine value={info.name} placeholder="No name set" />
      <AddressLine value={hasAddress ? addressDisplay : undefined} placeholder="No address set" />
      {info.taxId && <p className="text-sm text-muted-foreground">{info.taxId}</p>}
      {info.email && <p className="text-sm text-muted-foreground">{info.email}</p>}
      {info.phone && <p className="text-sm text-muted-foreground">{info.phone}</p>}
    </div>
  )
}

/**
 * From / To block at the top of invoice and monthly report documents.
 * Brand info on the left, client billing info on the right.
 */
export function DocumentParties({
  brand,
  client,
}: {
  brand: { brandName?: string; brandAddress?: string; brandTaxId?: string; brandEmail?: string; brandPhone?: string } | null
  client: { name: string; billingName?: string; billingEmail?: string; billingStreet?: string; billingStreet2?: string; billingCity?: string; billingZip?: string; billingCountry?: string; taxId?: string } | null
}) {
  return (
    <div className="grid grid-cols-2 gap-8">
      <div className="flex flex-col gap-1.5">
        <PartyBlock
          label="From"
          info={{
            name: brand?.brandName,
            address: brand?.brandAddress,
            taxId: brand?.brandTaxId,
            email: brand?.brandEmail,
            phone: brand?.brandPhone,
          }}
        />
        {/* Fix-path for the "No name set" placeholder: without a seller
            name the invoice can't be marked as invoiced (server gate), so
            the document points straight at the form that unblocks it.
            Hidden in print — it's chrome, not document content. */}
        {!brand?.brandName && (
          <Link
            href="/settings"
            className="text-sm font-medium text-primary hover:underline print:hidden"
          >
            Add your company details →
          </Link>
        )}
      </div>
      <PartyBlock
        label="To"
        info={{
          name: client?.billingName ?? client?.name,
          street: client?.billingStreet,
          street2: client?.billingStreet2,
          city: client?.billingCity,
          zip: client?.billingZip,
          country: client?.billingCountry,
          taxId: client?.taxId,
          email: client?.billingEmail,
        }}
      />
    </div>
  )
}
