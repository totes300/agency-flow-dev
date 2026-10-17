"use client"

import { useParams, notFound } from "next/navigation"
import { useQuery, useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { CloseWorkspace } from "@/components/billing/close-workspace"
import { CloseWorkspaceSkeleton } from "@/components/billing/close-workspace-skeleton"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"

/**
 * Close workspace route (slice 02; relocated under /billing in slice 08).
 *
 * URL: /billing/close/[projectId]/[period]
 *   - period = "YYYY-MM" for calendar periods (retainer month/cycle, T&M month)
 *   - period = "fixed" for fixed-price projects (single remaining-fee bucket)
 *
 * Thin orchestrator: parse params → subscribe to `getCloseWorkspace` (admin-only,
 * composes `billingScope` server-side) → loading skeleton → 404 on null →
 * render <CloseWorkspace>. Back returns to the Billing hub (/billing).
 */
export default function CloseWorkspacePage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const projectId = params.projectId as Id<"projects">
  const period = String(params.period ?? "")

  const valid = period === "fixed" || /^\d{4}-\d{2}$/.test(period)

  const data = useQuery(
    api.billingViews.getCloseWorkspace,
    isAuthenticated && valid ? { projectId, period } : "skip",
  )
  useBreadcrumbTitle(data ? `Close · ${data.period.label}` : null)

  if (!valid) notFound()
  if (data === undefined) return <CloseWorkspaceSkeleton />
  if (data === null) notFound()

  return (
    <div className="w-full">
      <CloseWorkspace data={data} backHref="/billing" />
    </div>
  )
}
