/**
 * The kickoff / reply email — pure rules (docs/prd-email-triage.md §6.1
 * "After Create: the kickoff reply", D19, D21; implementation plan B6b).
 * No Convex, no I/O: unit-tested in email/__tests__/kickoff.test.ts. The
 * Convex side (email/reply.ts) gathers the facts, hands them to the
 * `draftReply` run as its input, and checks the submitted draft with
 * `checkReplyDraft` before it is stored (`submitDraft`):
 *
 *   detectLanguage   D19: the client's language from the latest inbound text
 *   returnWording    "when we get back", computed in code from the earliest
 *                    subtask due: "today" · "within N working days" (N ≤ 2)
 *                    · the weekday ("by Wednesday" / "szerdáig") within a week
 *                    · the date ("by 28 October" / "október 28-ig")
 *   checkReplyDraft  what code can check of a draft: the return phrase is in
 *                    it verbatim, every answerable `ask` row is answered (in
 *                    `answersRequestIds`), the owner's client questions are a
 *                    numbered list, no price / estimate the client did not
 *                    write, no internal task identifier or team member name
 *
 * The model writes the prose; code decides the facts it may state.
 */

import { addCalendarDays, isWorkingDate, localDateOf, weekdayOf } from "../lib/workingDays";
import { foldText } from "./model";

export type ReplyLanguage = "hu" | "en";

const HU_WORDS = [
  "és", "hogy", "nem", "kellene", "kérnénk", "kérem", "köszi", "köszönöm", "köszönjük", "szia", "sziasztok",
  "üdvözlettel", "lesz", "mikor", "mikorra", "még", "jövő", "csak", "is", "egy", "vagy", "már", "kész",
];
const EN_WORDS = [
  "the", "and", "please", "thanks", "thank", "could", "would", "will", "when", "hi", "hello", "regards", "is", "are",
];

/**
 * D19: the language of a client message — Hungarian or English (the two our
 * clients write). Hungarian when it has ő / ű, or more Hungarian than English
 * function words; English otherwise. Accent-less Hungarian ("kernenk") counts.
 */
export function detectLanguage(text: string): ReplyLanguage {
  if (/[őűŐŰ]/.test(text)) return "hu";
  const words = foldText(text).split(/[^a-z]+/).filter(Boolean);
  const hu = new Set(HU_WORDS.map(foldText));
  const en = new Set(EN_WORDS);
  let huScore = 0;
  let enScore = 0;
  for (const w of words) {
    if (hu.has(w)) huScore++;
    if (en.has(w)) enScore++;
  }
  if (/[áéíóöúü]/i.test(text)) huScore += 2;
  return huScore > enScore ? "hu" : "en";
}

// ─── "When we get back" ──────────────────────────────────────────────────────

export type ReturnWording = {
  kind: "today" | "working_days" | "weekday" | "date";
  /** The phrase the email must contain verbatim ("szerdáig", "within 2 working days"). */
  text: string;
  /** The date it stands for (YYYY-MM-DD, org timezone). */
  date: string;
  /** Working days from today to `date` (0 = today). */
  workingDays: number;
};

const HU_WEEKDAY_UNTIL = ["vasárnapig", "hétfőig", "keddig", "szerdáig", "csütörtökig", "péntekig", "szombatig"];
const EN_WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HU_MONTH = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];
const EN_MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Working days after `from` up to and including `to` (both YYYY-MM-DD). */
export function workingDaysUntil(from: string, to: string): number {
  let n = 0;
  for (let d = addCalendarDays(from, 1); d <= to; d = addCalendarDays(d, 1)) {
    if (isWorkingDate(d)) n++;
    if (n > 400) break;
  }
  return n;
}

/**
 * §6.1 / D21: the "when we get back" phrase from the earliest subtask due
 * date — never more than the plan says:
 *   due today or earlier → "today" / "még ma";
 *   1–2 working days → "within N working day(s)" / "N munkanapon belül";
 *   later, within 6 calendar days → the weekday ("by Wednesday" / "szerdáig");
 *   later still → the date ("by 28 October" / "október 28-ig").
 */
export function returnWording(args: {
  earliestDue: string;
  nowMs: number;
  tz: string;
  language: ReplyLanguage;
}): ReturnWording {
  const today = localDateOf(args.nowMs, args.tz);
  const date = args.earliestDue;
  const hu = args.language === "hu";
  if (date <= today) return { kind: "today", text: hu ? "még ma" : "today", date, workingDays: 0 };
  const workingDays = workingDaysUntil(today, date);
  if (workingDays >= 1 && workingDays <= 2) {
    return {
      kind: "working_days",
      text: hu ? `${workingDays} munkanapon belül` : `within ${workingDays} working day${workingDays === 1 ? "" : "s"}`,
      date,
      workingDays,
    };
  }
  let calendarDays = 0;
  for (let d = today; d < date && calendarDays < 400; d = addCalendarDays(d, 1)) calendarDays++;
  if (calendarDays <= 6) {
    const day = weekdayOf(date);
    return { kind: "weekday", text: hu ? HU_WEEKDAY_UNTIL[day] : `by ${EN_WEEKDAY[day]}`, date, workingDays };
  }
  const month = Number(date.slice(5, 7)) - 1;
  const dayOfMonth = Number(date.slice(8, 10));
  return {
    kind: "date",
    text: hu ? `${HU_MONTH[month]} ${dayOfMonth}-ig` : `by ${dayOfMonth} ${EN_MONTH[month]}`,
    date,
    workingDays,
  };
}

/** The return sentence of a code-built (dev) draft: "Szerdáig jelentkezünk." / "We'll get back to you by Wednesday." */
export function returnSentence(w: ReturnWording, language: ReplyLanguage): string {
  if (language === "hu") return `${w.text.charAt(0).toUpperCase()}${w.text.slice(1)} jelentkezünk.`;
  return `We'll get back to you ${w.text}.`;
}

// ─── The facts a kickoff may state ───────────────────────────────────────────

export type KickoffFacts = {
  language: ReplyLanguage;
  /** The client contact's first name for the greeting, when known. */
  contactFirstName: string | null;
  /** Titles of the tasks we started (one sentence — not the subtask list). */
  started: string[];
  /** When we get back — null when the plan has no due date. */
  returnBy: ReturnWording | null;
  /** `ask` rows the email must answer now (their ids go into answersRequestIds). */
  answerable: Array<{ requestId: string; text: string; answerHint: string | null }>;
  /** The owner's questions to the client — one numbered list, shortest wording. */
  clientQuestions: Array<{ questionId: string; text: string }>;
};

/**
 * The client's first name from a contact name (`clientContacts.name` /
 * an email From name — free text, no structured parts). Hungarian names are
 * family-name first ("Kovács Réka" → "Réka"); English given-name first.
 * NEVER for a team member: their structured Clerk parts are known
 * (`memberFirstName`).
 */
export function firstNameOf(name: string | null | undefined, language: ReplyLanguage): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return language === "hu" ? parts[parts.length - 1] : parts[0];
}

/** A team member's name as stored on `users` (Clerk display name + parts). */
export type MemberName = { name: string; firstName?: string | null; lastName?: string | null };

const nameTokens = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/**
 * A team member's given name: Clerk's `firstName`, else the display name's
 * first token — Clerk builds it given-name first ("Adam Toth" → "Adam"),
 * whatever the team's language.
 */
export function memberFirstName(user: MemberName | null | undefined): string | null {
  if (!user) return null;
  return user.firstName?.trim() || nameTokens(user.name)[0] || null;
}

/**
 * The forms a team member's name appears in: the full name, the given name
 * and the family name (structured parts first; else the display name's
 * first / last token). `mentionsName` folds case, accents and Hungarian
 * suffixes when checking a draft, so these stay as written.
 */
export function memberNameForms(user: MemberName): string[] {
  const tokens = nameTokens(user.name);
  const first = memberFirstName(user);
  const last = user.lastName?.trim() || (tokens.length > 1 ? tokens[tokens.length - 1] : null);
  const full = user.name.trim();
  const forms = [full, first && last ? `${first} ${last}` : null, first, last];
  const seen = new Set<string>();
  return forms.filter((f): f is string => {
    if (!f) return false;
    const key = foldText(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The team-member names a client email must not carry (`doNotMention`):
 * every form of every member's name — except the sender's own forms (they
 * sign the email) and single names the client's own people share. Names
 * shorter than 3 letters are left out (`mentionsName` ignores them).
 */
export function internalTeamNames(args: {
  members: readonly MemberName[];
  sender: MemberName | null;
  clientNames: readonly string[];
}): string[] {
  const fold = (t: string) => foldText(t).replace(/\s+/g, " ").trim();
  const senderForms = new Set(args.sender ? memberNameForms(args.sender).map(fold) : []);
  const clientTokens = new Set(args.clientNames.flatMap(nameTokens).map(fold));
  const out = new Map<string, string>();
  for (const member of args.members) {
    const full = fold(member.name);
    for (const form of memberNameForms(member)) {
      const key = fold(form);
      if (key.length < 3 || senderForms.has(key)) continue;
      // A single name a client person also has ("Réka" on both sides) stays allowed.
      if (key !== full && !key.includes(" ") && clientTokens.has(key)) continue;
      if (!out.has(key)) out.set(key, form);
    }
  }
  return [...out.values()];
}

// ─── Checks on a submitted draft ─────────────────────────────────────────────

const normalize = (text: string) => text.replace(/[\s   ]+/g, " ").trim().toLowerCase();

const NUMBER = String.raw`\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const MULTIPLIER = String.raw`(?:\s?(?:ezer|e|k|millió|millio|milliárd|mrd|m))?`;
const CURRENCY = String.raw`(?:Ft|HUF|forint\p{L}*|EUR|euró\p{L}*|euro\p{L}*|USD|GBP|€|\$|£)`;
const MONEY_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:€|\$|£)\s?(?:${NUMBER})${MULTIPLIER}|(?:${NUMBER})${MULTIPLIER}\s?${CURRENCY})(?![\p{L}])`,
  "giu",
);

/**
 * Money amounts in a text: "89 990 Ft", "150 ezer forint", "2 millió Ft",
 * "150e HUF", "€120", "1.200 EUR", "$50", "120 euró". A bare number or a
 * percentage is not money.
 */
export function moneyAmounts(text: string): string[] {
  return [...text.matchAll(MONEY_RE)].map((m) => m[0].trim());
}

const WORD_NUMBER = String.raw`egy|két|kettő|három|négy|öt|hat|hét|nyolc|kilenc|tíz|fél|másfél|one|two|three|four|five|six|seven|eight|nine|ten|half an?`;
const EFFORT_UNIT = String.raw`h|óra\p{L}*|órá\p{L}*|munkaór\p{L}*|nap(?:ot|ig|nyi|os)?|embernap\p{L}*|hours?|hrs?|days?|man-?days?`;
const EFFORT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d+(?:[.,]\d+)?|${WORD_NUMBER})\s?(?:${EFFORT_UNIT})(?![\p{L}])`,
  "giu",
);

/**
 * Effort estimates in a text: "8h", "8 óra", "három óra", "2 nap", "3 hours",
 * "two days", "half a day". The return phrases code writes ("2 munkanapon
 * belül", "within 2 working days", "szerdáig") never match.
 */
export function effortEstimates(text: string): string[] {
  return [...text.matchAll(EFFORT_RE)].map((m) => m[0].trim());
}

/** Folded Hungarian case / postposition endings a name may carry ("Bencével", "Rékának", "Ádámmal"). */
const HU_NAME_SUFFIX = String.raw`(?:nak|nek|val|vel|nal|nel|hoz|hez|tol|rol|bol|ba|be|ban|ben|ra|re|on|en|n|t|ot|et|at|ert|ig|kent|e|ek|[a-z]?[ae]l)?`;

/**
 * Does `body` mention `name` — case- and accent-folded, also with a Hungarian
 * suffix on its stem (the final vowel lengthening folds away: Bence →
 * "Bencével", Réka → "Rékának")?
 */
export function mentionsName(body: string, name: string): boolean {
  const n = foldText(name.trim()).replace(/\s+/g, " ");
  if (n.length < 3) return false;
  const re = new RegExp(String.raw`(^|[^\p{L}])${escapeRe(n)}${HU_NAME_SUFFIX}(?![\p{L}])`, "u");
  return re.test(foldText(body).replace(/\s+/g, " "));
}

/** Lines of a numbered list ("1. …", "2) …"). */
export function numberedLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*\d{1,2}[.)]\s+\S/.test(line)).length;
}

export type ReplyDraftCheckInput = {
  mode: "kickoff" | "reply";
  bodyText: string;
  answersRequestIds: readonly string[];
  /** Kickoff: the facts code computed (return phrase, ask rows, client questions). */
  facts: KickoffFacts | null;
  /** Reply: ask rows the plan answers (their ids must be in answersRequestIds). */
  requiredAnswers?: ReadonlyArray<{ requestId: string; text: string }>;
  /** Every inbound text of the conversation (an amount the client wrote may be repeated). */
  inboundTexts: readonly string[];
  /** Task identifiers that must not appear (PRG-132 is internal). */
  internalIdentifiers: readonly string[];
  /** Team member names that must not appear (the sender's own name is allowed). */
  internalNames: readonly string[];
};

const quoteShort = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
};

/**
 * Code checks of a kickoff / reply draft (§6.1, D21). Returns model-actionable
 * errors; an empty list means the draft may be stored. Meaning (tone, the
 * answer's correctness) is the model's; these are the rules code can see.
 */
export function checkReplyDraft(input: ReplyDraftCheckInput): string[] {
  const errors: string[] = [];
  const body = input.bodyText;
  const flat = normalize(body);
  const answered = new Set(input.answersRequestIds);

  if (input.mode === "kickoff" && input.facts) {
    const f = input.facts;
    if (f.returnBy && !flat.includes(normalize(f.returnBy.text))) {
      errors.push(
        `Say when we get back with exactly this phrase: "${f.returnBy.text}" (it comes from the earliest due date — never promise more).`,
      );
    }
    if (f.clientQuestions.length > 0 && numberedLines(body) < f.clientQuestions.length) {
      errors.push(
        `Ask the client the owner's ${f.clientQuestions.length} question${f.clientQuestions.length === 1 ? "" : "s"} as ONE numbered list (1. … 2. …).`,
      );
    }
  }
  const required =
    input.mode === "kickoff" && input.facts
      ? input.facts.answerable.map((a) => ({ requestId: a.requestId, text: a.text }))
      : (input.requiredAnswers ?? []);
  for (const r of required) {
    if (!answered.has(r.requestId)) {
      errors.push(`Answer the client's question "${quoteShort(r.text)}" and put ${r.requestId} in answersRequestIds.`);
    }
  }

  const inbound = input.inboundTexts.map(normalize);
  const clientWrote = (value: string) => inbound.some((t) => t.includes(normalize(value)));
  for (const amount of moneyAmounts(body)) {
    if (!clientWrote(amount)) errors.push(`No prices unless the client asked: remove "${amount}".`);
  }
  for (const estimate of effortEstimates(body)) {
    if (!clientWrote(estimate)) errors.push(`No estimates: remove "${estimate}".`);
  }
  for (const id of input.internalIdentifiers) {
    if (id && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(id)}($|[^\\p{L}\\p{N}])`, "iu").test(body)) {
      errors.push(`"${id}" is an internal task identifier — don't put it in the email.`);
    }
  }
  for (const name of input.internalNames) {
    if (mentionsName(body, name)) errors.push(`"${name}" is a team member — no internal names in the email.`);
  }
  return errors;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
