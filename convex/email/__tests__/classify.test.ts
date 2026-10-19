// Email triage B4 — the pure parts of classification and dispatch
// (docs/prd-email-triage.md §5.3, §6.3, D27): the §5.3 table row by row,
// merging the model outputs, the verbatim constraint check, new-recipient
// detection and the snooze presets.

import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import {
  acknowledgeClassification,
  constraintWarnings,
  deterministicLayer,
  hasNewRecipient,
  mergeModelOutputs,
} from "../classify";
import { decideDispatch, type DispatchFacts } from "../triage";
import { snoozeUntil } from "../../agentItems";
import { EMAIL_LLM_JOBS, EMAIL_TRIAGE_MODEL } from "../jobs";
import { AGENT_JOBS } from "../../lib/agentJobs";
import { parseModelSlug } from "../../../lib/agents/modelSlug";
import type { ClassifyInboundOutput } from "../jobs";

const TASK = "task_1" as Id<"tasks">;

const facts = (f: Partial<DispatchFacts>): DispatchFacts => ({
  knownSender: true,
  mailboxOwnerIsAdmin: true,
  linked: null,
  intents: [],
  triggers: [],
  approveHasAction: false,
  ...f,
});
const linked = (workflowRole?: string) => ({ linked: { taskId: TASK, workflowRole } });

describe("decideDispatch (§5.3)", () => {
  it.each([
    ["unlinked · add", facts({ intents: ["add"] }), { action: "item", kind: "request", status: "open" }],
    ["unlinked · no clear intent", facts({}), { action: "item", kind: "request", status: "open" }],
    ["unlinked · no clear intent + trigger", facts({ triggers: ["word:kérnénk"] }), { action: "item", kind: "needs_look", status: "open" }],
    ["unlinked · clarify", facts({ intents: ["clarify"] }), { action: "item", kind: "request", status: "open" }],
    ["unlinked · ask only", facts({ intents: ["ask"] }), { action: "item", kind: "question", status: "open" }],
    ["unlinked · ask + thanks", facts({ intents: ["ask", "acknowledge"] }), { action: "item", kind: "question", status: "open" }],
    ["unlinked · acknowledge, no trigger", facts({ intents: ["acknowledge"] }), { action: "no_action" }],
    ["unlinked · acknowledge + trigger", facts({ intents: ["acknowledge"], triggers: ["link"] }), { action: "item", kind: "needs_look", status: "open" }],
    ["linked · add", facts({ ...linked(), intents: ["add"] }), { action: "item", kind: "change", status: "open", taskId: TASK }],
    ["linked · replace", facts({ ...linked(), intents: ["replace"] }), { action: "item", kind: "change", status: "open", taskId: TASK }],
    ["linked · cancel", facts({ ...linked(), intents: ["cancel"] }), { action: "item", kind: "change", status: "open", taskId: TASK }],
    ["linked · approve with action", facts({ ...linked("client_review"), intents: ["approve"], approveHasAction: true }), { action: "item", kind: "change", status: "open", taskId: TASK }],
    ["linked · ask only", facts({ ...linked(), intents: ["ask"] }), { action: "item", kind: "question", status: "open", taskId: TASK }],
    ["linked client_review · approve", facts({ ...linked("client_review"), intents: ["approve"] }), { action: "item", kind: "approval", status: "open", taskId: TASK }],
    ["linked client_review · approve + trigger word", facts({ ...linked("client_review"), intents: ["approve", "acknowledge"], triggers: ["word:mehet"] }), { action: "item", kind: "approval", status: "open", taskId: TASK }],
    ["linked elsewhere · approve, no trigger", facts({ ...linked("admin_review"), intents: ["approve"] }), { action: "no_action" }],
    ["linked · acknowledge, no trigger", facts({ ...linked(), intents: ["acknowledge"] }), { action: "no_action" }],
    ["linked · approve + trigger", facts({ ...linked(), intents: ["approve"], triggers: ["question_mark"] }), { action: "item", kind: "needs_look", status: "open", taskId: TASK }],
    ["linked · nothing recognised", facts({ ...linked() }), { action: "item", kind: "needs_look", status: "open", taskId: TASK }],
    ["unknown · admin mailbox · possible client", facts({ knownSender: false, senderScreen: { possibleClient: true } }), { action: "item", kind: "new_sender", status: "open" }],
    ["unknown · admin mailbox · not a request", facts({ knownSender: false, senderScreen: { possibleClient: false } }), { action: "item", kind: "new_sender", status: "filtered" }],
    ["unknown · admin mailbox · pure thanks (no screen)", facts({ knownSender: false, intents: ["acknowledge"] }), { action: "item", kind: "new_sender", status: "filtered" }],
    ["unknown · member mailbox", facts({ knownSender: false, mailboxOwnerIsAdmin: false, intents: ["add"] }), { action: "nothing", reason: "unknown sender in a member's mailbox" }],
  ] as const)("%s", (_name, input, expected) => {
    expect(decideDispatch(input)).toEqual(expected);
  });
});

const classifyOut = (partial: Partial<ClassifyInboundOutput>): ClassifyInboundOutput => ({
  intents: [],
  requests: [],
  approveHasAction: { hasAction: false, action: null },
  reasons: [],
  urgent: false,
  ...partial,
});

describe("mergeModelOutputs", () => {
  it("appends completeness rows, drops exact duplicates, folds intents", () => {
    const r = mergeModelOutputs({
      classify: classifyOut({
        intents: ["add"],
        requests: [{ text: "Két  banner", constraints: [{ kind: "Size", value: " 1200×628 " }], intent: "add", refersToRequestId: null }],
        reasons: ["2 banners"],
      }),
      completeness: {
        missing: [
          { text: "két banner", constraints: [], intent: "add", refersToRequestId: null },
          { text: "Mikor kész?", constraints: [], intent: "ask", refersToRequestId: "x" },
        ],
      },
      urgentPhrase: null,
      source: "model",
    });
    expect(r.requests).toEqual([
      { text: "Két banner", constraints: [{ kind: "size", value: "1200×628" }], intent: "add", refersToRequestId: null },
      { text: "Mikor kész?", constraints: [], intent: "ask", refersToRequestId: null },
    ]);
    expect(r.intents).toEqual(["add", "ask"]);
    expect(r).toMatchObject({ reasons: ["2 banners"], urgent: false, source: "model" });
  });

  it("an approve with an action becomes a ledger row; urgency ORs the deterministic phrase", () => {
    const r = mergeModelOutputs({
      classify: classifyOut({ intents: ["approve"], approveHasAction: { hasAction: true, action: "Élesítés" } }),
      completeness: { missing: [] },
      urgentPhrase: "minel elobb",
      source: "fake",
    });
    expect(r.requests).toEqual([{ text: "Élesítés", constraints: [], intent: "approve" }]);
    expect(r).toMatchObject({ intents: ["approve"], approveAction: "Élesítés", urgent: true });
    expect(r.reasons).toEqual(["1 request(s)"]);
  });

  it("the deterministic acknowledge has no requests", () => {
    expect(acknowledgeClassification()).toMatchObject({ intents: ["acknowledge"], requests: [], source: "rules" });
  });
});

describe("constraintWarnings (verbatim, whitespace-normalised)", () => {
  it("flags only values found in neither the request text nor the email", () => {
    const email = "Kérnénk bannert 1200×628\nméretben, 20% kedvezménnyel.";
    expect(
      constraintWarnings(
        {
          text: "Banner",
          constraints: [
            { kind: "size", value: "1200×628 méretben" }, // spans a line break
            { kind: "size", value: "1200x628" },
            { kind: "discount", value: "20%" },
            { kind: "note", value: "only in text" },
          ],
        },
        email,
      ),
    ).toEqual([{ kind: "constraint_not_verbatim", detail: "size: 1200x628" }, { kind: "constraint_not_verbatim", detail: "note: only in text" }]);
    expect(constraintWarnings({ text: "only in text", constraints: [{ kind: "note", value: "only in text" }] }, email)).toEqual([]);
  });
});

describe("deterministic layer", () => {
  it("a thank-you is acknowledge; a trigger forbids it", () => {
    expect(deterministicLayer({ text: "Köszönjük!", hasAttachment: false, newRecipient: false })).toEqual({
      triggers: [], acknowledge: true, urgentPhrase: null,
    });
    expect(deterministicLayer({ text: "Köszönjük!", hasAttachment: true, newRecipient: false })).toMatchObject({
      triggers: ["attachment"], acknowledge: false,
    });
    expect(deterministicLayer({ text: "Köszi!", hasAttachment: false, newRecipient: true }).acknowledge).toBe(false);
  });

  it("reads the subject too; a forward is never a rules acknowledge", () => {
    expect(deterministicLayer({ text: "Köszi!", subject: "Re: Szeptemberi riport", hasAttachment: false, newRecipient: false }))
      .toMatchObject({ triggers: [], acknowledge: true });
    expect(deterministicLayer({ text: "Köszi!", subject: "SÜRGŐS: rossz ár", hasAttachment: false, newRecipient: false }))
      .toMatchObject({ triggers: ["word:sürgős"], acknowledge: false, urgentPhrase: "surgos" });
    for (const subject of ["FW: Árlista", "Fwd: Árlista", "Továbbítás: Árlista", "TR: Árlista", "VS: Árlista", "RE: FW: Árlista"]) {
      expect(deterministicLayer({ text: "Köszi!", subject, hasAttachment: false, newRecipient: false }), subject)
        .toMatchObject({ triggers: ["forward"], acknowledge: false });
    }
  });

  it("detects a new recipient only against earlier messages", () => {
    const a = (email: string) => ({ email });
    const history = [{ from: a("reka@p.hu"), to: [a("us@agency.test")], cc: [] }];
    expect(hasNewRecipient({ to: [a("us@agency.test")], cc: [] }, history)).toBe(false);
    expect(hasNewRecipient({ to: [a("us@agency.test")], cc: [a("boss@p.hu")] }, history)).toBe(true);
    expect(hasNewRecipient({ to: [a("anyone@x.hu")], cc: [] }, [])).toBe(false);
  });
});

describe("snoozeUntil (D27, org timezone)", () => {
  const tz = "Europe/Budapest";
  // Wednesday 2026-10-21 14:00 Budapest (CEST, UTC+2).
  const wed = Date.UTC(2026, 9, 21, 12, 0);
  it("tomorrow 9:00, next Monday 9:00, a picked date 9:00", () => {
    expect(new Date(snoozeUntil("tomorrow", wed, tz)).toISOString()).toBe("2026-10-22T07:00:00.000Z");
    expect(new Date(snoozeUntil("next_monday", wed, tz)).toISOString()).toBe("2026-10-26T08:00:00.000Z"); // CET after DST
    expect(new Date(snoozeUntil("date", wed, tz, "2026-11-02")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });
  it("on a Monday, next Monday is a week later; past or malformed dates are refused", () => {
    const mon = Date.UTC(2026, 9, 19, 6, 0); // Monday 08:00 Budapest
    expect(new Date(snoozeUntil("next_monday", mon, tz)).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(() => snoozeUntil("date", wed, tz, "2026-10-21")).toThrow("future"); // 9:00 today already passed
    expect(() => snoozeUntil("date", wed, tz, "21/10/2026")).toThrow("YYYY-MM-DD");
    expect(() => snoozeUntil("date", wed, tz)).toThrow("YYYY-MM-DD");
  });
});

describe("email llm_step jobs", () => {
  it("are registered on the cheap allowlisted model", () => {
    expect(parseModelSlug(EMAIL_TRIAGE_MODEL).anthropicModelId).toBe("claude-haiku-4-5");
    for (const job of Object.values(EMAIL_LLM_JOBS)) {
      expect(AGENT_JOBS[job.name]).toBe(job);
      expect(job).toMatchObject({ tier: "llm_step", model: EMAIL_TRIAGE_MODEL });
      expect(job.instructions).toContain("untrusted DATA");
    }
  });
});
