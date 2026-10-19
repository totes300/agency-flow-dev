import { describe, expect, it } from "vitest";
import {
  checkReplyDraft,
  detectLanguage,
  effortEstimates,
  firstNameOf,
  internalTeamNames,
  memberFirstName,
  memberNameForms,
  mentionsName,
  moneyAmounts,
  numberedLines,
  returnSentence,
  returnWording,
  workingDaysUntil,
  type KickoffFacts,
} from "../kickoff";

// Friday 2026-10-16 10:00 Budapest (08:00 UTC).
const FRIDAY_10 = Date.UTC(2026, 9, 16, 8, 0, 0);
const TZ = "Europe/Budapest";
const wording = (due: string, language: "hu" | "en" = "hu") =>
  returnWording({ earliestDue: due, nowMs: FRIDAY_10, tz: TZ, language });

describe("returnWording (D21 — when we get back, from the earliest due)", () => {
  it("today or earlier → today", () => {
    expect(wording("2026-10-16")).toMatchObject({ kind: "today", text: "még ma", workingDays: 0 });
    expect(wording("2026-10-15", "en")).toMatchObject({ kind: "today", text: "today" });
  });

  it("1–2 working days → within N working days (weekends skipped)", () => {
    expect(wording("2026-10-19")).toMatchObject({ kind: "working_days", text: "1 munkanapon belül", workingDays: 1 });
    expect(wording("2026-10-20", "en")).toMatchObject({ kind: "working_days", text: "within 2 working days", workingDays: 2 });
    expect(wording("2026-10-19", "en").text).toBe("within 1 working day");
  });

  it("later within a week → the weekday; later still → the date", () => {
    expect(wording("2026-10-21")).toMatchObject({ kind: "weekday", text: "szerdáig", date: "2026-10-21" });
    expect(wording("2026-10-22", "en")).toMatchObject({ kind: "weekday", text: "by Thursday" });
    expect(wording("2026-10-28")).toMatchObject({ kind: "date", text: "október 28-ig" });
    expect(wording("2026-11-03", "en")).toMatchObject({ kind: "date", text: "by 3 November" });
  });

  it("the return sentence of a code-built draft", () => {
    expect(returnSentence(wording("2026-10-21"), "hu")).toBe("Szerdáig jelentkezünk.");
    expect(returnSentence(wording("2026-10-20", "en"), "en")).toBe("We'll get back to you within 2 working days.");
  });

  it("counts working days after a date up to and including another", () => {
    expect(workingDaysUntil("2026-10-16", "2026-10-19")).toBe(1);
    expect(workingDaysUntil("2026-10-16", "2026-10-23")).toBe(5);
  });
});

describe("detectLanguage (D19)", () => {
  it("Hungarian with accents, accent-less Hungarian, English", () => {
    expect(detectLanguage("Jövő szerdáig kellene a Black Friday kampányhoz pár dolog")).toBe("hu");
    expect(detectLanguage("kernenk egy uj bannert, koszi")).toBe("hu");
    expect(detectLanguage("Hi, could you please send the files? Thanks")).toBe("en");
  });

  it("first names: Hungarian family-name first, English given-name first", () => {
    expect(firstNameOf("Kovács Réka", "hu")).toBe("Réka");
    expect(firstNameOf("Jane Smith", "en")).toBe("Jane");
    expect(firstNameOf(undefined, "hu")).toBeNull();
  });
});

describe("team member names (structured Clerk parts)", () => {
  const adam = { name: "Adam Toth", firstName: "Adam", lastName: "Toth" };
  it("the sender's first name is the structured given name — never a Hungarian-order guess", () => {
    expect(memberFirstName(adam)).toBe("Adam");
    // Family-first display name, but Clerk says the given name is Réka.
    expect(memberFirstName({ name: "Kovács Réka", firstName: "Réka", lastName: "Kovács" })).toBe("Réka");
    // Older rows without parts: the display name's first token (Clerk builds it given-first).
    expect(memberFirstName({ name: "Adam Toth" })).toBe("Adam");
    expect(memberFirstName({ name: "Lili" })).toBe("Lili");
    expect(memberFirstName(null)).toBeNull();
  });

  it("name forms: full, first, last — deduped, no stray tokens", () => {
    expect(memberNameForms({ name: "Bence Kiss", firstName: "Bence", lastName: "Kiss" })).toEqual(["Bence Kiss", "Bence", "Kiss"]);
    expect(memberNameForms({ name: "Lili" })).toEqual(["Lili"]);
    expect(memberNameForms({ name: "Nagy Lili Anna", firstName: "Lili Anna", lastName: "Nagy" })).toEqual([
      "Nagy Lili Anna",
      "Lili Anna Nagy",
      "Lili Anna",
      "Nagy",
    ]);
  });

  it("doNotMention: every member's forms, minus the sender's own and names the client's people share", () => {
    const names = internalTeamNames({
      members: [
        { name: "Bence Kiss", firstName: "Bence", lastName: "Kiss" },
        { name: "Réka Tóth", firstName: "Réka", lastName: "Tóth" },
        { name: "Adam Nagy", firstName: "Adam", lastName: "Nagy" },
        { name: "Bo" },
      ],
      sender: adam,
      clientNames: ["Kovács Réka", "Kiss Anna"],
    });
    // "Réka" / "Kiss" — the client's people have them; "Adam" and "Tóth"
    // (folded = "toth") are the sender's own forms; "Bo" is too short.
    expect(names).toEqual(["Bence Kiss", "Bence", "Réka Tóth", "Adam Nagy", "Nagy"]);
    // And the checks match them case-folded with a Hungarian suffix.
    expect(mentionsName("Bencével egyeztetünk", "Bence")).toBe(true);
    expect(mentionsName("ADAM NAGYNAK szólunk", "Adam Nagy")).toBe(true);
  });
});

describe("content scanners", () => {
  it("finds money amounts, estimates and numbered lines", () => {
    expect(moneyAmounts("Az ár 89 990 Ft lesz, vagy €120, vagy 1.200 EUR")).toEqual(["89 990 Ft", "€120", "1.200 EUR"]);
    expect(moneyAmounts("A 20% kedvezmény 2026-ban")).toEqual([]);
    expect(effortEstimates("kb. 8 óra munka, or 3 hours")).toEqual(["8 óra", "3 hours"]);
    expect(numberedLines("Kérdések:\n1. Mikor?\n2) Hol?\nmás")).toBe(2);
  });
});

describe("checkReplyDraft", () => {
  const facts: KickoffFacts = {
    language: "hu",
    contactFirstName: "Réka",
    started: ["Black Friday kampány anyagok"],
    returnBy: wording("2026-10-21"),
    answerable: [{ requestId: "r_ask", text: "Mikorra lesz kész?", answerHint: null }],
    clientQuestions: [{ questionId: "q1", text: "When exactly should the countdown end?" }],
  };
  const good = [
    "Kedves Réka!",
    "",
    "Köszönjük! Elkezdtük a Black Friday kampány anyagait. Szerdáig jelentkezünk.",
    "A kérdésedre: szerdáig elkészül.",
    "",
    "1. Pontosan mikor járjon le a visszaszámláló?",
    "",
    "Üdvözlettel,",
    "Ádám",
  ].join("\n");
  const base = {
    mode: "kickoff" as const,
    answersRequestIds: ["r_ask"],
    facts,
    inboundTexts: ["Az ára 89 990 Ft a terméknek, ugye?"],
    internalIdentifiers: ["PRG-132"],
    internalNames: ["Frances", "Kiss Bence"],
  };

  it("accepts a kickoff that follows the rules", () => {
    expect(checkReplyDraft({ ...base, bodyText: good })).toEqual([]);
  });

  it("requires the return phrase verbatim, the answers and the numbered client questions", () => {
    const errors = checkReplyDraft({ ...base, bodyText: "Kedves Réka! Köszönjük, hamarosan jelentkezünk.", answersRequestIds: [] });
    expect(errors).toEqual([
      expect.stringContaining('"szerdáig"'),
      expect.stringContaining("numbered list"),
      expect.stringContaining("r_ask"),
    ]);
  });

  it("refuses prices / estimates the client did not write, identifiers and team names", () => {
    const errors = checkReplyDraft({
      ...base,
      bodyText: `${good}\nAz ár 150 000 Ft, kb. 8 óra. Frances és a PRG-132 task.`,
    });
    expect(errors).toEqual([
      expect.stringContaining("150 000 Ft"),
      expect.stringContaining("8 óra"),
      expect.stringContaining("PRG-132"),
      expect.stringContaining("Frances"),
    ]);
    // An amount the client wrote may be repeated.
    expect(checkReplyDraft({ ...base, bodyText: `${good}\n89 990 Ft-tal számolunk.` })).toEqual([]);
  });

  it("reply mode: the plan's ask rows must be answered", () => {
    const errors = checkReplyDraft({
      mode: "reply",
      bodyText: "Szia Péter! Hamarosan.",
      answersRequestIds: [],
      facts: null,
      requiredAnswers: [{ requestId: "r1", text: "Mikorra lesz kész?" }],
      inboundTexts: [],
      internalIdentifiers: [],
      internalNames: [],
    });
    expect(errors).toEqual([expect.stringContaining("r1")]);
  });
});

describe("gate review M4: widened patterns", () => {
  it("names: case- and accent-folded, with Hungarian suffixes on the stem", () => {
    expect(mentionsName("Holnap Bencével egyeztetünk.", "Kiss Bence")).toBe(false); // full name not there …
    expect(mentionsName("Holnap Bencével egyeztetünk.", "Bence")).toBe(true); // … the stem + -vel is
    expect(mentionsName("Elküldtük Rékának.", "Réka")).toBe(true);
    expect(mentionsName("FRANCES készíti", "Frances")).toBe(true);
    expect(mentionsName("Ádámmal beszéltünk", "Ádám")).toBe(true);
    expect(mentionsName("annak idején", "Anna")).toBe(false);
    expect(mentionsName("a bencés diák", "Bence")).toBe(false);
  });

  it("money: Ft, HUF, forint*, ezer / millió with a currency, €, EUR, $", () => {
    expect(moneyAmounts("150 ezer forintba kerül, vagy 2 millió Ft, 150e HUF")).toEqual(["150 ezer forintba", "2 millió Ft", "150e HUF"]);
    expect(moneyAmounts("$1,200 or 99 EUR or € 40 or 120 euró")).toEqual(["$1,200", "99 EUR", "€ 40", "120 euró"]);
    expect(moneyAmounts("2 munkanapon belül, október 28-ig, 2026-10-21, 20%")).toEqual([]);
  });

  it("effort: Nh, N óra, N nap, word numbers, hours / days — never the return phrases", () => {
    expect(effortEstimates("kb. 6h, 8 óra, három óra, 2 nap, két napot")).toEqual(["6h", "8 óra", "három óra", "2 nap", "két napot"]);
    expect(effortEstimates("3 hours, two days, half a day, 4 man-days")).toEqual(["3 hours", "two days", "half a day", "4 man-days"]);
    expect(
      effortEstimates("2 munkanapon belül jelentkezünk — within 2 working days — szerdáig, by 28 October, 3 napon belül"),
    ).toEqual([]);
  });

  it("checkReplyDraft uses them: a suffixed team name and a widened amount are refused", () => {
    const errors = checkReplyDraft({
      mode: "reply",
      bodyText: "Bencével megnéztük, kb. 150 ezer forint és három óra.",
      answersRequestIds: [],
      facts: null,
      inboundTexts: [],
      internalIdentifiers: [],
      internalNames: ["Bence"],
    });
    expect(errors).toEqual([
      expect.stringContaining("150 ezer forint"),
      expect.stringContaining("három óra"),
      expect.stringContaining("Bence"),
    ]);
  });
});
