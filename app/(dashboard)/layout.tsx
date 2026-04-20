import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
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
          <div className="flex flex-1 flex-col gap-4 px-12 pb-6 pt-0 md:px-20 lg:px-32 xl:px-64 2xl:px-96">
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
    </SidebarProvider>
  )
}
