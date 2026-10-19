import type { CheckCompletenessOutput, ClassifyInboundOutput, ScreenSenderOutput } from "./jobs";

/**
 * DEV-ONLY canned model outputs for the seeded canvas messages
 * (convex/devSeedEmail.ts), so the pipeline can be demoed without AI credit:
 *
 *   npx convex run devSeedEmail:seed '{}'
 *   npx convex run devSeedEmail:process '{"fakeModel":true}'
 *
 * `classify.classifyMessage` uses these ONLY for a message in a `devSeed`
 * mailbox when `fakeModel: true` was passed; everything else (the
 * deterministic layer, the ledger write with its verbatim check, dispatch)
 * runs for real. Keyed by the seed's `gmailMessageId`. Constraint values are
 * copied from the seed bodies, so the verbatim check passes.
 */

export type FakeModelOutputs = {
  screen: ScreenSenderOutput;
  classify: ClassifyInboundOutput;
  completeness: CheckCompletenessOutput;
};

const NO_ACTION = { hasAction: false, action: null } as const;

const CANNED: Readonly<Record<string, Omit<FakeModelOutputs, "screen"> & { screen?: ScreenSenderOutput }>> = {
  "seed-reka-black-friday-1": {
    classify: {
      intents: ["add"],
      requests: [
        {
          text: "Bannerek két méretben: 1200×628 és 1080×1920.",
          constraints: [
            { kind: "size", value: "1200×628" },
            { kind: "size", value: "1080×1920" },
            { kind: "deadline", value: "Jövő szerdáig" },
          ],
          intent: "add",
          refersToRequestId: null,
        },
        {
          text: "A 20% kedvezmény csak a webshopra vonatkozik, az üzletekre nem – ezt kérnénk a bannereken is jelezni.",
          constraints: [
            { kind: "discount", value: "20%" },
            { kind: "scope", value: "csak a webshopra" },
          ],
          intent: "add",
          refersToRequestId: null,
        },
        {
          text: "A landing oldalra kellene egy visszaszámláló, ami péntek éjfélig fut.",
          constraints: [{ kind: "deadline", value: "péntek éjfélig" }],
          intent: "add",
          refersToRequestId: null,
        },
        {
          text: "Egy hírlevél a meglévő feliratkozóknak, a bannerek vizuáljával.",
          constraints: [],
          intent: "add",
          refersToRequestId: null,
        },
        {
          text: "És még egy story méret is kellene az Instagramra.",
          constraints: [{ kind: "platform", value: "Instagramra" }],
          intent: "add",
          refersToRequestId: null,
        },
      ],
      approveHasAction: NO_ACTION,
      reasons: ["5 requests: banners in 2 sizes, 20% note, countdown, newsletter, story size", "Due: jövő szerdáig"],
      urgent: false,
    },
    completeness: { missing: [] },
  },
  // B6b: Réka's follow-up after Create (devSeedEmail:followUp) — a change on the created task.
  "seed-reka-black-friday-2": {
    classify: {
      intents: ["add"],
      requests: [
        {
          text: "És kérnénk egy story méretet is a Facebookra.",
          constraints: [{ kind: "platform", value: "Facebookra" }],
          intent: "add",
          refersToRequestId: null,
        },
      ],
      approveHasAction: NO_ACTION,
      reasons: ["One more request on the Black Friday task: a story size for Facebook"],
      urgent: false,
    },
    completeness: { missing: [] },
  },
  "seed-gabor-price-bug-1": {
    classify: {
      intents: ["add"],
      requests: [
        {
          text: "Élesben hibás az ár a Téli kabát termékoldalon: 89 990 Ft helyett 8 999 Ft jelenik meg, és a kosárba is így kerül be.",
          constraints: [
            { kind: "price", value: "89 990 Ft" },
            { kind: "price", value: "8 999 Ft" },
            { kind: "link", value: "https://pragmatico.hu/termek/teli-kabat" },
          ],
          intent: "add",
          refersToRequestId: null,
        },
      ],
      approveHasAction: NO_ACTION,
      reasons: ["Live price bug on the Téli kabát page — orders already came in at the wrong price"],
      urgent: true,
    },
    completeness: { missing: [] },
  },
  "seed-peter-question-3": {
    classify: {
      intents: ["ask"],
      requests: [
        {
          text: "Mikorra lesz kész? A jövő heti kampányindításhoz kellene tudnunk.",
          constraints: [{ kind: "deadline", value: "jövő heti kampányindításhoz" }],
          intent: "ask",
          refersToRequestId: null,
        },
      ],
      approveHasAction: NO_ACTION,
      reasons: ["Asks when the page will be ready (for next week's launch)"],
      urgent: false,
    },
    completeness: { missing: [] },
  },
  "seed-judit-new-sender-1": {
    screen: { possibleClient: true, reason: "A referred company asking for a webshop rebrand and a monthly newsletter" },
    classify: {
      intents: ["add", "ask"],
      requests: [
        {
          text: "egy kisebb webshop arculatfrissítést és havi hírlevelet szeretnénk kiszervezni",
          constraints: [],
          intent: "add",
          refersToRequestId: null,
        },
        {
          text: "Tudnának egy rövid egyeztetést javasolni jövő hétre?",
          constraints: [{ kind: "date", value: "jövő hétre" }],
          intent: "ask",
          refersToRequestId: null,
        },
      ],
      approveHasAction: NO_ACTION,
      reasons: ["New sender (Zöldkert Kft.): webshop rebrand + monthly newsletter, asks for a call"],
      urgent: false,
    },
    completeness: { missing: [] },
  },
};

const FALLBACK: FakeModelOutputs = {
  screen: { possibleClient: true, reason: "Fake model: no canned answer" },
  classify: {
    intents: [],
    requests: [],
    approveHasAction: NO_ACTION,
    reasons: ["Fake model: no canned answer for this message"],
    urgent: false,
  },
  completeness: { missing: [] },
};

/** The canned outputs of one seeded message (a neutral fallback for any other). */
export function fakeModelOutputs(gmailMessageId: string): FakeModelOutputs {
  const canned = CANNED[gmailMessageId];
  if (!canned) return FALLBACK;
  return { screen: canned.screen ?? FALLBACK.screen, classify: canned.classify, completeness: canned.completeness };
}
