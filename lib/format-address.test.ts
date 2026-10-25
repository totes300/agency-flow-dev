import { describe, expect, it } from "vitest"
import { formatBillingAddress } from "./format-address"

describe("formatBillingAddress", () => {
  it("joins the set lines, with zip and city on one line", () => {
    expect(
      formatBillingAddress({
        billingStreet: "Main St 1",
        billingStreet2: "Floor 2",
        billingZip: "1011",
        billingCity: "Budapest",
        billingCountry: "Hungary",
      }),
    ).toBe("Main St 1\nFloor 2\n1011 Budapest\nHungary")
  })

  it("skips missing parts", () => {
    expect(formatBillingAddress({ billingCity: "Vienna" })).toBe("Vienna")
  })

  it("is undefined when nothing is set", () => {
    expect(formatBillingAddress({})).toBeUndefined()
  })
})
