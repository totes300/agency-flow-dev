// @vitest-environment edge-runtime
//
// Email triage B3: the pure sync rules — the D24 decision table row by row,
// cursors, dates, backoff (docs/prd-email-triage.md D24, D33, D34, I1, I13).

import { describe, expect, it } from "vitest";
import {
  capUtf8,
  fitMessageBudget,
  MESSAGE_BYTE_BUDGET,
  safeStorageType,
  senderAuthentication,
  utf8Length,
  chooseSentAt,
  compareHistoryIds,
  decideIngest,
  isIgnoredDomain,
  isReplyToOutsider,
  laterCursor,
  syncBackoffMs,
  type IngestFacts,
} from "../syncModel";

const NO_SIGNALS = { drop: false, list: false, reasons: [] };
const base: IngestFacts = {
  labelIds: ["INBOX"],
  signals: NO_SIGNALS,
  outbound: false,
  teamSender: false,
  senderVerified: true,
  senderIsParticipant: false,
  alreadyStored: false,
  appSent: false,
  ignoredDomain: false,
  knownClientSender: true,
  trackedThread: false,
  mailboxOwnerIsAdmin: false,
};
const decide = (f: Partial<IngestFacts>) => decideIngest({ ...base, ...f });

describe("decideIngest (D24)", () => {
  it.each([
    ["already stored", { alreadyStored: true }, { store: false, reason: "duplicate" }],
    ["archived only / draft", { labelIds: ["DRAFT"] }, { store: false, reason: "not_inbox" }],
    ["Promotions", { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }, { store: false, reason: "label" }],
    ["Spam", { labelIds: ["SPAM"] }, { store: false, reason: "not_inbox" }],
    ["Trash on a sent copy", { labelIds: ["SENT", "TRASH"], outbound: true }, { store: false, reason: "label" }],
    ["our app send", { outbound: true, labelIds: ["SENT"], appSent: true, trackedThread: true }, { store: false, reason: "app_sent" }],
    ["our auto-reply", { outbound: true, labelIds: ["SENT"], trackedThread: true, signals: { drop: true, list: false, reasons: ["auto_submitted:auto-replied"] } }, { store: false, reason: "bulk" }],
    ["our reply on a tracked thread", { outbound: true, labelIds: ["SENT"], trackedThread: true }, { store: true, direction: "outbound", unknownSender: false }],
    ["our mail elsewhere", { outbound: true, labelIds: ["SENT"] }, { store: false, reason: "untracked_outbound" }],
    ["ignored domain", { ignoredDomain: true }, { store: false, reason: "ignored_domain" }],
    ["bulk from a client", { signals: { drop: true, list: false, reasons: ["precedence:bulk"] } }, { store: false, reason: "bulk" }],
    ["list headers from a client (Google Group)", { signals: { drop: false, list: true, reasons: ["list_id"] } }, { store: true, direction: "inbound", unknownSender: false }],
    ["list headers from a stranger", { knownClientSender: false, mailboxOwnerIsAdmin: true, signals: { drop: false, list: true, reasons: ["list_id"] } }, { store: false, reason: "bulk" }],
    ["known client", {}, { store: true, direction: "inbound", unknownSender: false }],
    ["tracked thread, unknown sender, member mailbox (M2)", { knownClientSender: false, trackedThread: true }, { store: false, reason: "unknown_sender_member" }],
    ["tracked thread, a participant, member mailbox (M2)", { knownClientSender: false, trackedThread: true, senderIsParticipant: true }, { store: true, direction: "inbound", unknownSender: false }],
    ["tracked thread, unknown sender, admin mailbox", { knownClientSender: false, trackedThread: true, mailboxOwnerIsAdmin: true }, { store: true, direction: "inbound", unknownSender: true }],
    ["unauthenticated client address, member mailbox (M1)", { senderVerified: false }, { store: false, reason: "unknown_sender_member" }],
    ["unauthenticated client address, admin mailbox (M1)", { senderVerified: false, mailboxOwnerIsAdmin: true }, { store: true, direction: "inbound", unknownSender: true }],
    ["unauthenticated participant, member mailbox", { senderVerified: false, knownClientSender: false, trackedThread: true, senderIsParticipant: true }, { store: false, reason: "unknown_sender_member" }],
    ["a colleague in the inbox, authenticated", { teamSender: true, knownClientSender: false }, { store: false, reason: "internal" }],
    ["a forged colleague, admin mailbox (M3)", { teamSender: true, knownClientSender: false, senderVerified: false, mailboxOwnerIsAdmin: true, trackedThread: true, senderIsParticipant: true }, { store: true, direction: "inbound", unknownSender: true }],
    ["a forged colleague, member mailbox (M3)", { teamSender: true, knownClientSender: false, senderVerified: false, trackedThread: true, senderIsParticipant: true }, { store: false, reason: "unknown_sender_member" }],
    ["unknown sender, admin mailbox", { knownClientSender: false, mailboxOwnerIsAdmin: true }, { store: true, direction: "inbound", unknownSender: true }],
    ["unknown sender, member mailbox (I13)", { knownClientSender: false }, { store: false, reason: "unknown_sender_member" }],
  ] as const)("%s", (_label, facts, expected) => {
    expect(decide(facts as Partial<IngestFacts>)).toEqual(expected);
  });
});

describe("helpers", () => {
  it("ignored domains match subdomains, never a suffix of another name", () => {
    expect(isIgnoredDomain("mail.vendor.example", ["vendor.example"])).toBe(true);
    expect(isIgnoredDomain("vendor.example", ["@Vendor.Example"])).toBe(true);
    expect(isIgnoredDomain("notvendor.example", ["vendor.example"])).toBe(false);
    expect(isIgnoredDomain("", ["vendor.example"])).toBe(false);
  });

  it("D33 needs a recipient outside the team", () => {
    const team = (e: string) => e.endsWith("@konverted.io");
    expect(isReplyToOutsider([{ email: "bence@konverted.io" }], team)).toBe(false);
    expect(isReplyToOutsider([{ email: "bence@konverted.io" }, { email: "Reka@Pragmatico.hu" }], team)).toBe(true);
  });

  it("history ids compare as big decimals; the cursor never moves back", () => {
    expect(compareHistoryIds("99999999999999999999", "100000000000000000000")).toBe(-1);
    expect(compareHistoryIds("42", "42")).toBe(0);
    expect(laterCursor("100", "99")).toBe("100");
    expect(laterCursor("100", "101")).toBe("101");
    expect(laterCursor(undefined, "5")).toBe("5");
    expect(laterCursor("5", "")).toBe("5");
    expect(laterCursor(undefined, "abc")).toBeUndefined();
  });

  it("sentAt: the Date header unless missing or in the future; then Gmail's internalDate", () => {
    const now = 1_000_000_000_000;
    expect(chooseSentAt(now - 5_000, now - 1_000, now)).toBe(now - 5_000);
    expect(chooseSentAt(null, now - 1_000, now)).toBe(now - 1_000);
    expect(chooseSentAt(now + 3 * 86_400_000, now - 1_000, now)).toBe(now - 1_000);
    expect(chooseSentAt(null, null, now)).toBe(now);
  });

  it("backoff grows for transient / quota and waits for a reconnect otherwise", () => {
    expect(syncBackoffMs("transient", 1)).toBe(60_000);
    expect(syncBackoffMs("transient", 3)).toBe(240_000);
    expect(syncBackoffMs("quota", 1)).toBe(120_000);
    expect(syncBackoffMs("unknown", 20)).toBe(30 * 60_000);
    expect(syncBackoffMs("disconnected", 1)).toBeNull();
    expect(syncBackoffMs("permission", 1)).toBeNull();
  });
});

describe("sender authentication (M1)", () => {
  const ar = (value: string) => [{ name: "Authentication-Results", value }];
  it("DMARC pass, aligned DKIM or SPF pass verify; a fail, a foreign verdict or none do not", () => {
    expect(senderAuthentication(ar("mx.google.com; dkim=pass header.i=@pragmatico.hu; spf=pass smtp.mailfrom=reka@pragmatico.hu; dmarc=pass (p=NONE) header.from=pragmatico.hu"), "reka@pragmatico.hu")).toEqual({ verified: true, dmarc: "pass" });
    expect(senderAuthentication(ar("mx.google.com; dkim=pass header.i=@mail.pragmatico.hu"), "reka@pragmatico.hu").verified).toBe(true);
    expect(senderAuthentication(ar("mx.google.com; spf=pass smtp.mailfrom=bounce@pragmatico.hu"), "reka@pragmatico.hu").verified).toBe(true);
    // A pass for another domain is not alignment.
    expect(senderAuthentication(ar("mx.google.com; dkim=pass header.i=@evil.example; spf=pass smtp.mailfrom=x@evil.example"), "reka@pragmatico.hu").verified).toBe(false);
    // A forged From: DMARC fail wins even with an unaligned pass.
    expect(senderAuthentication(ar("mx.google.com; dkim=pass header.i=@pragmatico.hu; dmarc=fail (p=REJECT) header.from=pragmatico.hu"), "reka@pragmatico.hu")).toEqual({ verified: false, dmarc: "fail" });
    // Only Gmail's own header counts.
    expect(senderAuthentication(ar("evil.example; dmarc=pass header.from=pragmatico.hu"), "reka@pragmatico.hu").verified).toBe(false);
    expect(senderAuthentication([], "reka@pragmatico.hu").verified).toBe(false);
  });
});

describe("byte budget (H2)", () => {
  it("a large CJK body fits the budget; never splits a character", () => {
    const cjk = "漢字かな交じり文".repeat(60_000); // ~1.4 MB of UTF-8
    const fit = fitMessageBudget({
      subject: "件名".repeat(5_000),
      from: { name: "送信者", email: "a@b.jp" },
      to: Array.from({ length: 9_000 }, (_, i) => ({ email: `u${i}@x.jp`, name: "名前".repeat(200) })),
      cc: [],
      bodyText: cjk,
      bodyHtml: `<p>${cjk}</p>`,
      attachments: [{ name: "ファイル".repeat(500) }],
    });
    const total =
      utf8Length(fit.subject) + utf8Length(fit.bodyText) + utf8Length(fit.bodyHtml) +
      fit.to.reduce((n, a) => n + utf8Length(a.email) + utf8Length(a.name ?? ""), 0) + utf8Length(fit.attachments[0].name);
    expect(total).toBeLessThan(MESSAGE_BYTE_BUDGET);
    expect(fit.to).toHaveLength(100);
    expect(fit.toOverflow).toBe(8_900);
    expect(utf8Length(fit.subject)).toBeLessThanOrEqual(2_000);
    expect(fit.bodyText.length).toBeGreaterThan(0);
    expect(fit.bodyText.endsWith("\ufffd")).toBe(false);
  });

  it("capUtf8 cuts on character boundaries (surrogate pairs included)", () => {
    expect(capUtf8("ab😀cd", 5)).toBe("ab");
    expect(capUtf8("ab😀cd", 6)).toBe("ab😀");
    expect(capUtf8("őű", 3)).toBe("ő");
    expect(utf8Length("ő😀")).toBe(6);
  });
});

describe("attachment content types (L6)", () => {
  it("active types are stored as a plain download", () => {
    expect(safeStorageType("text/html")).toBe("application/octet-stream");
    expect(safeStorageType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeStorageType("application/xhtml+xml")).toBe("application/octet-stream");
    expect(safeStorageType("not a type")).toBe("application/octet-stream");
    expect(safeStorageType("application/pdf")).toBe("application/pdf");
    expect(safeStorageType("image/PNG")).toBe("image/png");
  });
});

