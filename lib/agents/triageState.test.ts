import { describe, expect, it } from "vitest"
import { deriveTriageState, STATE_LABEL_MAX, updatedLabel, type TriageStateFacts } from "./triageState"

const base: TriageStateFacts = {
  status: "open",
  kind: "request",
  outcome: null,
  attentionMessage: null,
  planIssue: null,
  running: false,
  pendingQuestion: false,
  committed: null,
  draftStatus: null,
  planTaskCount: 0,
  planIsReply: false,
  changeReady: false,
}

const label = (over: Partial<TriageStateFacts>) => deriveTriageState({ ...base, ...over })

describe("deriveTriageState (§7.2 row labels)", () => {
  it("New: nothing prepared yet — grey, bold title", () => {
    expect(label({})).toEqual({ label: "New", tone: "progress", live: false, fresh: true })
    expect(label({ kind: "new_sender" })).toMatchObject({ label: "New sender", fresh: true })
  })

  it("Preparing…: a run or a scheduled start — grey, live", () => {
    expect(label({ running: true })).toEqual({ label: "Preparing…", tone: "progress", live: true, fresh: false })
    // Preparing wins over an older plan (a re-plan is in flight).
    expect(label({ running: true, planTaskCount: 2 })).toMatchObject({ label: "Preparing…" })
  })

  it("a question, N tasks, a reply — amber", () => {
    expect(label({ pendingQuestion: true, planTaskCount: 1 })).toMatchObject({ label: "A question for you", tone: "waiting" })
    expect(label({ planTaskCount: 1 })).toMatchObject({ label: "1 task ready", tone: "waiting" })
    expect(label({ planTaskCount: 3 })).toMatchObject({ label: "3 tasks ready", tone: "waiting" })
    expect(label({ planIsReply: true, draftStatus: "draft" })).toMatchObject({ label: "Reply ready", tone: "waiting" })
    expect(label({ kind: "question", draftStatus: "failed" })).toMatchObject({ label: "Reply ready" })
  })

  it("after Create: Created (grey) until the kickoff exists, then Kickoff ready (amber); sending is grey", () => {
    expect(label({ committed: "created" })).toMatchObject({ label: "Created", tone: "progress" })
    expect(label({ committed: "merged" })).toMatchObject({ label: "Merged", tone: "progress" })
    expect(label({ committed: "created", draftStatus: "draft" })).toMatchObject({ label: "Kickoff ready", tone: "waiting" })
    expect(label({ committed: "created", draftStatus: "queued" })).toMatchObject({ label: "Sending…", tone: "progress", live: true })
  })

  it("change, approval, needs a look", () => {
    expect(label({ kind: "change", changeReady: true })).toMatchObject({ label: "Change ready", tone: "waiting" })
    expect(label({ kind: "change" })).toMatchObject({ label: "New", tone: "progress" })
    expect(label({ kind: "approval" })).toMatchObject({ label: "Client approved", tone: "waiting" })
    expect(label({ kind: "needs_look" })).toMatchObject({ label: "Needs a look", tone: "waiting" })
  })

  it("attention and plan issues show their reason (amber), clipped to one line", () => {
    expect(label({ attentionMessage: "Couldn't read the email", planTaskCount: 2 })).toMatchObject({
      label: "Couldn't read the email",
      tone: "waiting",
    })
    expect(label({ planIssue: { kind: "no_actor", message: "No designated agent actor" } })).toMatchObject({
      label: "No agent actor set",
      tone: "waiting",
    })
    expect(label({ planIssue: { kind: "run_incomplete", message: "The assistant couldn't finish the plan — Retry" } })).toMatchObject({
      label: "The assistant couldn't finish the plan",
    })
    const long = label({ attentionMessage: "x".repeat(200) }).label
    expect(long).toHaveLength(STATE_LABEL_MAX)
    expect(long.endsWith("…")).toBe(true)
  })

  it("Snoozed (grey), Filtered (grey), and the done outcomes (green)", () => {
    expect(label({ status: "snoozed", planTaskCount: 1 })).toMatchObject({ label: "Snoozed", tone: "progress" })
    // A snoozed item with a live re-plan shows Preparing… (and so offers no Create).
    expect(label({ status: "snoozed", running: true, planTaskCount: 1 })).toMatchObject({ label: "Preparing…", live: true })
    expect(label({ status: "filtered" })).toMatchObject({ label: "Filtered", tone: "progress" })
    expect(label({ status: "done", outcome: "declined" })).toMatchObject({ label: "Declined", tone: "done" })
    expect(label({ status: "done", outcome: "created" })).toMatchObject({ label: "Created", tone: "done" })
    expect(label({ status: "done", outcome: "merged" })).toMatchObject({ label: "Merged", tone: "done" })
    expect(label({ status: "done", outcome: "replied" })).toMatchObject({ label: "Reply sent", tone: "done" })
  })

  it("Updated · N emails only when later messages joined", () => {
    expect(updatedLabel(1)).toBeNull()
    expect(updatedLabel(2)).toBe("Updated · 2 emails")
  })
})
