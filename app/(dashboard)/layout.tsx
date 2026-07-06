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
      <AppSidebar />
      <InboxSidebar />
      {/* min-w-0: SidebarInset is a horizontal flex item; without it, a page
          whose content has a large intrinsic width (e.g. the Planner's day
          canvas) blocks shrinking and pushes the whole inset past the
          viewport instead of scrolling internally. */}
      <SidebarInset className="min-w-0">
        <BreadcrumbTitleProvider>
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <DashboardBreadcrumb />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 px-4 pb-6 pt-6 md:px-12">
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
