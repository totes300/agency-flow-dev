import { describe, expect, it } from "vitest"
import {
  activeFacetFields,
  applyFacetFilters,
  clearFacet,
  deriveFacetOptions,
  hasActiveFacets,
  toggleFacetValue,
  type FacetField,
} from "./facet-filter"

type Item = { id: string; client: string; type: "fixed" | "retainer" | "t_and_m" }

const items: Item[] = [
  { id: "1", client: "Arlow", type: "fixed" },
  { id: "2", client: "Arlow", type: "retainer" },
  { id: "3", client: "Birch", type: "retainer" },
  { id: "4", client: "Cobalt", type: "t_and_m" },
]

type Key = "client" | "type"
const fields: FacetField<Item, Key>[] = [
  { key: "client", label: "Client", valueOf: (i) => i.client, labelOf: (i) => i.client },
  {
    key: "type",
    label: "Type",
    valueOf: (i) => i.type,
    labelOf: (i) => i.type.toUpperCase(),
    order: ["retainer", "fixed", "t_and_m"],
  },
]

describe("applyFacetFilters", () => {
  it("ORs values within a property and ANDs properties", () => {
    expect(applyFacetFilters(items, fields, {}).map((i) => i.id)).toEqual(["1", "2", "3", "4"])
    expect(applyFacetFilters(items, fields, { client: ["Arlow", "Birch"] }).map((i) => i.id)).toEqual(["1", "2", "3"])
    expect(
      applyFacetFilters(items, fields, { client: ["Arlow", "Birch"], type: ["retainer"] }).map((i) => i.id),
    ).toEqual(["2", "3"])
  })
})

describe("deriveFacetOptions", () => {
  it("counts each value over the items passing the OTHER filters", () => {
    const options = deriveFacetOptions(items, fields, { type: ["retainer"] }, "client")
    expect(options).toEqual([
      { key: "Arlow", label: "Arlow", count: 1, selected: false },
      { key: "Birch", label: "Birch", count: 1, selected: false },
    ])
  })

  it("ignores the property's own selection, so other values stay pickable", () => {
    const options = deriveFacetOptions(items, fields, { client: ["Arlow"] }, "client")
    expect(options.map((o) => [o.key, o.count, o.selected])).toEqual([
      ["Arlow", 2, true],
      ["Birch", 1, false],
      ["Cobalt", 1, false],
    ])
  })

  it("keeps a selected value listed at zero matches", () => {
    const options = deriveFacetOptions(items, fields, { client: ["Cobalt"], type: ["fixed"] }, "client")
    expect(options).toEqual([
      { key: "Arlow", label: "Arlow", count: 1, selected: false },
      { key: "Cobalt", label: "Cobalt", count: 0, selected: true },
    ])
  })

  it("follows a field's fixed order", () => {
    expect(deriveFacetOptions(items, fields, {}, "type").map((o) => o.label)).toEqual(["RETAINER", "FIXED", "T_AND_M"])
  })
})

describe("selection helpers", () => {
  it("toggles, clears and reports active properties", () => {
    let selection = toggleFacetValue({}, "client" as Key, "Arlow")
    selection = toggleFacetValue(selection, "client", "Birch")
    expect(selection.client).toEqual(["Arlow", "Birch"])
    selection = toggleFacetValue(selection, "client", "Arlow")
    expect(selection.client).toEqual(["Birch"])
    expect(activeFacetFields(fields, selection).map((f) => f.key)).toEqual(["client"])
    expect(hasActiveFacets(fields, selection)).toBe(true)
    expect(hasActiveFacets(fields, clearFacet(selection, "client"))).toBe(false)
  })
})
