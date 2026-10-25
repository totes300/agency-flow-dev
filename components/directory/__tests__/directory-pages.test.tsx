// Projects / clients directory pages: Active/All re-filters one loaded list
// (no skeleton flash, focus kept on the tab), the Active-tab empty state
// points to archived records, and the project filter is the Notion
// "+ Filter" flow with faceted counts and removable chips.

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import ProjectsPage from "@/app/(dashboard)/projects/page"
import ClientsPage from "@/app/(dashboard)/clients/page"

const queryData = new Map<string, unknown>()
const queryCalls: Array<{ name: string; args: unknown }> = []

vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(ref)
    queryCalls.push({ name, args })
    return queryData.get(name)
  },
  useMutation: () => vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

beforeAll(() => {
  // cmdk (the filter menus) measures and scrolls items.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  queryData.clear()
  queryCalls.length = 0
})

function project(over: {
  id: string
  name: string
  clientId: string
  clientName: string
  billingType?: "fixed" | "t_and_m" | "retainer" | "non_billable"
  archivedAt?: number
}) {
  return {
    _id: over.id,
    _creationTime: 0,
    name: over.name,
    code: over.id.toUpperCase(),
    clientId: over.clientId,
    clientName: over.clientName,
    currency: "EUR",
    billingType: over.billingType ?? "fixed",
    archivedAt: over.archivedAt,
  }
}

const ARLOW_SITE = project({ id: "p1", name: "Arlow site", clientId: "c1", clientName: "Arlow", billingType: "retainer" })
const ARLOW_APP = project({ id: "p2", name: "Arlow app", clientId: "c1", clientName: "Arlow" })
const BIRCH_OLD = project({ id: "p3", name: "Birch rebrand", clientId: "c2", clientName: "Birch", archivedAt: 1 })

function rowNames() {
  return within(screen.getByRole("table", { name: "Projects" }))
    .getAllByRole("link")
    .map((link) => link.textContent)
}

/** Keyboard tab switch (roving focus moves focus, which activates the tab). */
async function switchTab(from: string, to: string) {
  const trigger = screen.getByRole("tab", { name: from })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: "ArrowRight" })
  const next = screen.getByRole("tab", { name: to })
  await waitFor(() => expect(next).toHaveAttribute("aria-selected", "true"))
  return next
}

describe("Projects directory", () => {
  it("loads archived projects once and switches Active/All without a skeleton or lost focus", async () => {
    queryData.set("projects:list", [ARLOW_SITE, ARLOW_APP, BIRCH_OLD])
    render(<ProjectsPage />)
    expect(rowNames()).toEqual(["Arlow app", "Arlow site"])
    const toolbarButton = screen.getByRole("button", { name: "Filter projects" })

    const allTab = await switchTab("Active", "All projects")

    expect(allTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(allTab)
    expect(screen.queryByLabelText("Loading directory")).toBeNull()
    expect(screen.getByRole("button", { name: "Filter projects" })).toBe(toolbarButton)
    expect(rowNames()).toEqual(["Arlow app", "Arlow site", "Birch rebrand"])
    expect(new Set(queryCalls.filter((c) => c.name === "projects:list").map((c) => JSON.stringify(c.args)))).toEqual(
      new Set([JSON.stringify({ includeArchived: true })]),
    )
  })

  it("says the Active tab is empty when only archived projects exist, and offers the All tab", async () => {
    queryData.set("projects:list", [BIRCH_OLD])
    render(<ProjectsPage />)
    expect(screen.getByText("No active projects")).toBeInTheDocument()
    expect(screen.queryByText("No projects yet")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show all projects" }))
    expect(screen.getByRole("tab", { name: "All projects" })).toHaveAttribute("aria-selected", "true")
    expect(rowNames()).toEqual(["Birch rebrand"])
  })

  it("filters by client through the faceted + Filter menu, with chips that clear", async () => {
    queryData.set("projects:list", [ARLOW_SITE, ARLOW_APP, BIRCH_OLD])
    render(<ProjectsPage />)
    // Idle: no chip row.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()

    // Active tab: the client facet only knows clients of active projects.
    fireEvent.click(screen.getByRole("button", { name: "Filter projects" }))
    fireEvent.click(screen.getByRole("option", { name: /Client/ }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Arlow2"])
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    // All tab: archived projects' clients join the facet.
    await switchTab("Active", "All projects")
    fireEvent.click(screen.getByRole("button", { name: "Filter projects" }))
    fireEvent.click(screen.getByRole("option", { name: /Client/ }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Arlow2", "Birch1"])
    fireEvent.click(screen.getByRole("option", { name: /Birch/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    expect(rowNames()).toEqual(["Birch rebrand"])
    expect(screen.getByRole("button", { name: /^Client\s*Birch$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Remove Client filter" }))
    expect(rowNames()).toEqual(["Arlow app", "Arlow site", "Birch rebrand"])
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
  })

  it("narrows billing type facets by the selected client and clears everything at once", async () => {
    queryData.set("projects:list", [ARLOW_SITE, ARLOW_APP, BIRCH_OLD])
    render(<ProjectsPage />)
    await switchTab("Active", "All projects")

    fireEvent.click(screen.getByRole("button", { name: "Filter projects" }))
    fireEvent.click(screen.getByRole("option", { name: /Client/ }))
    fireEvent.click(screen.getByRole("option", { name: /Arlow/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "Filter" }))
    fireEvent.click(screen.getByRole("option", { name: /Billing type/ }))
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Fixed1", "Retainer1"])
    fireEvent.click(screen.getByRole("option", { name: /Retainer/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    expect(rowNames()).toEqual(["Arlow site"])
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(rowNames()).toEqual(["Arlow app", "Arlow site", "Birch rebrand"])
  })
})

describe("Clients directory", () => {
  const client = (id: string, name: string, archivedAt?: number) => ({
    _id: id,
    _creationTime: 0,
    name,
    currency: "EUR",
    archivedAt,
    primaryContact: null,
    activeProjectCount: 0,
    logoUrl: null,
  })

  it("loads archived clients once and switches Active/All without a skeleton or lost focus", async () => {
    queryData.set("clients:listWithContacts", [client("c1", "Arlow"), client("c2", "Birch", 1)])
    render(<ClientsPage />)
    expect(screen.queryByText("Birch")).toBeNull()

    const allTab = await switchTab("Active", "All clients")

    expect(document.activeElement).toBe(allTab)
    expect(screen.queryByLabelText("Loading directory")).toBeNull()
    expect(screen.getByText("Birch")).toBeInTheDocument()
    expect(
      new Set(queryCalls.filter((c) => c.name === "clients:listWithContacts").map((c) => JSON.stringify(c.args))),
    ).toEqual(new Set([JSON.stringify({ includeArchived: true })]))
  })

  it("says the Active tab is empty when only archived clients exist", async () => {
    queryData.set("clients:listWithContacts", [client("c2", "Birch", 1)])
    render(<ClientsPage />)
    expect(screen.getByText("No active clients")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show all clients" })).toBeInTheDocument()
  })
})
