"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ClientFormModal } from "@/components/clients/client-form-modal"
import { ClientDetailHeader } from "@/components/clients/client-detail-header"
import { ClientDetailSkeleton } from "@/components/clients/client-detail-skeleton"
import { ClientProjectsSection } from "@/components/clients/client-projects-section"
import { ClientBillingDetails } from "@/components/clients/client-billing-details"
import { ContactList } from "@/components/clients/contact-list"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"
import type { Id } from "@/convex/_generated/dataModel"

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as Id<"clients">

  const client = useQuery(api.clients.get, { id: clientId })
  const projects = useQuery(api.projects.list, {
    clientId,
    includeArchived: false,
  })
  const contacts = useQuery(api.clientContacts.list, { clientId })

  const [editOpen, setEditOpen] = useState(false)

  useBreadcrumbTitle(client?.name ?? null)

  if (client === undefined || contacts === undefined)
    return <ClientDetailSkeleton />
  if (client === null) {
    router.replace("/clients")
    return null
  }

  return (
    <div
      data-full-bleed
      className="flex min-w-0 flex-col border-t border-border/60"
    >
      <ClientDetailHeader client={client} onEdit={() => setEditOpen(true)} />

      {/* ── Two-column content ──────────────────────── */}
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left column — Projects, Notes */}
        <div className="flex min-w-0 flex-col gap-8 p-4 md:p-6">
          <ClientProjectsSection projects={projects} />

          {client.notes ? (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-sm font-medium">Notes</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {client.notes}
              </p>
            </section>
          ) : null}
        </div>

        {/* Right column — Billing, Contacts */}
        <div className="flex min-w-0 flex-col gap-6 border-t border-border/60 p-4 md:p-6 lg:border-t-0 lg:border-l">
          <ClientBillingDetails client={client} />

          <div className="border-t border-border/60 pt-5">
            <ContactList clientId={clientId} contacts={contacts} />
          </div>
        </div>
      </div>

      <ClientFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
      />
    </div>
  )
}
