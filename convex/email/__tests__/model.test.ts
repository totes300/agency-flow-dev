import { describe, expect, it } from "vitest";
import {
  isForwardSubject,
  containsLink,
  detectUrgency,
  emailDomain,
  extractDates,
  extractTaskIdentifiers,
  foldText,
  hardTriggers,
  isAcknowledgeCandidate,
  isBulkOrAutomated,
  isPublicMailDomain,
  matchClientByDomain,
  skipBeforeTriage,
  normalizeSubject,
  parseAddress,
  parseAddressList,
  resolveDueDate,
  stripQuoted,
} from "../model";
import { zonedDateTimeToInstant } from "../../lib/workingDays";

const TZ = "Europe/Budapest";
/** Local Budapest time → instant. */
const at = (date: string, hh = 15, mm = 0) => zonedDateTimeToInstant(date, hh, mm, TZ);
// Friday 2026-10-16 15:00 — Réka's Black Friday email.
const FRIDAY = at("2026-10-16");

// ─── stripQuoted ─────────────────────────────────────────────────────────────

describe("stripQuoted", () => {
  it("HU Gmail: keeps the reply above \"… ezt írta (időpont: …):\"", () => {
    const body = [
      "Sziasztok!",
      "",
      "Mikorra lesz kész a landing oldal?",
      "",
      "Kovács Réka <reka@pragmatico.hu> ezt írta (időpont: 2026. okt. 16., P 15:12):",
      "> Sziasztok!",
      "> Jövő szerdáig kellene pár dolog.",
    ].join("\n");
    expect(stripQuoted(body)).toEqual({
      text: "Sziasztok!\n\nMikorra lesz kész a landing oldal?",
      strippedSomething: true,
      lowConfidence: false,
    });
  });

  it("HU Gmail header wrapped onto two lines", () => {
    const body = [
      "Köszi, így jó!",
      "",
      "2026. okt. 16., P 15:12 dátummal Kovács Réka <",
      "reka@pragmatico.hu> ezt írta:",
      "> Elküldtük a bannereket.",
    ].join("\n");
    expect(stripQuoted(body).text).toBe("Köszi, így jó!");
  });

  it("HU Apple Mail: \"… időpontban … írta:\"", () => {
    const body = [
      "Rendben, mehet élesbe.",
      "",
      "2026. okt. 16. dátummal, 15:12 időpontban Tóth Ádám <adam@konverted.io> írta:",
      "",
      "> Kész a visszaszámláló.",
    ].join("\n");
    expect(stripQuoted(body).text).toBe("Rendben, mehet élesbe.");
  });

  it("EN Gmail: \"On … wrote:\"", () => {
    const body = [
      "Please also add a story size.",
      "",
      "On Fri, Oct 16, 2026 at 3:12 PM Réka Kovács <reka@pragmatico.hu> wrote:",
      "> Hi team,",
      "> we need banners.",
    ].join("\n");
    expect(stripQuoted(body).text).toBe("Please also add a story size.");
  });

  it("EN Apple Mail: \"On 16 Oct 2026, at 15:12, … wrote:\"", () => {
    const body = [
      "Looks good to me.",
      "",
      "> On 16 Oct 2026, at 15:12, Ádám Tóth <adam@konverted.io> wrote:",
      ">",
      "> The countdown is live.",
    ].join("\n");
    expect(stripQuoted(body)).toMatchObject({ text: "Looks good to me.", strippedSomething: true });
  });

  it("Outlook HU header block (Feladó / Elküldve / Címzett / Tárgy) with the underscore rule", () => {
    const body = [
      "Szia Ádám,",
      "",
      "élesben hibás az ár a termékoldalon, kérlek nézzétek meg.",
      "",
      "________________________________",
      "Feladó: Tóth Ádám <adam@konverted.io>",
      "Elküldve: 2026. október 15., csütörtök 10:02",
      "Címzett: Nagy Gábor <gabor@pragmatico.hu>",
      "Tárgy: Webshop frissítés",
      "",
      "Szia Gábor, kint van az új verzió.",
    ].join("\n");
    expect(stripQuoted(body).text).toBe(
      "Szia Ádám,\n\nélesben hibás az ár a termékoldalon, kérlek nézzétek meg.",
    );
  });

  it("Outlook EN block with bold labels (*From:* / *Sent:* / *To:*)", () => {
    const body = [
      "Can you send the invoice again?",
      "",
      "*From:* Ádám Tóth <adam@konverted.io>",
      "*Sent:* Thursday, October 15, 2026 10:02 AM",
      "*To:* Péter Szabó <peter@arlo.hu>",
      "*Subject:* Invoice",
      "",
      "Hi Péter, attached.",
    ].join("\n");
    expect(stripQuoted(body).text).toBe("Can you send the invoice again?");
  });

  it("\"-----Original Message-----\" and its HU form", () => {
    expect(stripQuoted("Thanks!\n\n-----Original Message-----\nFrom: x\nhello").text).toBe("Thanks!");
    expect(stripQuoted("Köszönöm!\n\n----- Eredeti üzenet -----\nFeladó: x\nszia").text).toBe("Köszönöm!");
  });

  it("a content line \"From: …\" without Sent/To is NOT a header", () => {
    const body = "From: the marketing team, two notes.\nPlease use the new logo.";
    expect(stripQuoted(body)).toEqual({ text: body, strippedSomething: false, lowConfidence: false });
  });

  it("removes a trailing block of `>` lines without a header", () => {
    expect(stripQuoted("Mehet!\n\n> Kész a banner.\n> Üdv, Ádám")).toMatchObject({
      text: "Mehet!",
      strippedSomething: true,
      lowConfidence: false,
    });
  });

  it("keeps inline replies interleaved with the quote (low confidence)", () => {
    const body = [
      "Válaszok lent.",
      "",
      "On Fri, Oct 16, 2026 at 3:12 PM Ádám <adam@konverted.io> wrote:",
      "> 1. Melyik méret kell?",
      "1200×628 és 1080×1920.",
      "> 2. Mikorra?",
      "Jövő szerdáig.",
    ].join("\n");
    const result = stripQuoted(body);
    expect(result.lowConfidence).toBe(true);
    expect(result.text).toBe("Válaszok lent.\n\n1200×628 és 1080×1920.\nJövő szerdáig.");
  });

  it("strips \"Sent from my iPhone\" and the HU mobile footers", () => {
    expect(stripQuoted("Mikorra lesz kész?\n\nSent from my iPhone").text).toBe("Mikorra lesz kész?");
    expect(stripQuoted("Köszi!\n\nKüldve az iPhone-omról").text).toBe("Köszi!");
    expect(stripQuoted("Oké.\nElküldve az iPhone-omról").text).toBe("Oké.");
  });

  it("strips the RFC \"-- \" signature", () => {
    expect(stripQuoted("Kérnénk egy új bannert.\n-- \nKovács Réka\nPragmatico Kft.").text).toBe(
      "Kérnénk egy új bannert.",
    );
  });

  it("strips a closing \"Üdvözlettel,\" block (name, title, phone)", () => {
    const body = [
      "Kérnénk a hírlevelet is.",
      "",
      "Üdvözlettel,",
      "Kovács Réka",
      "Marketing manager | Pragmatico Kft.",
      "+36 30 123 4567",
    ].join("\n");
    expect(stripQuoted(body)).toMatchObject({ text: "Kérnénk a hírlevelet is.", strippedSomething: true });
  });

  it("keeps a sign-off block that contains a question (a P.S.)", () => {
    const body = "Kész?\n\nÜdv,\nRéka\nPS: a story méret is megvan?";
    expect(stripQuoted(body).text).toBe(body);
  });

  it("does not strip a forwarded message (it is the content)", () => {
    const body = [
      "Nézzétek meg lent, ezt kérné a főnököm.",
      "",
      "---------- Forwarded message ---------",
      "From: Igazgató <ceo@pragmatico.hu>",
      "Date: Fri, Oct 16, 2026",
      "Subject: BF",
      "To: Réka <reka@pragmatico.hu>",
    ].join("\n");
    // The header block INSIDE the forward belongs to the forwarded mail: the
    // whole forward stays (B4 — its request must reach the ledger).
    expect(stripQuoted(body).text).toContain("Nézzétek meg lent");
    expect(stripQuoted(body).text).toContain("Forwarded message");
    expect(stripQuoted(`${body}\n\nKérnénk az árlistát frissíteni.`).text).toContain("Kérnénk az árlistát");
  });

  it("Outlook forwards (EN + HU labels): kept whole when the subject is a forward, stripped as a reply otherwise", () => {
    const hu = [
      "Köszi!",
      "",
      "________________________________",
      "Feladó: Nagy Gábor <gabor@pragmatico.hu>",
      "Elküldve: 2026. október 15., csütörtök 10:02",
      "Címzett: Kovács Réka <reka@pragmatico.hu>",
      "Tárgy: Árlista",
      "",
      "Kérnénk az árlistát frissíteni.",
    ].join("\n");
    const en = hu
      .replace("Feladó:", "From:")
      .replace("Elküldve:", "Sent:")
      .replace("Címzett:", "To:")
      .replace("Tárgy:", "Subject:");
    for (const body of [hu, en]) {
      // As a reply the block is history …
      expect(stripQuoted(body, { subject: "RE: Árlista" }).text).toBe("Köszi!");
      expect(stripQuoted(body).text).toBe("Köszi!");
      // … as a forward it is the content.
      for (const subject of ["FW: Árlista", "Fwd: Árlista", "Továbbítás: Árlista", "TR: Árlista", "VS: Árlista"]) {
        expect(stripQuoted(body, { subject }).text, subject).toContain("Kérnénk az árlistát frissíteni.");
      }
    }
    // HU Outlook "Küldés ideje:" is a date line too.
    expect(stripQuoted(hu.replace("Elküldve:", "Küldés ideje:")).text).toBe("Köszi!");
  });

  it("isForwardSubject", () => {
    expect(["FW: x", "Fwd: x", "fwd:x", "Továbbítás: x", "TR: x", "VS: x", "Re: Fw: x"].map(isForwardSubject)).toEqual(
      [true, true, true, true, true, true, true],
    );
    expect(["Re: x", "Válasz: x", "Forward planning", "Fwd", undefined, ""].map(isForwardSubject)).toEqual(
      [false, false, false, false, false, false],
    );
  });

  it("an \"… írta:\" line that is not a reply header keeps everything (low confidence)", () => {
    const body = [
      "Ahogy Gábor a 2. pontnál írta:",
      "a bannereken legyen ott a 20%,",
      "és kérnénk egy story méretet is.",
    ].join("\n");
    expect(stripQuoted(body)).toEqual({ text: body, strippedSomething: false, lowConfidence: true });
  });

  it("a real-looking header with no quote after it is not cut either", () => {
    const body = "Lásd lent.\n\nOn Fri, Oct 16, 2026 at 3:12 PM Ádám <adam@konverted.io> wrote:\nA banner kész.";
    expect(stripQuoted(body)).toEqual({ text: body, strippedSomething: false, lowConfidence: true });
  });

  it("a date + time header without an address still counts when a quote follows", () => {
    const body = "Mehet!\n\n2026. okt. 16., P 15:12 dátummal Tóth Ádám ezt írta:\n> Kész a banner.";
    expect(stripQuoted(body)).toMatchObject({ text: "Mehet!", strippedSomething: true, lowConfidence: false });
  });

  it("never cuts a HU \"Ui.\" line after the sign-off", () => {
    const body = "Kérnénk a hírlevelet is.\n\nÜdv,\nRéka\nUi.: a logót a régi színben hagyjátok";
    expect(stripQuoted(body).text).toBe(body);
  });

  it("never cuts an EN \"PS\" line after the sign-off", () => {
    const body = "Please send the banners.\n\nBest regards,\nAnna\nPS the story size too";
    expect(stripQuoted(body).text).toBe(body);
    expect(stripQuoted("Thanks!\n\nBest,\nAnna\nP.S. Love it").text).toContain("P.S. Love it");
  });

  it("never cuts a request line after the sign-off or a mobile footer", () => {
    const afterSignOff = "Szia!\n\nÜdvözlettel,\nRéka\nA hírlevél is kellene péntekre.";
    expect(stripQuoted(afterSignOff).text).toBe(afterSignOff);
    const afterFooter = "Kész?\n\nSent from my iPhone\nMég egy banner kérnénk.";
    expect(stripQuoted(afterFooter).text).toBe(afterFooter);
  });

  it("still cuts a sign-off block whose tail has only a website line", () => {
    expect(stripQuoted("Köszi!\n\nÜdv,\nRéka\nwww.pragmatico.hu").text).toBe("Köszi!");
  });

  it("keeps the whole body when nothing would remain (low confidence)", () => {
    const body = "On Fri, Oct 16, 2026 at 3:12 PM Ádám <adam@konverted.io> wrote:\n> Kész.";
    expect(stripQuoted(body)).toEqual({ text: body, strippedSomething: false, lowConfidence: true });
  });

  it("normalises CRLF and squeezes blank lines", () => {
    expect(stripQuoted("Szia!\r\n\r\n\r\n\r\nKész?\r\n").text).toBe("Szia!\n\nKész?");
  });
});

// ─── hardTriggers (D4) ───────────────────────────────────────────────────────

describe("hardTriggers", () => {
  it.each([
    ["Kérnénk egy story méretet is.", "word:kérnénk"],
    ["Kérem, küldjék át a fájlokat.", "word:kérnénk"],
    ["Lehetne nagyobb a logó.", "word:lehetne"],
    ["És még egy hírlevél is jöhet.", "word:még"],
    ["Mégis 15% legyen.", "word:még"],
    ["A hírlevél mégsem kell.", "word:még"],
    ["Mehet élesbe.", "word:mehet"],
    ["Kellene egy visszaszámláló a landingre.", "word:kellene"],
    ["Ide kell még egy CTA.", "word:kellene"],
    ["Javítsátok ki az árat légyszi.", "word:javítsátok"],
    ["Kijavítanátok a hibát?", "word:javítsátok"],
    ["A javítás sürgős.", "word:javítsátok"],
    ["Szeretnénk egy új bannert.", "word:szeretnénk"],
    ["Tudnátok módosítani a színt.", "word:tudnátok"],
    ["Élesben hibás az ár.", "word:hiba"],
    ["Please add a story size.", "word:please"],
    ["We need the files by Monday.", "word:need"],
    ["Could you resend the invoice.", "word:could you"],
    ["The price is wrong on the live site.", "word:broken"],
    ["Ide még egy CTA kéne.", "word:kellene"],
    ["Kérek egy új árajánlatot.", "word:kérnénk"],
    ["Kérünk egy rövid egyeztetést.", "word:kérnénk"],
    ["Jó lenne, ha pénteken élesedne.", "word:jó lenne"],
    ["Jó lenne, ha pénteken élesedne.", "word:lenne"],
    ["Szükségünk van a forrásfájlokra.", "word:szükség"],
    ["Csináljatok egy GIF-et is.", "word:csináljátok"],
    ["Készítsetek egy rövid videót.", "word:készítsétek"],
  ])("%s → %s", (text, expected) => {
    expect(hardTriggers(text)).toContain(expected);
  });

  it("is accent- and case-insensitive (phones type without accents)", () => {
    expect(hardTriggers("KERNENK egy uj bannert")).toContain("word:kérnénk");
    expect(hardTriggers("javitsatok ki")).toContain("word:javítsátok");
  });

  it("matches whole words: \"méghozzá\" is not \"még\", \"kedvezmény\" not \"kell\"", () => {
    expect(hardTriggers("Méghozzá nagyon jó lett.")).toEqual([]);
    expect(hardTriggers("A kedvezmény csak a webshopra vonatkozik.")).toEqual([]);
    expect(hardTriggers("Kellemes hétvégét!")).toEqual([]);
  });

  it.each([
    "Kész is van, szuper.",
    "Elkészült a banner.",
    "Csinos lett az oldal.",
    "A XIII. kerületi üzlet.",
    "Kenyérre kenhető.",
    "Lent a parkolóban.",
    "Szép napot!",
  ])("no false hit on everyday words: %s", (text) => {
    expect(hardTriggers(text)).toEqual([]);
  });

  it("documented cost: the particle \"meg\" folds onto \"még\"", () => {
    expect(hardTriggers("Meg tudjuk beszélni")).toContain("word:még");
  });

  it("the question mark fires, but not one inside a URL", () => {
    expect(hardTriggers("Mikorra lesz kész?")).toEqual(["question_mark"]);
    expect(hardTriggers("Itt a link: https://pragmatico.hu/bf?utm=1")).toEqual(["link"]);
  });

  it("attachment, link and new recipient come from the context", () => {
    expect(hardTriggers("Csatolom.", { hasAttachment: true })).toEqual(["attachment"]);
    expect(hardTriggers("Nézd: www.pragmatico.hu/bf")).toEqual(["link"]);
    expect(hardTriggers("Szia!", { newRecipient: true })).toEqual(["new_recipient"]);
    expect(hardTriggers("www.x.hu", { hasLink: false })).toEqual([]);
  });

  it("returns every hit once, in a stable order", () => {
    expect(
      hardTriggers("Kérnénk, hogy még ma mehet? Kérnénk!", { hasAttachment: true, newRecipient: true }),
    ).toEqual(["question_mark", "word:kérnénk", "word:még", "word:mehet", "attachment", "new_recipient"]);
  });

  it("a pure thank-you fires nothing", () => {
    expect(hardTriggers("Köszönöm szépen! 🙏")).toEqual([]);
    expect(hardTriggers("Thanks a lot, guys!")).toEqual([]);
  });
});

// ─── isAcknowledgeCandidate ──────────────────────────────────────────────────

describe("isAcknowledgeCandidate", () => {
  const ack = (text: string) => isAcknowledgeCandidate(text, hardTriggers(text));

  it.each([
    "Köszönöm szépen!",
    "Köszi!",
    "Köszönjük a gyors választ!",
    "Szia Ádám!\nKöszönöm a segítséget!\nAnna",
    "Köszönöm szépen! 🙏 Anna",
    "Megkaptam, köszönöm!",
    "Thanks a lot!",
    "Thank you so much for the quick reply!",
    "Thanks!\nBest,\nAnna",
  ])("thank-you: %j", (text) => {
    expect(ack(text)).toBe(true);
  });

  it.each([
    ["any trigger", "Köszönöm, még egy kérdés?"],
    ["an approval (D32)", "Így jó, köszönöm!"],
    ["\"rendben\" is for the model", "Rendben, köszönöm."],
    ["no thanks word", "Szia Ádám!"],
    ["a request after thanks", "Köszi! A logót cseréljétek."],
    ["\"ok\" is not a thanks word", "Ok, köszi!"],
    ["\"OK\" is not a thanks word", "OK köszönöm"],
    ["\"ok\" after thanks", "Thanks, ok!"],
    ["too long", `Köszönöm! ${"Nagyon ".repeat(40)}`],
    ["empty", "   "],
  ])("not a candidate: %s", (_why, text) => {
    expect(ack(text)).toBe(false);
  });

  it("a fired trigger always wins, whatever the text", () => {
    expect(isAcknowledgeCandidate("Köszönöm!", ["attachment"])).toBe(false);
  });
});

// ─── Addresses ───────────────────────────────────────────────────────────────

describe("parseAddress / parseAddressList", () => {
  it.each([
    ["Kovács Réka <Reka@Pragmatico.hu>", { name: "Kovács Réka", email: "reka@pragmatico.hu" }],
    ['"Kovács, Réka" <reka@pragmatico.hu>', { name: "Kovács, Réka", email: "reka@pragmatico.hu" }],
    ['"Nagy \\"Gabi\\" Gábor" <gabor@pragmatico.hu>', { name: 'Nagy "Gabi" Gábor', email: "gabor@pragmatico.hu" }],
    ["<peter@arlo.hu>", { email: "peter@arlo.hu" }],
    ["peter@arlo.hu", { email: "peter@arlo.hu" }],
    ["peter@arlo.hu (Szabó Péter)", { name: "Szabó Péter", email: "peter@arlo.hu" }],
    ["judit@ujceg.hu <judit@ujceg.hu>", { email: "judit@ujceg.hu" }],
    ["mailto:anna@arlo.hu", { email: "anna@arlo.hu" }],
  ])("%s", (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });

  it("rejects what is not an address", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("Kovács Réka")).toBeNull();
    expect(parseAddress("reka@localhost")).toBeNull();
    expect(parseAddress("<not an email>")).toBeNull();
  });

  it("splits a list outside quotes and angle brackets, de-duplicated", () => {
    expect(
      parseAddressList('"Kovács, Réka" <reka@pragmatico.hu>, Nagy Gábor <gabor@pragmatico.hu>; REKA@pragmatico.hu, junk'),
    ).toEqual([
      { name: "Kovács, Réka", email: "reka@pragmatico.hu" },
      { name: "Nagy Gábor", email: "gabor@pragmatico.hu" },
    ]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList('"Nagy \\"G, abi\\"" <gabor@pragmatico.hu>, anna@arlo.hu')).toEqual([
      { name: 'Nagy "G, abi"', email: "gabor@pragmatico.hu" },
      { email: "anna@arlo.hu" },
    ]);
  });

  it("emailDomain lower-cases the domain", () => {
    expect(emailDomain("Reka@Mail.Pragmatico.HU")).toBe("mail.pragmatico.hu");
    expect(emailDomain("nope")).toBe("");
  });
});

// ─── matchClientByDomain ─────────────────────────────────────────────────────

describe("matchClientByDomain", () => {
  const pragmatico = { id: "c1", emailDomains: ["pragmatico.hu"], contactEmails: ["reka@pragmatico.hu"] };
  const arlo = { id: "c2", emailDomains: ["arlo.hu"], contactEmails: ["peter@arlo.hu", "anna.arlo@gmail.com"] };
  const holding = { id: "c3", emailDomains: ["shop.pragmatico.hu"] };
  const clients = [pragmatico, arlo, holding];

  it("exact contact email first", () => {
    expect(matchClientByDomain("Reka@Pragmatico.hu", clients)).toEqual({ client: pragmatico, via: "contact" });
    // A contact on a public domain still links (only by the exact address).
    expect(matchClientByDomain("anna.arlo@gmail.com", clients)).toEqual({ client: arlo, via: "contact" });
  });

  it("then the client domain", () => {
    expect(matchClientByDomain("gabor@pragmatico.hu", clients)).toEqual({ client: pragmatico, via: "domain" });
  });

  it("then a subdomain — the longest client domain wins", () => {
    expect(matchClientByDomain("bob@mail.arlo.hu", clients)).toEqual({ client: arlo, via: "subdomain" });
    expect(matchClientByDomain("x@eu.shop.pragmatico.hu", clients)).toEqual({ client: holding, via: "subdomain" });
    expect(matchClientByDomain("x@shop.pragmatico.hu", clients)).toEqual({ client: holding, via: "domain" });
  });

  it("never matches a public mail domain, even if a client lists it", () => {
    const sloppy = { id: "c4", emailDomains: ["gmail.com"] };
    expect(matchClientByDomain("judit@gmail.com", [...clients, sloppy])).toBeNull();
    expect(isPublicMailDomain("Freemail.hu")).toBe(true);
    expect(isPublicMailDomain("pragmatico.hu")).toBe(false);
  });

  it("unknown or ambiguous → null", () => {
    expect(matchClientByDomain("judit@ujceg.hu", clients)).toBeNull();
    const twin = { id: "c5", emailDomains: ["pragmatico.hu"] };
    expect(matchClientByDomain("gabor@pragmatico.hu", [...clients, twin])).toBeNull();
    expect(matchClientByDomain("gabor@mail.pragmatico.hu", [pragmatico, twin])).toBeNull();
    const dupContact = { id: "c6", contactEmails: ["reka@pragmatico.hu"] };
    expect(matchClientByDomain("reka@pragmatico.hu", [pragmatico, dupContact])).toBeNull();
  });
});

// ─── Subjects ────────────────────────────────────────────────────────────────

describe("normalizeSubject / extractTaskIdentifiers", () => {
  it.each([
    ["Re: Black Friday kampány", "Black Friday kampány"],
    ["RE: RE: Fwd: Black Friday", "Black Friday"],
    ["Válasz: Árhiba a webshopban", "Árhiba a webshopban"],
    ["Továbbítás: BF anyagok", "BF anyagok"],
    ["VS: Offert", "Offert"],
    ["AW: Angebot", "Angebot"],
    ["Re[2]:  Landing   oldal", "Landing oldal"],
    ["Vá: Továbbítva: Számla", "Számla"],
    ["Referencia anyagok", "Referencia anyagok"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });

  it("finds task identifiers, unique and in order", () => {
    expect(extractTaskIdentifiers("Re: [PRG-131] Banner méretek (PRG-131, ARLO-7)")).toEqual(["PRG-131", "ARLO-7"]);
    expect(extractTaskIdentifiers("KON-7 kész?")).toEqual(["KON-7"]);
  });

  it("ignores lowercase, zero, and embedded look-alikes", () => {
    expect(extractTaskIdentifiers("prg-131, PRG-0, SKU-ABC-12x, ABCDEFGHIJK-1")).toEqual([]);
  });
});

// ─── Dates ───────────────────────────────────────────────────────────────────

describe("extractDates", () => {
  const dates = (text: string, received = FRIDAY) =>
    extractDates(text, received, TZ).map((d) => ({ phrase: d.phrase, date: d.date, ...(d.ambiguous ? { ambiguous: true } : {}) }));

  it.each([
    ["hétfőre kellene", "hétfőre", "2026-10-19"],
    ["péntekig kérnénk", "péntekig", "2026-10-23"], // Friday email: next Friday
    ["szerdán élesítjük", "szerdán", "2026-10-21"],
    ["kedden", "kedden", "2026-10-20"],
    ["Jövő szerdáig kellene", "Jövő szerdáig", "2026-10-21"],
    ["by Monday please", "Monday", "2026-10-19"],
    ["2026.10.24. a határidő", "2026.10.24.", "2026-10-24"],
    ["2026. 10. 24-ig", "2026. 10. 24-ig", "2026-10-24"],
    ["határidő: 2026-10-24", "2026-10-24", "2026-10-24"],
    ["okt. 24.", "okt. 24.", "2026-10-24"],
    ["október 24-ig", "október 24-ig", "2026-10-24"],
    ["2026. okt. 24.", "2026. okt. 24.", "2026-10-24"],
    ["november 3-án", "november 3-án", "2026-11-03"],
    ["Oct 24th, 2026", "Oct 24th, 2026", "2026-10-24"],
    ["24 October", "24 October", "2026-10-24"],
    ["holnapra", "holnapra", "2026-10-17"],
    ["még ma", "ma", "2026-10-16"],
    ["10.24.", "10.24.", "2026-10-24"],
  ])("%s → %s = %s", (text, phrase, date) => {
    expect(dates(text)).toEqual([{ phrase, date }]);
  });

  it("marks ambiguous numeric dates and never guesses", () => {
    expect(dates("11.10.")).toEqual([{ phrase: "11.10.", date: null, ambiguous: true }]);
    expect(extractDates("05/06/2026", FRIDAY, TZ)[0]).toMatchObject({
      date: null, ambiguous: true, candidates: ["2026-05-06", "2026-06-05"],
    });
    // One number > 12 decides it.
    expect(dates("24/10/2026")).toEqual([{ phrase: "24/10/2026", date: "2026-10-24" }]);
  });

  it("EN \"next Friday\" said on Monday is ambiguous; HU \"jövő péntek\" is not", () => {
    const monday = at("2026-10-19", 10);
    expect(extractDates("next Friday", monday, TZ)[0]).toMatchObject({ date: null, ambiguous: true });
    expect(extractDates("jövő péntekre", monday, TZ)[0]).toMatchObject({ date: "2026-10-30" });
  });

  it("a past weekday (múlt / last / előző / previous) is not a date", () => {
    const monday = at("2026-10-19", 10);
    const text = "A múlt pénteki anyagot jövő szerdáig módosítsátok";
    const found = extractDates(text, monday, TZ);
    expect(found).toEqual([{ date: "2026-10-28", phrase: "jövő szerdáig", kind: "weekday" }]);
    expect(resolveDueDate({ receivedAtMs: monday, tz: TZ, dates: found })).toEqual({
      date: "2026-10-28", source: "email", phrase: "jövő szerdáig",
    });
    for (const past of ["last Friday", "previous Monday", "az előző kedden"]) {
      expect(extractDates(past, monday, TZ)).toEqual([]);
    }
  });

  it("Black Friday / Cyber Monday are campaigns, not dates; \"már\" is not March", () => {
    expect(dates("A Black Friday kampányhoz kérnénk anyagot.")).toEqual([]);
    expect(dates("Cyber Monday banner")).toEqual([]);
    expect(dates("már 5 napja várunk")).toEqual([]);
  });

  it("a year-less date takes the nearest year (December → January)", () => {
    expect(extractDates("január 5-ig", at("2026-12-20"), TZ)[0]?.date).toBe("2027-01-05");
    expect(extractDates("az október 14-i levelem", FRIDAY, TZ)[0]?.date).toBe("2026-10-14");
  });

  it("finds several dates in reading order, never the same span twice", () => {
    expect(dates("A banner péntekig, a hírlevél 2026.10.28-ig kell.")).toEqual([
      { phrase: "péntekig", date: "2026-10-23" },
      { phrase: "2026.10.28-ig", date: "2026-10-28" },
    ]);
  });

  it("drops impossible dates", () => {
    expect(dates("2026.02.30.")).toEqual([]);
  });
});

// ─── Urgency + due date (§6.1) ───────────────────────────────────────────────

describe("detectUrgency / resolveDueDate", () => {
  it.each([
    ["Élesben hibás az ár!", "elesben hibas"],
    ["Minél előbb kellene.", "minel elobb"],
    ["ASAP please", "asap"],
    ["Nem működik a kosár.", "nem mukodik"],
  ])("%s → %s", (text, phrase) => {
    expect(detectUrgency(text)).toBe(phrase);
  });

  it("no urgency in a calm request", () => {
    expect(detectUrgency("Jövő szerdáig kellene pár banner.")).toBeNull();
  });

  it("a date in the email wins (the earliest upcoming one)", () => {
    const text = "A hírlevél 2026.10.28-ig, a banner hétfőre kell.";
    expect(resolveDueDate({ receivedAtMs: FRIDAY, tz: TZ, dates: extractDates(text, FRIDAY, TZ) })).toEqual({
      date: "2026-10-19", source: "email", phrase: "hétfőre",
    });
  });

  it("past references and ambiguous dates never win", () => {
    const dates = extractDates("Az október 14-i kérés, 11.10.", FRIDAY, TZ);
    expect(resolveDueDate({ receivedAtMs: FRIDAY, tz: TZ, dates })).toEqual({ date: "2026-10-20", source: "default" });
  });

  it("urgent → today; otherwise Friday 15:00 + 2 working days → Tuesday", () => {
    expect(resolveDueDate({ receivedAtMs: FRIDAY, tz: TZ, dates: [], urgentPhrase: "elesben hibas" })).toEqual({
      date: "2026-10-16", source: "urgent", phrase: "elesben hibas",
    });
    expect(resolveDueDate({ receivedAtMs: FRIDAY, tz: TZ, dates: [] })).toEqual({ date: "2026-10-20", source: "default" });
    expect(resolveDueDate({ receivedAtMs: FRIDAY, tz: TZ, dates: [], defaultWorkingDays: 3 }).date).toBe("2026-10-21");
  });
});

// ─── isBulkOrAutomated (D24) ─────────────────────────────────────────────────

describe("isBulkOrAutomated / skipBeforeTriage", () => {
  it.each([
    [{ Precedence: "bulk" }, "precedence:bulk"],
    [{ precedence: "Junk" }, "precedence:junk"],
    [{ "Auto-Submitted": "auto-replied" }, "auto_submitted:auto-replied"],
    [{ "X-Autoreply": "yes" }, "autoreply_header"],
    [{ Subject: "Automatikus válasz: Black Friday" }, "autoreply_subject"],
    [{ Subject: "Out of Office: BF" }, "autoreply_subject"],
    [{ From: "Google <no-reply@accounts.google.com>" }, "noreply_sender"],
  ])("drop: %j → %s", (headers, reason) => {
    expect(isBulkOrAutomated(headers)).toEqual({ drop: true, list: false, reasons: [reason] });
  });

  it.each([
    [{ "List-Unsubscribe": "<mailto:u@news.hu>" }, "list_unsubscribe"],
    [{ "List-Id": "<hello.konverted.io>" }, "list_id"],
    [{ Precedence: "list" }, "precedence:list"],
  ])("list signal only: %j → %s", (headers, reason) => {
    expect(isBulkOrAutomated(headers)).toEqual({ drop: false, list: true, reasons: [reason] });
  });

  it("Gmail category labels from D24 drop", () => {
    expect(isBulkOrAutomated({}, { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] })).toEqual({
      drop: true, list: false, reasons: ["label:CATEGORY_PROMOTIONS"],
    });
    expect(isBulkOrAutomated({}, { labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"] }).drop).toBe(false);
  });

  it("a normal client email has no signal (header arrays, Auto-Submitted: no)", () => {
    const headers = [
      { name: "From", value: "Kovács Réka <reka@pragmatico.hu>" },
      { name: "Subject", value: "Re: Black Friday" },
      { name: "Auto-Submitted", value: "no" },
    ];
    expect(isBulkOrAutomated(headers)).toEqual({ drop: false, list: false, reasons: [] });
  });

  it("list headers do not drop a known client sender or a tracked thread (Google Groups alias)", () => {
    const viaGroup = isBulkOrAutomated({ "List-Id": "<hello.konverted.io>", Precedence: "list", From: "reka@pragmatico.hu" });
    expect(skipBeforeTriage(viaGroup, { knownClientSender: true, trackedThread: false })).toBe(false);
    expect(skipBeforeTriage(viaGroup, { knownClientSender: false, trackedThread: true })).toBe(false);
    expect(skipBeforeTriage(viaGroup, { knownClientSender: false, trackedThread: false })).toBe(true);
  });

  it("drop signals skip even a known client sender", () => {
    const outOfOffice = isBulkOrAutomated({ "Auto-Submitted": "auto-replied", "List-Unsubscribe": "<x>" });
    expect(outOfOffice).toMatchObject({ drop: true, list: true });
    expect(skipBeforeTriage(outOfOffice, { knownClientSender: true, trackedThread: true })).toBe(true);
    expect(skipBeforeTriage(isBulkOrAutomated({}), { knownClientSender: false, trackedThread: false })).toBe(false);
  });
});

// ─── Small helpers ───────────────────────────────────────────────────────────

describe("foldText / containsLink", () => {
  it("folds case and accents, keeping the length", () => {
    const text = "Kérnénk ŐSZI Űrlapot";
    expect(foldText(text)).toBe("kernenk oszi urlapot");
    expect(foldText(text)).toHaveLength(text.length);
    expect(foldText("🙏 Köszi")).toHaveLength("🙏 Köszi".length);
    expect(foldText("한국 İ")).toBe("한국 i");
  });

  it("detects links", () => {
    expect(containsLink("https://pragmatico.hu")).toBe(true);
    expect(containsLink("www.arlo.hu/bf")).toBe(true);
    expect(containsLink("pragmatico pont hu")).toBe(false);
  });
});
