// @vitest-environment edge-runtime
//
// Email triage B5: the pure parts of the send pipeline — the §6.7
// "Approve & send" gate row by row, the provider-error → draft-state map,
// the D35 sending-mailbox rule, I2 recipients and the I8 promise resolver
// (working days from the send time, org timezone).

import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import { sendGate, warningLabel, type SendGateContext, type SendGateDraft } from "../sendGate";
import { chooseFromMailbox, composeSentBody, defaultRecipients, inboundStaleReason, normalizeRecipients } from "../drafts";
import { classifySendError } from "../send";
import { GmailApiError } from "../gmailClient";
import { GmailAuthError } from "../gmailAuth";
import { MimeBuildError } from "../mime";
import { resolvePromises } from "../promises";

const TZ = "Europe/Budapest";

function draft(extra: Partial<SendGateDraft> = {}): SendGateDraft {
  return { kind: "completion", version: 2, to: [{ email: "reka@pragmatico.hu" }], cc: [], createdBy: "agent", ...extra };
}
function ctx(extra: Partial<SendGateContext> = {}): SendGateContext {
  return {
    expectedVersion: 2,
    approver: { isAdmin: true },
    createdByMember: false,
    pendingChange: null,
    mailbox: { connected: true, label: "adam@agency.test" },
    openRequests: [],
    pendingQuestion: false,
    presendFindings: [],
    attachmentProblems: [],
    ...extra,
  };
}
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("sendGate — the §6.7 Approve & send column", () => {
  it("passes a clean draft with no rows", () => {
    expect(sendGate(draft(), ctx())).toEqual({ blocks: [], warnings: [] });
  });

  it("blocks a version mismatch and a stale draft — review again (D9, I11)", () => {
    expect(keys(sendGate(draft(), ctx({ expectedVersion: 1 })).blocks)).toEqual(["review_again"]);
    const stale = sendGate(draft({ stale: { reason: "Kovács Réka wrote at 14:05", at: 1 } }), ctx());
    expect(stale.blocks).toEqual([{ key: "review_again", text: "Kovács Réka wrote at 14:05 — review the draft again." }]);
  });

  it("blocks a pending change proposal (I9) and names the fix", () => {
    expect(sendGate(draft(), ctx({ pendingChange: { task: "PRG-12 Black Friday bannerek" } })).blocks).toEqual([
      { key: "pending_change", text: "Discard or retry the pending change on PRG-12 Black Friday bannerek." },
    ]);
  });

  it("blocks a disconnected sending mailbox — Reconnect", () => {
    const r = sendGate(draft(), ctx({ mailbox: { connected: false, label: "seed@agency.test" } }));
    expect(r.blocks).toEqual([{ key: "reconnect", text: "Reconnect seed@agency.test to send." }]);
  });

  it("I12: an open request blocks completion and reply, only warns for kickoff and the rest", () => {
    const open = ctx({ openRequests: [{ id: "r1", text: "A 20% kedvezményt is írjátok rá." }, { id: "r2", text: "x" }] });
    for (const kind of ["completion", "reply"]) {
      const r = sendGate(draft({ kind }), open);
      expect(r.blocks).toEqual([{ key: "open_requests", text: 'Not answered yet: "A 20% kedvezményt is írjátok rá." (+1 more)' }]);
      expect(r.warnings).toEqual([]);
    }
    for (const kind of ["kickoff", "question", "nudge", "interim", "recap", "follow_up"]) {
      const r = sendGate(draft({ kind }), open);
      expect(r.blocks).toEqual([]);
      expect(keys(r.warnings)).toEqual(["open_requests"]);
    }
  });

  it("refuses a non-admin approver — a member's own draft says it was saved for an admin", () => {
    expect(sendGate(draft(), ctx({ approver: { isAdmin: false }, createdByMember: true })).blocks).toEqual([
      { key: "not_admin", text: "Saved for an admin — only an admin can approve and send it." },
    ]);
    expect(keys(sendGate(draft(), ctx({ approver: { isAdmin: false } })).blocks)).toEqual(["not_admin"]);
  });

  it("blocks no recipient and unreadable attachments", () => {
    expect(keys(sendGate(draft({ to: [] }), ctx()).blocks)).toEqual(["no_recipient"]);
    expect(keys(sendGate(draft(), ctx({ attachmentProblems: ["gone", "too big"] })).blocks)).toEqual(["attachments", "attachments"]);
  });

  it("warns (never blocks) for a new recipient, a pending question and pre-send findings", () => {
    const r = sendGate(
      draft({ cc: [{ email: "new@x.hu", newRecipient: true }] }),
      ctx({ pendingQuestion: true, presendFindings: [{ key: "cc_missing", text: "Gábor was on Cc and is missing" }] }),
    );
    expect(r.blocks).toEqual([]);
    expect(keys(r.warnings)).toEqual(["new_recipient", "pending_question", "presend:cc_missing"]);
    expect(warningLabel(r.warnings[0])).toBe("new_recipient: Not on this conversation before: new@x.hu");
  });

  it("collects every block at once", () => {
    const r = sendGate(
      draft({ to: [] }),
      ctx({ expectedVersion: 1, pendingChange: { task: "PRG-1 x" }, mailbox: { connected: false, label: "m" }, approver: { isAdmin: false } }),
    );
    expect(keys(r.blocks)).toEqual(["review_again", "pending_change", "reconnect", "not_admin", "no_recipient"]);
  });
});

describe("classifySendError — §5.4 error kinds → draft state", () => {
  it("maps provider errors to failed + kind, and flips the connector on 401 / scope 403", () => {
    expect(classifySendError(new GmailApiError("recipient", 400, null, "bad"), true)).toMatchObject({ outcome: "failed", kind: "recipient" });
    expect(classifySendError(new GmailApiError("transient", 503, null, "x"), true)).toMatchObject({ outcome: "failed", kind: "transient" });
    expect(classifySendError(new GmailApiError("quota", 429, null, "x"), true)).toMatchObject({ outcome: "failed", kind: "quota" });
    expect(classifySendError(new GmailApiError("disconnected", 401, null, "x"), true)).toMatchObject({
      outcome: "failed", kind: "disconnected", markConnector: "expired",
    });
    expect(classifySendError(new GmailApiError("permission", 403, "insufficientPermissions", "x"), true)).toMatchObject({
      outcome: "failed", kind: "permission", markConnector: "error",
    });
    expect(classifySendError(new GmailApiError("quota", 403, "rateLimitExceeded", "x"), true).markConnector).toBeUndefined();
  });

  it("an ambiguous send (timeout / unknown) is `unknown`; before the call it is a plain failure", () => {
    expect(classifySendError(new GmailApiError("unknown", 0, null, "timeout"), true)).toMatchObject({ outcome: "unknown" });
    expect(classifySendError(new Error("boom"), true)).toMatchObject({ outcome: "unknown", kind: "unknown" });
    expect(classifySendError(new Error("boom"), false)).toMatchObject({ outcome: "failed", kind: "unknown" });
    expect(classifySendError(new GmailAuthError("disconnected", "x"), false)).toMatchObject({ outcome: "failed", kind: "disconnected" });
    expect(classifySendError(new MimeBuildError("Invalid email address"), false)).toMatchObject({ outcome: "failed", kind: "recipient" });
  });
});

describe("D35 sending mailbox rule", () => {
  const A = "conn_adam" as Id<"connectors">;
  const B = "conn_bence" as Id<"connectors">;
  const M = "conn_member" as Id<"connectors">;
  const holders = [
    { connectorId: M, userId: "u_member" as Id<"users"> },
    { connectorId: B, userId: "u_bence" as Id<"users"> },
  ];
  it("the sending admin's own mailbox when it holds the conversation", () => {
    expect(chooseFromMailbox({ holders, senderUserId: "u_bence" as Id<"users">, clientWroteTo: M, fallback: M })).toBe(B);
  });
  it("else the mailbox the client wrote to, else the thread's own", () => {
    expect(chooseFromMailbox({ holders, senderUserId: "u_adam" as Id<"users">, clientWroteTo: B, fallback: M })).toBe(B);
    expect(chooseFromMailbox({ holders, senderUserId: null, clientWroteTo: A, fallback: M })).toBe(M);
  });
});

describe("I2 recipients", () => {
  const allowed = new Set(["reka@pragmatico.hu", "gabor@pragmatico.hu"]);
  it("lower-cases, de-duplicates (To wins) and flags addresses not on the conversation", () => {
    const r = normalizeRecipients(
      [{ name: "Kovács Réka", email: "Reka@Pragmatico.hu" }],
      [{ email: "gabor@pragmatico.hu" }, { email: "reka@pragmatico.hu" }, { email: "boss@pragmatico.hu" }],
      allowed,
    );
    expect(r.to).toEqual([{ name: "Kovács Réka", email: "reka@pragmatico.hu" }]);
    expect(r.cc).toEqual([{ email: "gabor@pragmatico.hu" }, { email: "boss@pragmatico.hu", newRecipient: true }]);
    expect(() => normalizeRecipients([{ email: "nope" }], [], allowed)).toThrow();
  });
  it("reply-all defaults: the latest sender, the others + replyCc, never our own mailboxes", () => {
    const d = defaultRecipients({
      latestInbound: {
        from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
        to: [{ email: "adam@agency.test" }],
        cc: [{ email: "peter@pragmatico.hu" }],
      },
      participants: [],
      own: new Set(["adam@agency.test"]),
      replyCcEmails: ["gabor@pragmatico.hu"],
    });
    expect(d).toEqual({
      to: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }],
      cc: [{ email: "peter@pragmatico.hu" }, { email: "gabor@pragmatico.hu" }],
    });
  });
  it("link attachments not in the text are added to the sent body", () => {
    expect(
      composeSentBody({
        bodyText: "Szia! Itt: https://a.hu\n",
        attachments: [{ label: "Figma", url: "https://figma.com/x" }, { label: "In text", url: "https://a.hu" }],
      }),
    ).toBe("Szia! Itt: https://a.hu\n\nFigma: https://figma.com/x\n");
  });
  it("the stale reason names the sender and the local time", () => {
    const at = Date.UTC(2026, 9, 16, 12, 5); // 14:05 in Budapest (CEST)
    expect(inboundStaleReason({ from: { name: "Kovács Réka", email: "r@p.hu" }, sentAt: at }, TZ)).toBe("Kovács Réka wrote at 14:05");
  });
});

describe("I8 promise resolution", () => {
  // Friday 2026-10-16 10:00 Budapest.
  const sentAt = Date.UTC(2026, 9, 16, 8, 0);
  const body = "Szia Réka!\n\nKöszönjük, elkezdtük. 2 munkanapon belül jelentkezünk a tervekkel.\nA visszaszámláló szerdán élesedik.\n\nÁdám";
  const none = { workingDays: null, calendarDays: null, date: null };

  it("resolves working days from the send time (Friday + 2 → Tuesday) and weekdays deterministically", () => {
    const r = resolvePromises({
      output: {
        promises: [
          { ...none, quote: "2 munkanapon belül jelentkezünk a tervekkel.", workingDays: 2 },
          // The model's date is wrong on purpose — the weekday in the quote wins.
          { ...none, quote: "A visszaszámláló szerdán élesedik.", date: "2026-10-30" },
        ],
      },
      candidates: [],
      body,
      sentAt,
      tz: TZ,
    });
    expect(r).toEqual([
      { text: "2 munkanapon belül jelentkezünk a tervekkel.", dueDate: "2026-10-20" },
      { text: "A visszaszámláló szerdán élesedik.", dueDate: "2026-10-21" },
    ]);
  });

  it("drops a quote that is not in the sent text, a past date and an undated promise", () => {
    const r = resolvePromises({
      output: {
        promises: [
          { ...none, quote: "Holnap küldjük a számlát.", calendarDays: 1 }, // not in the body
          { ...none, quote: "jelentkezünk a tervekkel", date: "2026-10-01" }, // past
          { ...none, quote: "Köszönjük, elkezdtük." }, // no time
        ],
      },
      candidates: [],
      body,
      sentAt,
      tz: TZ,
    });
    expect(r).toEqual([]);
  });

  it("uses a hint only when its text was sent; a model failure (null) still keeps sent hints", () => {
    const r = resolvePromises({
      output: null,
      candidates: [
        { text: "2 munkanapon belül jelentkezünk", dueDate: "2026-10-20" },
        { text: "Pénteken átadjuk.", dueDate: "2026-10-23" }, // edited out of the email
      ],
      body,
      sentAt,
      tz: TZ,
    });
    expect(r).toEqual([{ text: "2 munkanapon belül jelentkezünk", dueDate: "2026-10-20" }]);
  });
});
