import { describe, expect, it } from "vitest"
import { deliveryOutcome } from "../webhook-deliveries"
import { summarizeEventTypes, webhookEventLabel } from "@/lib/webhook-events"

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
