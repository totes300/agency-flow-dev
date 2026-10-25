import { describe, expect, it } from "vitest"
import {
  activeFacetCount,
  facetOptions,
  facetStateFromParams,
  filterRows,
  toggleFacetParam,
  type FacetDef,
} from "./hub-facets"

type Row = { client: string; state: string }
const rows: Row[] = [
  { client: "Acme", state: "draft" },
  { client: "Acme", state: "ready_to_close" },
  { client: "Bloom", state: "draft" },
]
const defs: FacetDef<Row>[] = [
  { key: "client", label: "Client", valueOf: (r) => r.client },
  { key: "state", label: "State", valueOf: (r) => r.state, order: ["ready_to_close", "draft"] },
]

describe("hub facets", () => {
  it("ANDs facets, ORs values", () => {
    expect(filterRows(rows, defs, { client: ["Acme"], state: ["draft"] })).toEqual([rows[0]])
    expect(filterRows(rows, defs, { client: ["Acme", "Bloom"] })).toHaveLength(3)
  })

  it("counts are cross-filtered by the other facets", () => {
    expect(facetOptions(rows, defs, { client: ["Acme"] }, "state")).toEqual([
      { id: "ready_to_close", name: "ready_to_close", count: 1 },
      { id: "draft", name: "draft", count: 1 },
    ])
    expect(facetOptions(rows, defs, { state: ["draft"] }, "client")).toEqual([
      { id: "Acme", name: "Acme", count: 1 },
      { id: "Bloom", name: "Bloom", count: 1 },
    ])
  })

  it("round-trips through the URL", () => {
    let params = new URLSearchParams("view=action")
    params = toggleFacetParam(params, "client", "Acme")
    params = toggleFacetParam(params, "client", "Bloom")
    expect(params.get("client")).toBe("Acme,Bloom")
    const state = facetStateFromParams(params, defs)
    expect(state).toEqual({ client: ["Acme", "Bloom"] })
    expect(activeFacetCount(state)).toBe(2)
    params = toggleFacetParam(toggleFacetParam(params, "client", "Acme"), "client", "Bloom")
    expect(params.has("client")).toBe(false)
  })
})
