import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { getFunctionName } from "convex/server"

const live = vi.hoisted(() => ({ triage: undefined as unknown, asked: [] as unknown[] }))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: () => undefined,
}))
vi.mock("@/lib/hooks/use-optional-query", () => ({
  useOptionalQuery: (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as never)
    if (name !== "email/triageView:openCount") return { data: undefined, error: null }
    live.asked.push(args)
    return { data: args === "skip" ? undefined : live.triage, error: null }
  },
}))
vi.mock("next/navigation", () => ({ usePathname: () => "/my-tasks" }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
// The sidebar primitives need the app shell; plain elements are enough here.
vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { NavMain } from "@/components/nav-main"
import { navigation } from "@/lib/navigation"

afterEach(() => {
  cleanup()
  live.asked = []
})

describe("the Triage nav item (D23, D26)", () => {
  it("shows for an admin of an org with email triage, with the open count on the shared badge", () => {
    live.triage = { count: 3, capped: false }
    render(<NavMain groups={navigation} isAdmin />)
    const link = screen.getByRole("link", { name: /Triage/ })
    expect(link).toHaveAttribute("href", "/triage")
    expect(screen.getByLabelText("3 emails need you in Triage")).toHaveTextContent("3")
  })

  it("is hidden for members (the query is not even asked)", () => {
    live.triage = { count: 3, capped: false }
    render(<NavMain groups={navigation} isAdmin={false} />)
    expect(screen.queryByRole("link", { name: /Triage/ })).not.toBeInTheDocument()
    expect(live.asked.every((a) => a === "skip")).toBe(true)
  })

  it("is hidden when the org has no email triage (the server answers null) and while loading", () => {
    live.triage = null
    render(<NavMain groups={navigation} isAdmin />)
    expect(screen.queryByRole("link", { name: /Triage/ })).not.toBeInTheDocument()
    cleanup()
    live.triage = undefined
    render(<NavMain groups={navigation} isAdmin />)
    expect(screen.queryByRole("link", { name: /Triage/ })).not.toBeInTheDocument()
  })

  it("no badge at zero", () => {
    live.triage = { count: 0, capped: false }
    render(<NavMain groups={navigation} isAdmin />)
    expect(screen.getByRole("link", { name: /Triage/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/in Triage/)).not.toBeInTheDocument()
  })
})
