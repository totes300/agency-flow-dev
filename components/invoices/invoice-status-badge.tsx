import {
  ColoredPillBadge,
  type ColoredPillTone,
} from "@/components/ui/colored-pill-badge"

type InvoiceStatus = "draft" | "invoiced" | "paid"

/**
 * Visual state derived from `status` + `dueDate`. Overdue is a *displayed*
 * state — on the server the invoice is still `invoiced`. Kept local because
 * it's only meaningful for this badge.
 */
type InvoiceVisualState = InvoiceStatus | "overdue"

const statusConfig: Record<
  InvoiceVisualState,
  { label: string; tone: ColoredPillTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  invoiced: { label: "Invoiced", tone: "blue" },
  overdue: { label: "Overdue", tone: "red" },
  paid: { label: "Paid", tone: "green" },
}

function isOverdue(
  status: InvoiceStatus,
  dueDate: string | undefined,
  timezone: string,
): boolean {
  if (status !== "invoiced" || !dueDate) return false
  // Compare in org timezone — format today as YYYY-MM-DD in the given timezone.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone })
  return dueDate < today
}

export function InvoiceStatusBadge({
  status,
  dueDate,
  timezone = "UTC",
  className,
}: {
  status: InvoiceStatus
  dueDate?: string
  timezone?: string
  className?: string
}) {
  const visualState: InvoiceVisualState = isOverdue(status, dueDate, timezone)
    ? "overdue"
    : status
  const { label, tone } = statusConfig[visualState]

  return (
    <ColoredPillBadge
      data-slot="invoice-status-badge"
      tone={tone}
      showDot
      label={label}
      className={className}
    />
  )
}
