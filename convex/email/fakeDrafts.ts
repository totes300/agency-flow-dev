import { returnSentence, returnWording, type KickoffFacts, type ReplyLanguage } from "./kickoff";

/**
 * DEV-ONLY canned kickoff / reply drafts for the seed conversations
 * (email/reply.ts `runFakeDraft`, the B6b twin of email/fakePlans.ts). The
 * body is built in code from the SAME facts a real `draftReply` run gets —
 * the return phrase computed from the plan's dues, the ask rows to answer,
 * the owner's client questions — and goes through the real `submitDraft`
 * checks, so the demo shows what the rules allow.
 */

/** Client-language wording of the seeded owner questions (the question rows are in English). */
const CLIENT_WORDING: Record<string, { hu: string; en: string }> = {
  Countdown: {
    hu: "Pontosan mikor járjon le a visszaszámláló — melyik pénteken és hány órakor?",
    en: "When exactly should the countdown end — which Friday, and at what time?",
  },
};

export type FakeQuestion = { questionId: string; header: string; text: string };

const greeting = (language: ReplyLanguage, name: string | null, formal: boolean) =>
  language === "hu" ? (name ? (formal ? `Kedves ${name}!` : `Szia ${name}!`) : "Kedves Ügyfelünk!") : name ? `Hi ${name},` : "Hello,";

const signOff = (language: ReplyLanguage, sender: string | null) =>
  language === "hu" ? `Üdvözlettel,\n${sender ?? "Az ügynökség"}` : `Best regards,\n${sender ?? "The agency"}`;

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
};

/** The kickoff (D21): thanks, what started, when we get back, answers, the owner's questions. */
export function fakeKickoffBody(args: {
  facts: KickoffFacts;
  questions: readonly FakeQuestion[];
  senderFirstName: string | null;
}): string {
  const { facts } = args;
  const hu = facts.language === "hu";
  const lines: string[] = [greeting(facts.language, facts.contactFirstName, true), ""];
  lines.push(hu ? "Köszönjük a levelet!" : "Thank you for your email!");
  if (facts.started.length > 0) {
    lines.push(hu ? `Elkezdtük a munkát: ${facts.started.join(", ")}.` : `We have started on it: ${facts.started.join(", ")}.`);
  }
  if (facts.returnBy) lines.push(returnSentence(facts.returnBy, facts.language));
  for (const a of facts.answerable) {
    lines.push(
      "",
      hu
        ? `Erre is válaszolunk: „${quote(a.text)}” — ${facts.returnBy ? `${facts.returnBy.text} ` : ""}visszajelzünk a részletekkel.`
        : `About "${quote(a.text)}": we'll come back with the details${facts.returnBy ? ` ${facts.returnBy.text}` : ""}.`,
    );
  }
  if (args.questions.length > 0) {
    lines.push("", hu ? "Pár kérdésünk lenne:" : "A few questions from our side:");
    args.questions.forEach((q, i) => {
      const wording = CLIENT_WORDING[q.header]?.[facts.language] ?? q.text;
      lines.push(`${i + 1}. ${wording}`);
    });
  }
  lines.push("", signOff(facts.language, args.senderFirstName));
  return lines.join("\n");
}

/** The reply to a question item (Q7): when the linked task's work is ready. */
export function fakeReplyBody(args: {
  language: ReplyLanguage;
  contactFirstName: string | null;
  senderFirstName: string | null;
  linkedDueDate: string | null;
  nowMs: number;
  tz: string;
}): string {
  const hu = args.language === "hu";
  const lines: string[] = [greeting(args.language, args.contactFirstName, false), ""];
  lines.push(hu ? "Köszönjük a kérdést!" : "Thanks for asking!");
  if (args.linkedDueDate) {
    const w = returnWording({ earliestDue: args.linkedDueDate, nowMs: args.nowMs, tz: args.tz, language: args.language });
    lines.push(hu ? `Az első verzió ${w.text} elkészül.` : `The first version will be ready ${w.text}.`);
  } else {
    lines.push(hu ? "Hamarosan jelentkezünk a pontos időponttal." : "We'll get back to you with the exact date shortly.");
  }
  lines.push("", signOff(args.language, args.senderFirstName));
  return lines.join("\n");
}
