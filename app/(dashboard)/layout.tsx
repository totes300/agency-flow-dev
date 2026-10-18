import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { InboxSidebar } from "@/components/inbox/inbox-sidebar"
import { InboxSidebarProvider } from "@/components/inbox/inbox-sidebar-context"
import { Separator } from "@/components/ui/separator"
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb"
import { OnboardingGate } from "@/components/onboarding-gate"
import { BreadcrumbTitleProvider } from "@/components/breadcrumb-title-provider"
import { TimerProvider } from "@/components/timer-provider"
import { FloatingTimerWidget } from "@/components/timer/floating-timer-widget"
import { StaleTimerDialog } from "@/components/timer/stale-timer-dialog"
import { Toaster } from "@/components/ui/sonner"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // InboxSidebarProvider renders SidebarProvider in controlled mode —
    // it owns the inbox ⇄ nav-rail choreography
    <InboxSidebarProvider>
      {/* U1 shell (§11.6): the sidebar is the grey canvas; the page sits in
          one inset rounded panel. */}
      <AppSidebar variant="inset" />
      <InboxSidebar />
      {/* min-w-0: SidebarInset is a horizontal flex item; without it, a page
          whose content has a large intrinsic width (e.g. the Planner's day
          canvas) blocks shrinking and pushes the whole inset past the
          viewport instead of scrolling internally. */}
      {/* overflow-clip (not hidden): rounds the panel's corners without making
          it a scroll container, so pages' sticky headers keep sticking to the
          window. */}
      <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:ring-1 md:peer-data-[variant=inset]:ring-sidebar-border md:peer-data-[variant=inset]:overflow-clip">
        <BreadcrumbTitleProvider>
          <header className="flex h-12 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <DashboardBreadcrumb />
            </div>
          </header>
          {/* A full-bleed page (data-full-bleed, e.g. the task view) fills the
              panel edge to edge instead of sitting in the page padding. */}
          <div className="flex flex-1 flex-col gap-4 px-4 pb-6 pt-6 md:px-12 has-[[data-full-bleed]]:p-0 md:has-[[data-full-bleed]]:p-0">
            <OnboardingGate>
              <TimerProvider>
                {children}
                <FloatingTimerWidget />
                <StaleTimerDialog />
              </TimerProvider>
            </OnboardingGate>
          </div>
        </BreadcrumbTitleProvider>
      </SidebarInset>
      <Toaster />
    </InboxSidebarProvider>
  )
}
