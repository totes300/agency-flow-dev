// Email triage B4 — classification fixtures (docs/prd-email-triage.md §8):
// ≥ 30 real-shaped Hungarian (and a few English) inbound emails.
//
//   - Deterministic layer (always, in CI): quote stripping → hard triggers →
//     the acknowledge shortcut. A pure thank-you is acknowledged with NO
//     request; nothing else is ever acknowledged silently; the expected
//     triggers fire (and quoted history never triggers).
//   - Model layer (opt-in: EMAIL_MODEL_FIXTURES=1 plus ANTHROPIC_API_KEY):
//     classifyInbound + checkCompleteness on the real model for every fixture
//     the shortcut does not settle; checks request recall and that no real
//     request is classified as acknowledge. Skipped by default (costs credit).

import { describe, expect, it } from "vitest";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { stripQuoted } from "../model";
import { acknowledgeClassification, deterministicLayer, mergeModelOutputs } from "../classify";
import { checkCompletenessJob, classifyInboundJob, type Intent } from "../jobs";
import { runLlmStep } from "../../lib/agentJobs";
import fixtures from "./fixtures/inbound-hu.json";

type Fixture = {
  id: string;
  category: string;
  subject: string;
  body: string;
  hasAttachment?: boolean;
  expect: {
    acknowledgeShortcut: boolean;
    triggers?: string[];
    absentTriggers?: string[];
    noTriggers?: boolean;
    urgent?: boolean;
    minRequests?: number;
    intents?: Intent[];
  };
};

const FIXTURES = fixtures as Fixture[];

function deterministic(f: Fixture) {
  const text = stripQuoted(f.body, { subject: f.subject }).text;
  return {
    text,
    layer: deterministicLayer({ text, subject: f.subject, hasAttachment: f.hasAttachment === true, newRecipient: false }),
  };
}

describe("inbound fixtures — deterministic layer", () => {
  it("has at least 30 fixtures, with unique ids, covering every intent", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
    const categories = new Set(FIXTURES.map((f) => f.category));
    for (const c of ["thanks", "request", "clarify", "replace", "cancel", "approve", "approve_action", "ask", "acknowledge_model", "needs_look", "forward"]) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it.each(FIXTURES.map((f) => [f.id, f] as const))("%s", (_id, f) => {
    const { text, layer } = deterministic(f);
    // A forward keeps the forwarded mail (its request is the content).
    if (f.category === "forward") expect(text.split("\n").length).toBeGreaterThan(3);
    expect(layer.acknowledge).toBe(f.expect.acknowledgeShortcut);
    for (const trigger of f.expect.triggers ?? []) expect(layer.triggers).toContain(trigger);
    for (const trigger of f.expect.absentTriggers ?? []) expect(layer.triggers).not.toContain(trigger);
    if (f.expect.noTriggers) expect(layer.triggers).toEqual([]);
    if (f.expect.urgent) expect(layer.urgentPhrase).not.toBeNull();
  });

  it("a thank-you never produces a request; nothing else passes as a silent acknowledge", () => {
    for (const f of FIXTURES) {
      const { layer } = deterministic(f);
      if (f.category === "thanks") {
        expect(layer.acknowledge, f.id).toBe(true);
        expect(acknowledgeClassification().requests, f.id).toEqual([]);
      } else {
        expect(layer.acknowledge, f.id).toBe(false);
      }
    }
  });
});

// ─── Model layer (opt-in) ────────────────────────────────────────────────────

const MODEL_ON = process.env.EMAIL_MODEL_FIXTURES === "1";

/** The two things runLlmStep needs from an action: the org key and the audit write. */
function fixtureCtx(): ActionCtx {
  const ctx = {
    runQuery: async () => process.env.ANTHROPIC_API_KEY ?? null,
    runMutation: async () => "fixture_job_run" as Id<"agentJobRuns">,
  };
  return ctx as unknown as ActionCtx;
}

describe.skipIf(!MODEL_ON)("inbound fixtures — model layer (EMAIL_MODEL_FIXTURES=1)", () => {
  const modelFixtures = FIXTURES.filter((f) => !deterministic(f).layer.acknowledge);

  it(
    "request recall and acknowledge precision",
    async () => {
      const ctx = fixtureCtx();
      let expectedRequests = 0;
      let foundRequests = 0;
      const misses: string[] = [];
      for (const f of modelFixtures) {
        const { text, layer } = deterministic(f);
        const prompt = {
          clientName: "Pragmatico",
          message: {
            from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
            subject: f.subject,
            sentAt: "2026-10-16T13:12:00.000Z",
            text,
            attachments: f.hasAttachment ? [{ name: "anyag.pdf", mime: "application/pdf", summary: null, text: null }] : [],
          },
          threadHistory: [],
          linkedTask: null,
          ledger: [],
          hardTriggers: layer.triggers,
        };
        const classify = await runLlmStep(ctx, { job: classifyInboundJob, orgId: "fixtures", input: prompt });
        const completeness = await runLlmStep(ctx, {
          job: checkCompletenessJob,
          orgId: "fixtures",
          input: {
            message: { subject: f.subject, text, attachments: prompt.message.attachments.map((a) => a.name) },
            extracted: classify.requests.map((r) => ({ text: r.text, constraints: r.constraints, intent: r.intent })),
          },
        });
        const result = mergeModelOutputs({ classify, completeness, urgentPhrase: layer.urgentPhrase, source: "model" });
        if (f.expect.minRequests) {
          expectedRequests += f.expect.minRequests;
          foundRequests += Math.min(result.requests.length, f.expect.minRequests);
          // Acknowledge precision: a real request is never acknowledge-only.
          const ackOnly = result.intents.length > 0 && result.intents.every((i) => i === "acknowledge");
          if (ackOnly) misses.push(`${f.id}: classified acknowledge`);
        }
        if (f.expect.intents && !f.expect.intents.some((i) => result.intents.includes(i))) {
          misses.push(`${f.id}: intents ${JSON.stringify(result.intents)}, expected one of ${JSON.stringify(f.expect.intents)}`);
        }
      }
      const recall = expectedRequests === 0 ? 1 : foundRequests / expectedRequests;
      console.info(`[email fixtures] request recall ${(recall * 100).toFixed(1)} % over ${modelFixtures.length} fixtures`);
      expect(misses).toEqual([]);
      expect(recall).toBeGreaterThanOrEqual(0.98); // §8 release metric
    },
    10 * 60_000,
  );
});
