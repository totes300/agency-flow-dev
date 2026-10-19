import { redirect } from "next/navigation"

/**
 * The Billing hub moved to /billing (PRD slice 08 — Invoices → Billing rename).
 * Invoice *document* URLs stay at /invoices/[id]; only the list hub relocated.
 * This bare-list route permanently redirects to preserve any old links.
 */
export default function InvoicesListRedirect() {
  redirect("/billing")
}
