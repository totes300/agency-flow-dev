"use client"

import { useCallback, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction, useMutation } from "convex/react"
import { toast } from "sonner"
import {
  ArchiveRestoreIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { PeriodInvoice, PeriodRow } from "@/convex/lib/billing/projectPeriods"
import type { PrimaryAction, UndoAction } from "@/convex/lib/billing/periodState"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { WorksheetMenuItem } from "@/components/worksheet/worksheet-menu-item"
import { downloadCsv } from "@/lib/download"
import { runExportWithToast } from "@/lib/worksheet-toast"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/**
 * The period actions of docs/prd-project-billing-redesign.md §5.3 / §5.4 —
 * one implementation for the period card, the project Billing tab and the
 * Billing hub. Every action and undo item comes from the server row
 * (`periodState.ts`); this file only maps each kind to its one route or
 * mutation. Nothing here commits a close: Review & … opens the Close
 * workspace (D8, B1).
 */

/** Where a period's links point. `from` is the path the invoice page's Back returns to (A9). */
export type PeriodLinkContext = { projectId: Id<"projects">; from: string }

export function closeWorkspaceHref(projectId: Id<"projects">, periodKey: string): string {
  return `/billing/close/${projectId}/${periodKey}`
}

export function invoiceHref(invoiceId: Id<"invoices">, from: string): string {
  return `/invoices/${invoiceId}?from=${encodeURIComponent(from)}`
}

export function setRateHref(projectId: Id<"projects">): string {
  return `/projects/${projectId}?tab=settings&section=retainer`
}

/** A monthly report path; a cycle reports on its latest started month. */
export function monthlyReportHref(projectId: Id<"projects">, row: Pick<PeriodRow, "end">, todayStr: string): string {
  const month = (row.end < todayStr ? row.end : todayStr).slice(0, 7)
  return `/projects/${projectId}/reports/${month}`
}

type Target = { row: PeriodRow | null; invoice: PeriodInvoice | null; projectId: Id<"projects">; periodKey?: string }

/**
 * Runs a period's primary action and undo items, and renders the confirm
 * dialogs they need (`dialogs`). Void always confirms (B8); deleting a draft
 * confirms too because it cannot be undone.
 */
export function usePeriodActions(from: string) {
  const router = useRouter()
  const changeStatus = useMutation(api.invoices.changeInvoiceStatus)
  const deleteInvoice = useMutation(api.invoices.deleteInvoice)
  const reopenClose = useMutation(api.billingCloses.reopenClose)
  const [pending, setPending] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    label: string
    run: () => Promise<unknown>
  } | null>(null)

  const run = useCallback(async (key: string, fn: () => Promise<unknown>, success: string, failure: string) => {
    setPending(key)
    try {
      await fn()
      toast.success(success)
    } catch (err) {
      toastError(err, failure)
    } finally {
      setPending(null)
    }
  }, [])

  const primary = useCallback(
    (target: Target, action: PrimaryAction) => {
      if (action.blocked) return
      const key = target.row?.key ?? target.periodKey
      switch (action.kind) {
        case "review_invoice":
        case "review_close":
          if (key) router.push(closeWorkspaceHref(target.projectId, key))
          return
        case "set_rate":
          router.push(setRateHref(target.projectId))
          return
        case "open_draft":
          if (target.invoice) router.push(invoiceHref(target.invoice.id, from))
          return
        case "mark_paid": {
          const invoice = target.invoice
          if (!invoice) return
          void run(
            `paid:${invoice.id}`,
            () => changeStatus({ id: invoice.id, newStatus: "paid" }),
            `${invoice.number ?? "Invoice"} marked as paid`,
            "Failed to mark as paid",
          )
        }
      }
    },
    [changeStatus, from, router, run],
  )

  const undo = useCallback(
    (target: Target, item: UndoAction) => {
      if (item.disabledReason) return
      const invoice = target.invoice
      const name = invoice?.number ?? "this draft invoice"
      switch (item.kind) {
        case "reopen_period":
          if (!target.row) return
          return void run(
            `reopen:${target.row.key}`,
            () => reopenClose({ projectId: target.projectId, periodStart: target.row!.start }),
            `${target.row.label} reopened`,
            "Failed to reopen the period",
          )
        case "delete_draft":
          if (!invoice) return
          return setConfirm({
            title: "Delete draft invoice?",
            description: target.row
              ? `The draft is deleted and ${target.row.label} reopens — its time can be billed again.`
              : "The draft is deleted. Its amount can be invoiced again.",
            label: "Delete draft",
            run: () => deleteInvoice({ id: invoice.id }),
          })
        case "void_invoice":
          if (!invoice) return
          return setConfirm({
            title: `Void ${name}?`,
            description: target.row
              ? "The invoice keeps its number and is marked void. The period reopens and its time can be billed again."
              : "The invoice keeps its number and is marked void. Its amount can be invoiced again.",
            label: "Void invoice",
            run: () => changeStatus({ id: invoice.id, newStatus: "void" }),
          })
        case "revert_to_draft":
          if (!invoice) return
          return void run(
            `revert:${invoice.id}`,
            () => changeStatus({ id: invoice.id, newStatus: "draft" }),
            `${name} is a draft again`,
            "Failed to revert to draft",
          )
        case "mark_unpaid":
          if (!invoice) return
          return void run(
            `unpaid:${invoice.id}`,
            () => changeStatus({ id: invoice.id, newStatus: "invoiced" }),
            `${name} marked as unpaid`,
            "Failed to mark as unpaid",
          )
      }
    },
    [changeStatus, deleteInvoice, reopenClose, run],
  )

  const dialogs = (
    <ConfirmDialog
      open={confirm !== null}
      onOpenChange={(open) => {
        if (!open) setConfirm(null)
      }}
      title={confirm?.title ?? ""}
      description={confirm?.description ?? ""}
      confirmLabel={confirm?.label}
      variant="destructive"
      onConfirm={() => {
        const c = confirm
        setConfirm(null)
        if (c) void run(`confirm:${c.label}`, c.run, `${c.label === "Void invoice" ? "Invoice voided" : "Draft deleted"}`, `Failed to ${c.label.toLowerCase()}`)
      }}
    />
  )

  return { primary, undo, pending, dialogs }
}

// ─── Buttons and menus ───────────────────────────────────────────────────────

/**
 * The one action button. A blocked period renders it disabled with the
 * reason on hover (B3); the caller shows the reason line and link.
 */
export function PeriodActionButton({
  action,
  onRun,
  pending = false,
  size = "sm",
  className,
}: {
  action: PrimaryAction
  onRun: () => void
  pending?: boolean
  size?: "sm" | "default"
  className?: string
}) {
  const button = (
    <Button
      type="button"
      size={size}
      variant={action.emphasis === "primary" ? "default" : "outline"}
      disabled={Boolean(action.blocked) || pending}
      // The one filled button per view is the dark primary of the approved mockup.
      className={cn(action.emphasis === "primary" && "bg-foreground text-background hover:bg-foreground/85", className)}
      onClick={(e) => {
        e.stopPropagation()
        onRun()
      }}
    >
      {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
      {action.label}
    </Button>
  )
  if (!action.blocked) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button swallows hover; the wrapper carries the tooltip. */}
        <span className={cn("inline-flex", className?.includes("w-full") && "w-full")} tabIndex={0}>
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{action.blocked.reason}</TooltipContent>
    </Tooltip>
  )
}

const UNDO_ICON: Record<UndoAction["kind"], ReactNode> = {
  reopen_period: <ArchiveRestoreIcon />,
  delete_draft: <XIcon />,
  revert_to_draft: <Undo2Icon />,
  void_invoice: <XIcon />,
  mark_unpaid: <Undo2Icon />,
}

/**
 * The period ⋯ menu (§5.4): View entries · Download worksheet, then the
 * state's undo items.
 */
export function PeriodMenu({
  projectId,
  row,
  undoItems,
  onViewEntries,
  onUndo,
  triggerClassName,
  align = "end",
}: {
  projectId: Id<"projects">
  /** The period; absent for an invoice without one (fixed fee): undo items only. */
  row?: Pick<PeriodRow, "key" | "start" | "end" | "label" | "closeId">
  undoItems: UndoAction[]
  onViewEntries?: () => void
  onUndo: (item: UndoAction) => void
  triggerClassName?: string
  align?: "start" | "end"
}) {
  const exportWorksheet = useWorksheetExport(projectId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={row ? `${row.label} actions` : "Invoice actions"}
          className={triggerClassName}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48" onClick={(e) => e.stopPropagation()}>
        {row ? (
          <>
            <DropdownMenuItem onSelect={onViewEntries}>
              <EyeIcon /> View entries
            </DropdownMenuItem>
            <WorksheetMenuItem
              label="Download worksheet"
              icon={<FileSpreadsheetIcon className="size-3.5" aria-hidden />}
              run={() => exportWorksheet(row)}
            />
          </>
        ) : null}
        {row && undoItems.length > 0 ? <DropdownMenuSeparator /> : null}
        {undoItems.map((item) =>
          item.disabledReason ? (
            <Tooltip key={item.kind}>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem disabled>
                    {UNDO_ICON[item.kind]} {item.label}
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">{item.disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem
              key={item.kind}
              variant={item.kind === "void_invoice" || item.kind === "delete_draft" ? "destructive" : "default"}
              onSelect={() => onUndo(item)}
            >
              {UNDO_ICON[item.kind]} {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** The period's worksheet: the close's snapshot when closed, else its date range (§6.5). */
export function useWorksheetExport(projectId: Id<"projects">) {
  const exportClose = useAction(api.worksheets.exportClose)
  const exportRange = useAction(api.worksheets.exportRange)
  return useCallback(
    (row: Pick<PeriodRow, "key" | "start" | "end" | "label" | "closeId">) =>
      row.closeId
        ? exportClose({ closeId: row.closeId })
        : exportRange({
            projectId,
            periodStart: row.start,
            periodEnd: row.end,
            periodSlug: row.key,
            periodLabel: row.label,
          }),
    [exportClose, exportRange, projectId],
  )
}

/** An icon button that downloads the period's worksheet. */
export function WorksheetIconButton({
  projectId,
  row,
  label = "Download worksheet",
  icon,
}: {
  projectId: Id<"projects">
  row: Pick<PeriodRow, "key" | "start" | "end" | "label" | "closeId">
  label?: string
  icon?: ReactNode
}) {
  const exportWorksheet = useWorksheetExport(projectId)
  const [pending, setPending] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={async (e) => {
        e.stopPropagation()
        setPending(true)
        try {
          await runExportWithToast({ run: () => exportWorksheet(row), onResult: ({ csv, filename }) => downloadCsv(csv, filename) })
        } catch {
          // runExportWithToast surfaced the error.
        } finally {
          setPending(false)
        }
      }}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : (icon ?? <FileSpreadsheetIcon />)}
    </Button>
  )
}

/** An icon link (report, invoice). */
export function DocumentIconLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <Button asChild variant="ghost" size="icon-xs" aria-label={label} title={label}>
      <Link href={href} onClick={(e) => e.stopPropagation()}>
        {icon}
      </Link>
    </Button>
  )
}
