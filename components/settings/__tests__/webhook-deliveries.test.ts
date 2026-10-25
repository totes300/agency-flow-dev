import { describe, expect, it } from "vitest"
import { deliveryOutcome } from "../webhook-deliveries"
import { summarizeEventTypes, webhookEventLabel } from "@/lib/webhook-events"
import { authKeyArg } from "../webhook-endpoint-dialog"

const base = { attempt: 1, httpStatus: null, error: null, nextAttemptAt: null }

describe("deliveryOutcome", () => {
  it("shows the HTTP code, a later attempt, a pending attempt and the next retry", () => {
    expect(deliveryOutcome({ ...base, status: "ok", httpStatus: 200 })).toBe("200")
    expect(deliveryOutcome({ ...base, status: "ok", httpStatus: 204, attempt: 2 })).toBe("204 · attempt 2")
    expect(deliveryOutcome({ ...base, status: "pending", attempt: 4 })).toBe("Pending · attempt 4 of 4")
    expect(deliveryOutcome({ ...base, status: "failed", error: "Network error" })).toBe("Network error")
    const retry = new Date(2026, 9, 25, 16, 58).getTime()
    expect(deliveryOutcome({ ...base, status: "failed", httpStatus: 503, nextAttemptAt: retry })).toMatch(/^503 · retry at .*16:58$/)
  })
})

describe("event labels", () => {
  it("summarizes all, up to two labels, then +N", () => {
    expect(summarizeEventTypes(null)).toBe("All events")
    expect(summarizeEventTypes(["status_changed", "comment_added"])).toBe("Status changed, Comment added")
    expect(summarizeEventTypes(["status_changed", "comment_added", "time_entry_logged"])).toBe("Status changed, Comment added +1")
    expect(webhookEventLabel("test")).toBe("Test event")
  })
})

describe("authKeyArg (edit dialog: keep / replace / remove)", () => {
  it("omits to keep, sends null to remove, and a typed key wins over a pending removal", () => {
    expect(authKeyArg("", false)).toBeUndefined()
    expect(authKeyArg("   ", false)).toBeUndefined()
    expect(authKeyArg("", true)).toBeNull()
    expect(authKeyArg("   ", true)).toBeNull()
    expect(authKeyArg("key_live_abc123", false)).toBe("key_live_abc123")
    expect(authKeyArg("key_live_abc123", true)).toBe("key_live_abc123")
  })
})
