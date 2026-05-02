/**
 * Read-only "Payment instructions" block on the invoice document.
 *
 * Sourced from `orgSettings.paymentInstructions` (delivered through the
 * `getInvoice` query, no separate round-trip). Rendered on every doc state —
 * draft, invoiced, paid, void. Renders nothing when the org hasn't set it,
 * so an empty value collapses to no border / no padding.
 *
 * Plain text with preserved newlines (`whitespace-pre-line`); no Markdown by
 * design (PRD note — defer until needed to avoid the dependency).
 */
export function PaymentInstructionsBlock({
  paymentInstructions,
}: {
  paymentInstructions: string | undefined
}) {
  if (!paymentInstructions) return null

  return (
    <section
      aria-label="Payment instructions"
      className="border-t border-border pt-4 text-xs text-muted-foreground"
    >
      <h3 className="mb-1 uppercase tracking-wider text-muted-foreground/70">
        Payment instructions
      </h3>
      <p className="whitespace-pre-line leading-relaxed">{paymentInstructions}</p>
    </section>
  )
}
