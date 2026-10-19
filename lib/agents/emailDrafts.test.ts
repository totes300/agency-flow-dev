import { describe, expect, it } from "vitest";
import {
  AGENT_EMAIL_DRAFT_MARKER,
  approvalLabel,
  draftVersionLabel,
  failedPrimary,
  failureFix,
  formatRecipients,
  reapproveLabel,
  isEmailDraftRefOutput,
  parseRecipients,
  sameRecipients,
  secondsUntil,
  sendButtonLabel,
  sentLabel,
} from "./emailDrafts";

describe("isEmailDraftRefOutput", () => {
  it("accepts the submitDraft marker with a draft id only", () => {
    expect(isEmailDraftRefOutput({ block: AGENT_EMAIL_DRAFT_MARKER, draftId: "d1", version: 2 })).toBe(true);
    expect(isEmailDraftRefOutput({ block: AGENT_EMAIL_DRAFT_MARKER, draftId: "" })).toBe(false);
    expect(isEmailDraftRefOutput({ block: "agency-flow/table@1", draftId: "d1" })).toBe(false);
    expect(isEmailDraftRefOutput(null)).toBe(false);
  });
});

describe("secondsUntil (the queued countdown, from sendAt)", () => {
  it("rounds up and never goes below zero", () => {
    expect(secondsUntil(15_000, 0)).toBe(15);
    expect(secondsUntil(15_000, 100)).toBe(15);
    expect(secondsUntil(15_000, 14_001)).toBe(1);
    expect(secondsUntil(15_000, 15_000)).toBe(0);
    expect(secondsUntil(15_000, 20_000)).toBe(0);
  });
});

describe("labels", () => {
  it("version: rewritten by the agent, edited by you / a colleague", () => {
    expect(draftVersionLabel(1, null)).toBe("v1");
    expect(draftVersionLabel(2, { by: "agent" })).toBe("v2 · rewritten");
    expect(draftVersionLabel(3, { by: "user", isViewer: true, name: "Tóth Ádám" })).toBe("v3 · edited by you");
    expect(draftVersionLabel(3, { by: "user", isViewer: false, name: "Kiss Bence" })).toBe("v3 · edited by Kiss Bence");
    expect(draftVersionLabel(3, { by: "user", isViewer: false, name: null })).toBe("v3 · edited");
  });

  it("send: a completion approves an exact version; the rest send", () => {
    expect(sendButtonLabel("completion", 2)).toBe("Approve & send v2");
    expect(sendButtonLabel("kickoff", 2)).toBe("Send");
  });

  it("approval: the warning count", () => {
    expect(approvalLabel(0)).toBe("Needs your approval");
    expect(approvalLabel(1)).toBe("Needs your approval · 1 warning");
    expect(approvalLabel(2)).toBe("Needs your approval · 2 warnings");
  });

  it("sent: in the first recipient's thread", () => {
    expect(sentLabel(true, [{ name: "Kovács Réka", email: "reka@x.hu" }])).toBe("Sent in Kovács Réka’s thread");
    expect(sentLabel(true, [{ email: "reka@x.hu" }])).toBe("Sent in reka@x.hu’s thread");
    expect(sentLabel(false, [{ email: "reka@x.hu" }])).toBe("Sent");
  });
});

describe("failureFix", () => {
  it("Reconnect only for a disconnected mailbox (or lost permission); recipients; else Retry", () => {
    expect(failureFix("disconnected")).toBe("reconnect");
    expect(failureFix("permission")).toBe("reconnect");
    expect(failureFix("recipient")).toBe("recipients");
    expect(failureFix("quota")).toBe("retry");
    expect(failureFix("transient")).toBe("retry");
    expect(failureFix("unknown")).toBe("retry");
  });
});

describe("recipients text", () => {
  const existing = [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }, { email: "gabor@pragmatico.hu", newRecipient: true }];
  it("formats as addresses", () => {
    expect(formatRecipients(existing)).toBe("reka@pragmatico.hu, gabor@pragmatico.hu");
  });
  it("parses addresses, keeps known names, drops junk and duplicates", () => {
    expect(parseRecipients("Reka@pragmatico.hu; <new@x.hu>  nope, new@x.hu", existing)).toEqual([
      { name: "Kovács Réka", email: "reka@pragmatico.hu" },
      { email: "new@x.hu" },
    ]);
    expect(parseRecipients("", existing)).toEqual([]);
  });
  it("compares lists by address", () => {
    expect(sameRecipients([{ email: "A@x.hu" }], [{ email: "a@x.hu" }])).toBe(true);
    expect(sameRecipients([{ email: "a@x.hu" }], [{ email: "b@x.hu" }])).toBe(false);
  });
});

describe("failedPrimary", () => {
  it("Retry while the approval binds, a fresh Approve & send once it doesn't, nothing while the fix is the person's", () => {
    expect(failedPrimary({ kind: "disconnected", mailboxConnected: false, retryable: false })).toBeNull()
    expect(failedPrimary({ kind: "disconnected", mailboxConnected: true, retryable: false })).toBe("approve")
    expect(failedPrimary({ kind: "permission", mailboxConnected: true, retryable: true })).toBe("retry")
    expect(failedPrimary({ kind: "recipient", mailboxConnected: true, retryable: true })).toBeNull()
    expect(failedPrimary({ kind: "transient", mailboxConnected: true, retryable: true })).toBe("retry")
    expect(failedPrimary({ kind: "quota", mailboxConnected: true, retryable: false })).toBe("approve")
    expect(failedPrimary({ kind: null, mailboxConnected: true, retryable: false })).toBe("approve")
    expect(reapproveLabel(4)).toBe("Approve & send v4")
  })
})
