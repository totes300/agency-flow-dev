import { describe, expect, it } from "vitest"
import type { TriageItemDetail } from "@/convex/email/triageView"
import { triageKeyAction, stepSelection, type TriageKeyEvent } from "@/components/triage/use-triage-keyboard"
import { canMerge, drawerTarget, primaryAction, suggestionsFor } from "@/components/triage/triage-model"

const key = (over: Partial<TriageKeyEvent>): TriageKeyEvent => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  targetEditable: false,
  targetInDrawer: false,
  overlayOpen: false,
  listVisible: true,
  ...over,
})

describe("triageKeyAction (§7.7, F10)", () => {
  it("J/K move, ⌘↵ / Ctrl+↵ the primary, M / D / H, ?", () => {
    expect(triageKeyAction(key({ key: "j" }))).toBe("next")
    expect(triageKeyAction(key({ key: "k" }))).toBe("prev")
    expect(triageKeyAction(key({ key: "Enter", metaKey: true }))).toBe("primary")
    expect(triageKeyAction(key({ key: "Enter", ctrlKey: true }))).toBe("primary")
    expect(triageKeyAction(key({ key: "m" }))).toBe("merge")
    expect(triageKeyAction(key({ key: "d" }))).toBe("decline")
    expect(triageKeyAction(key({ key: "h" }))).toBe("snooze")
    expect(triageKeyAction(key({ key: "?" }))).toBe("shortcuts")
  })

  it("never while typing, with another modifier, or while a menu / dialog is open", () => {
    for (const k of ["j", "d", "m", "h"]) {
      expect(triageKeyAction(key({ key: k, targetEditable: true }))).toBeNull()
      expect(triageKeyAction(key({ key: k, overlayOpen: true }))).toBeNull()
      expect(triageKeyAction(key({ key: k, metaKey: true }))).toBeNull()
    }
    expect(triageKeyAction(key({ key: "Enter", metaKey: true, targetEditable: true }))).toBeNull()
    // Inside the drawer the drawer owns the keys — letters and ⌘↵ alike.
    expect(triageKeyAction(key({ key: "d", targetInDrawer: true }))).toBeNull()
    expect(triageKeyAction(key({ key: "Enter", metaKey: true, targetInDrawer: true }))).toBeNull()
    expect(triageKeyAction(key({ key: "Enter" }))).toBeNull()
  })

  it("the digits are never Triage's (a focused question owns 1–4); J/K stand down while the list is hidden", () => {
    for (const d of ["1", "2", "3", "4"]) expect(triageKeyAction(key({ key: d }))).toBeNull()
    expect(triageKeyAction(key({ key: "j", listVisible: false }))).toBeNull()
    expect(triageKeyAction(key({ key: "Enter", metaKey: true, listVisible: false }))).toBe("primary")
  })

  it("stepSelection clamps at the ends and starts at the first row", () => {
    expect(stepSelection(["a", "b", "c"], null, 1)).toBe("a")
    expect(stepSelection(["a", "b", "c"], "a", 1)).toBe("b")
    expect(stepSelection(["a", "b", "c"], "c", 1)).toBe("c")
    expect(stepSelection(["a", "b", "c"], "a", -1)).toBe("a")
    expect(stepSelection([], "a", 1)).toBeNull()
  })
})

function detail(over: Partial<TriageItemDetail>): TriageItemDetail {
  return {
    _id: "i1",
    kind: "request",
    status: "open",
    outcome: null,
    kickoffOutcome: null,
    title: "Black Friday",
    subject: "Black Friday",
    state: { label: "1 task ready", tone: "waiting", live: false, fresh: false },
    agentThreadId: "th1",
    clientId: "c1",
    clientName: "Pragmatico",
    sender: null,
    messageCount: 1,
    snoozedUntil: null,
    plan: { tasks: [{ proposalId: "p1", revision: 1, title: "Black Friday", status: "pending" }], isReply: false, hasGaps: false },
    change: null,
    commit: null,
    draftId: null,
    planIssue: null,
    attentions: [],
    decisionNote: null,
    linkedTask: null,
    mailbox: null,
    emails: [],
    ...over,
  } as TriageItemDetail
}

describe("primaryAction — one dark primary per item", () => {
  it("per kind", () => {
    expect(primaryAction(detail({}))).toBe("create")
    expect(primaryAction(detail({ commit: { outcome: "created", undoUntil: 1 }, draftId: "d1" as never }))).toBe("send")
    expect(primaryAction(detail({ commit: { outcome: "created", undoUntil: 1 } }))).toBeNull()
    expect(primaryAction(detail({ kind: "change", plan: null, change: { proposalId: "c1" as never, revision: 2 } }))).toBe("apply")
    expect(primaryAction(detail({ kind: "approval", plan: null }))).toBe("markDone")
    expect(primaryAction(detail({ kind: "question", plan: null, draftId: "d1" as never }))).toBe("send")
    expect(primaryAction(detail({ kind: "needs_look", plan: null }))).toBe("planIt")
    expect(primaryAction(detail({ attentions: [{ messageId: "m" as never, stage: "received", message: "x" }] }))).toBe("retry")
    expect(primaryAction(detail({ planIssue: { kind: "run_incomplete", message: "x", job: null } }))).toBe("retryPlanning")
    expect(primaryAction(detail({ planIssue: { kind: "no_actor", message: "x", job: null } }))).toBeNull()
    expect(primaryAction(detail({ status: "filtered" }))).toBe("promote")
    expect(primaryAction(detail({ status: "done" }))).toBeNull()
    expect(primaryAction(detail({ state: { label: "Preparing…", tone: "progress", live: true, fresh: false } }))).toBeNull()
  })

  it("Merge needs a client and a fresh item", () => {
    expect(canMerge(detail({}))).toBe(true)
    expect(canMerge(detail({ clientId: null }))).toBe(false)
    expect(canMerge(detail({ kind: "change" }))).toBe(false)
    expect(canMerge(detail({ commit: { outcome: "created", undoUntil: null } }))).toBe(false)
  })

  it("2–3 suggestions for the state", () => {
    expect(suggestionsFor(detail({})).map((s) => s.label)).toEqual(["Split it into two tasks", "Who should do this?", "Why these due dates?"])
    expect(suggestionsFor(detail({ commit: { outcome: "created", undoUntil: null }, draftId: "d" as never })).map((s) => s.label)).toContain(
      "Make the reply shorter",
    )
    expect(suggestionsFor(detail({ state: { label: "Preparing…", tone: "progress", live: true, fresh: false } }))).toEqual([])
  })

  it("the panel toggle opens the change, else the first draft, else the linked task", () => {
    expect(drawerTarget(detail({ change: { proposalId: "c1" as never, revision: 1 } }))).toEqual({
      kind: "proposal",
      ref: { kind: "change", proposalId: "c1" },
    })
    expect(drawerTarget(detail({}))).toEqual({ kind: "proposal", ref: { kind: "draft", proposalId: "p1" } })
    expect(
      drawerTarget(detail({ plan: null, linkedTask: { _id: "t1" as never, identifier: "PRG-1", title: "x" } })),
    ).toEqual({ kind: "task", task: { id: "t1", identifier: "PRG-1" } })
    expect(drawerTarget(detail({ plan: null }))).toBeNull()
  })
})
