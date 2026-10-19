/**
 * Pure email helpers (docs/prd-email-triage.md §5.2, §6.1, §6.3, D4, D24).
 * No Convex, no I/O, no clock — every function takes what it needs, so the
 * deterministic layer of triage is fully unit-tested
 * (`convex/email/__tests__/model.test.ts`).
 *
 *   stripQuoted            quoted history + signatures out of a plain-text body
 *   hardTriggers           D4 triggers (HU + EN) that forbid a silent "no action"
 *   isAcknowledgeCandidate the deterministic "just a thank-you" shortcut (§6.3)
 *   parseAddress(List)     RFC-ish "Name <a@b>" parsing
 *   matchClientByDomain    sender → client (contact email, domain, subdomain)
 *   normalizeSubject       Re: / Fwd: / Válasz: … stripped
 *   extractTaskIdentifiers PRG-131 in a subject
 *   extractDates           HU / EN dates → YYYY-MM-DD in the org timezone
 *   detectUrgency          "élesben hibás", "ASAP" … (§6.1 urgent → today)
 *   resolveDueDate         §6.1: email date › urgent today › N working days
 *   isBulkOrAutomated      D24 skip layer as signals (drop vs mailing-list)
 *   skipBeforeTriage       the D24 decision with sender context (for B3)
 *
 * ── Text matching (one rule everywhere) ─────────────────────────────────────
 * Matching is case- AND accent-insensitive on whole words: the text is folded
 * (lower-case, diacritics removed — "Kérnénk" → "kernenk", "ő" → "o") and
 * split into letter/digit tokens, and a trigger matches a whole token (or a
 * declared stem prefix, e.g. every "javit…" form), never a substring. So
 * "méghozzá" (token "meghozza") is not "még", and "kedvezmény" is not
 * "kedd". Accent-insensitivity is deliberate — clients type without accents
 * on phones — and its cost is accepted: the particle "meg" folds onto "még"
 * and fires the trigger. A trigger only forbids the silent acknowledge
 * shortcut (D4: when unsure, propose), so a false hit costs a look, a missed
 * one could lose a request.
 */

import { addCalendarDays, addWorkingDays, DEFAULT_DUE_WORKING_DAYS, localDateOf, weekdayOf } from "../lib/workingDays";
import { isValidIdentifierKey } from "../tasks/model";

// ─── Folding / tokens ───────────────────────────────────────────────────────

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Lower-case + strip diacritics, keeping the string length (one output code
 * unit per input code unit) so match positions map back to the original.
 */
export function foldText(text: string): string {
  let out = "";
  for (const ch of text) {
    const folded = ch.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
    // A character that decomposes into several letters (Hangul) stays as is.
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

type Token = { word: string; start: number; end: number };

function tokenize(folded: string): Token[] {
  const tokens: Token[] = [];
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/** True when the text contains a web link (http(s):// or www.). */
export function containsLink(text: string): boolean {
  return new RegExp(URL_RE.source, "i").test(text);
}

// ─── Addresses ──────────────────────────────────────────────────────────────

export type EmailAddress = { name?: string; email: string };

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function cleanName(raw: string): string | undefined {
  let name = raw.trim();
  if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
    name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  name = name.replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim();
  return name.length > 0 ? name : undefined;
}

/**
 * One address: `Kovács Réka <Reka@Pragmatico.hu>`, `"Kovács, Réka" <…>`,
 * `<a@b.hu>`, `a@b.hu`, `a@b.hu (Kovács Réka)`. The email is lower-cased;
 * a name equal to the email is dropped. null when there is no valid email.
 */
export function parseAddress(input: string): EmailAddress | null {
  const raw = input.trim();
  if (!raw) return null;
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(raw);
  let email: string;
  let name: string | undefined;
  if (angle) {
    email = angle[2].trim();
    name = cleanName(angle[1]);
  } else {
    const comment = /^([^\s()]+)\s*\(([^()]*)\)\s*$/.exec(raw);
    if (comment) {
      email = comment[1];
      name = cleanName(comment[2]);
    } else {
      email = raw;
    }
  }
  email = email.replace(/^mailto:/i, "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  if (name && name.toLowerCase() === email) name = undefined;
  return name ? { name, email } : { email };
}

/**
 * An address list header (To / Cc): splits on `,` / `;` outside quotes and
 * angle brackets, drops invalid entries, de-duplicates by email (first wins).
 */
export function parseAddressList(header: string): EmailAddress[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === "\\" && inQuotes && i + 1 < header.length) {
      current += ch + header[++i];
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "<" && !inQuotes) inAngle = true;
    else if (ch === ">" && !inQuotes) inAngle = false;
    if ((ch === "," || ch === ";") && !inQuotes && !inAngle) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const part of parts) {
    const parsed = parseAddress(part);
    if (!parsed || seen.has(parsed.email)) continue;
    seen.add(parsed.email);
    out.push(parsed);
  }
  return out;
}

/** The domain of an email address, lower-cased ("" when malformed). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

// ─── Sender → client ────────────────────────────────────────────────────────

/**
 * Free / public mailbox providers: a sender on one of these says nothing
 * about the client, so they never match by domain (only an exact contact
 * email can link them).
 */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.hu", "hotmail.com", "hotmail.hu",
  "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "gmx.de",
  "mail.com", "zoho.com", "yandex.com", "freemail.hu", "citromail.hu", "indamail.hu",
  "t-online.hu", "t-online.de", "upcmail.hu", "vipmail.hu", "web.de",
]);

export function isPublicMailDomain(domain: string): boolean {
  return PUBLIC_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}

export type ClientMatchCandidate = {
  /** Lower-case bare domains (`clients.emailDomains`). */
  emailDomains?: readonly string[];
  /** The client's contact emails (`clientContacts.email`). */
  contactEmails?: readonly string[];
};

export type ClientMatch<C> = { client: C; via: "contact" | "domain" | "subdomain" };

/**
 * Resolve a sender to a client (§5.2 step 5): an exact contact email first,
 * then an exact client domain, then a subdomain of a client domain
 * (`mail.pragmatico.hu` → `pragmatico.hu`, the longest domain wins). Public
 * mail domains never match by domain. Two clients tied at the deciding step
 * → null (ambiguous: the agent asks, nothing is guessed).
 */
export function matchClientByDomain<C extends ClientMatchCandidate>(
  email: string,
  clients: readonly C[],
): ClientMatch<C> | null {
  const address = email.trim().toLowerCase();
  const single = <T>(list: T[]): T | null => (list.length === 1 ? list[0] : null);

  const byContact = clients.filter((c) =>
    (c.contactEmails ?? []).some((e) => e.trim().toLowerCase() === address),
  );
  if (byContact.length > 0) {
    const client = single(byContact);
    return client ? { client, via: "contact" } : null;
  }

  const domain = emailDomain(address);
  if (!domain || isPublicMailDomain(domain)) return null;
  const domainsOf = (c: C) =>
    (c.emailDomains ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter((d) => d.length > 0 && !isPublicMailDomain(d));

  const exact = clients.filter((c) => domainsOf(c).includes(domain));
  if (exact.length > 0) {
    const client = single(exact);
    return client ? { client, via: "domain" } : null;
  }

  let best: { length: number; clients: C[] } = { length: 0, clients: [] };
  for (const c of clients) {
    for (const d of domainsOf(c)) {
      if (!domain.endsWith(`.${d}`)) continue;
      if (d.length > best.length) best = { length: d.length, clients: [c] };
      else if (d.length === best.length && !best.clients.includes(c)) best.clients.push(c);
    }
  }
  const client = single(best.clients);
  return client ? { client, via: "subdomain" } : null;
}

// ─── Subjects ───────────────────────────────────────────────────────────────

// Reply / forward prefixes: EN, HU (Gmail "Válasz", "Továbbítás"; Outlook HU
// "Vá", "Továbbítva"), Nordic "VS" / "SV", German "AW" / "WG", French "TR",
// with an optional counter ("Re[2]:", "RE (3):").
const SUBJECT_PREFIX_RE =
  /^\s*(?:re|fwd?|fw|valasz|va|tovabbitas|tovabbitva|tovabbitott|vs|sv|aw|wg|tr)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*/;

/** "Re: RE: Fwd: Válasz: Black Friday" → "Black Friday" (repeats removed, spaces collapsed). */
export function normalizeSubject(subject: string): string {
  let rest = subject.replace(/\s+/g, " ").trim();
  for (;;) {
    const match = SUBJECT_PREFIX_RE.exec(foldText(rest));
    if (!match) break;
    rest = rest.slice(match[0].length);
  }
  return rest.trim();
}

/** Task identifiers in a subject ("[PRG-131] Banner" → ["PRG-131"]), unique, in order. */
export function extractTaskIdentifiers(subject: string): string[] {
  const out: string[] = [];
  for (const m of subject.matchAll(/(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{0,9})-([1-9]\d{0,6})(?![A-Za-z0-9-])/g)) {
    if (!isValidIdentifierKey(m[1])) continue;
    const id = `${m[1]}-${m[2]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ─── Quoted history ─────────────────────────────────────────────────────────

export type StripResult = {
  /** The new text the sender wrote (what the agent reads). */
  text: string;
  /** Something was removed (quote, header, signature). */
  strippedSomething: boolean;
  /**
   * The cut is a guess — inline replies interleaved with the quote, or
   * nothing would remain after the cut (then the text is kept whole). The
   * agent should read `bodyHtml` / the thread when this is set.
   */
  lowConfidence: boolean;
};

// "On Fri, Oct 16, 2026 at 3:12 PM Réka <r@p.hu> wrote:" · HU Gmail
// "Kovács Réka <r@p.hu> ezt írta (időpont: 2026. okt. 16., P 15:12):" · HU
// Apple Mail "2026. okt. 16. dátummal, 15:12 időpontban … írta:" · German
// "Am … schrieb …:". Tested on the folded line.
const REPLY_HEADER_END_RE = /\b(?:wrote|irta|schrieb|a ecrit)\b[^\n]{0,80}:\s*$/;
const REPLY_HEADER_START_RE = /^(?:on\s|am\s|le\s|\d{4}\.|\d{1,2}[./]|[a-z]{2,9},?\s+\d)/;
const ORIGINAL_MESSAGE_RE =
  /^-{2,}\s*(?:original message|eredeti uzenet|eredeti level|ursprungliche nachricht|message d'origine)\s*-{2,}\s*$/;
const UNDERSCORE_RULE_RE = /^_{10,}\s*$/;
const HEADER_FROM_RE = /^\**(?:from|felado|von|de)\s*:\**\s*\S/;
const HEADER_DATE_RE = /^\**(?:sent|date|elkuldve|kuldve|datum|gesendet|envoye)\s*:\**\s*\S/;
const HEADER_TO_RE = /^\**(?:to|cimzett|an|a|subject|targy|betreff|objet)\s*:\**/;
const MOBILE_SIGNATURE_RE =
  /^(?:sent from my \w+|sent from (?:outlook|mail|yahoo mail|gmail)\b.*|get outlook for \w+.*|kuldve (?:az |a )?(?:iphone|ipad|android|samsung)[\w-]*.*|elkuldve (?:az |a )?(?:iphone|ipad|android)[\w-]*.*|(?:iphone|ipad|android)[\w-]*(?:rol|rol kuldve)\b.*)$/;
const SIGN_OFF_RE =
  /^(?:udvozlettel|udv|udvozlet|szep napot|kellemes napot|best regards|kind regards|warm regards|regards|best wishes|best|cheers|br|mvg|mfg)[,.!]?\s*$/;

function isQuoteLine(line: string): boolean {
  return /^\s*>/.test(line);
}

const HEADER_ADDRESS_RE = /<\s*[^<>\s]+@[^<>\s]+\s*>/;
const HEADER_TIME_RE = /\b\d{1,2}:\d{2}\b/;
const HEADER_DATE_RE_LOOSE =
  /\b\d{4}\b|\b\d{1,2}[./]\s?\d{1,2}\b|\b(?:jan|feb|mar|apr|maj|may|jun|jul|aug|szep|sep|okt|oct|nov|dec)[a-z]*\.?\s*\d/;

/**
 * Where quoted history starts (header line included), or -1. `suspicious`:
 * a line ends like a reply header ("… írta:", "wrote:") but is not one — no
 * `<address>` and no date + time, or no `>` quote right after it ("Ahogy
 * Gábor a 2. pontnál írta:") — so nothing is cut and the caller flags it.
 */
function findQuoteHeader(lines: string[], folded: string[]): { index: number; suspicious: boolean } {
  let suspicious = false;
  for (let i = 0; i < lines.length; i++) {
    const f = folded[i].trim();
    if (!f || isQuoteLine(lines[i])) continue;
    if (ORIGINAL_MESSAGE_RE.test(f)) return { index: i, suspicious };
    if (HEADER_FROM_RE.test(f)) {
      const window = folded.slice(i + 1, i + 6).map((l) => l.trim());
      if (window.some((l) => HEADER_DATE_RE.test(l)) && window.some((l) => HEADER_TO_RE.test(l))) {
        const above = i > 0 ? folded[i - 1].trim() : "";
        return { index: UNDERSCORE_RULE_RE.test(above) ? i - 1 : i, suspicious };
      }
    }
    if (f.length <= 300 && REPLY_HEADER_END_RE.test(f)) {
      // The header may wrap onto up to two lines: walk up to its first line.
      let start = i;
      for (let back = 1; back <= 2 && i - back >= 0; back++) {
        const prev = folded[i - back].trim();
        if (!prev || isQuoteLine(lines[i - back])) break;
        if (REPLY_HEADER_START_RE.test(prev) && !/[.!?]$/.test(prev)) start = i - back;
      }
      const header = folded.slice(start, i + 1).map((l) => l.trim()).join(" ");
      const looksReal =
        HEADER_ADDRESS_RE.test(header) || (HEADER_TIME_RE.test(header) && HEADER_DATE_RE_LOOSE.test(header));
      const nextLine = lines.slice(i + 1).find((l) => l.trim());
      if (looksReal && nextLine !== undefined && isQuoteLine(nextLine)) return { index: start, suspicious };
      suspicious = true;
    }
  }
  return { index: -1, suspicious };
}

/** A P.S. line ("Ui.:", "U.i.", "P.S.", "PS") — always the sender's own words. */
const POSTSCRIPT_RE = /^(?:ui|u\.\s?i|p\.\s?s|ps)\b/;

/**
 * A line after a signature boundary that must never be cut: a P.S., or a
 * line firing a hard trigger (a request after the name). Links are not
 * counted here — a website line is the most common signature line.
 */
function isProtectedTailLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return POSTSCRIPT_RE.test(foldText(trimmed)) || hardTriggers(trimmed, { hasLink: false }).length > 0;
}

/**
 * The authored part's signature: `-- ` delimiter, mobile footer, sign-off
 * block. A boundary whose tail holds a protected line (`isProtectedTailLine`)
 * is not cut.
 */
function stripSignature(lines: string[]): { lines: string[]; stripped: boolean } {
  const folded = lines.map((l) => foldText(l).trim());
  const tailIsSafe = (from: number) => !lines.slice(from).some(isProtectedTailLine);
  for (let i = 0; i < lines.length; i++) {
    const delimiter = lines[i].trimEnd() === "--" || lines[i] === "-- ";
    if (delimiter && lines.slice(0, i).some((l) => l.trim()) && tailIsSafe(i + 1)) {
      return { lines: lines.slice(0, i), stripped: true };
    }
    if (MOBILE_SIGNATURE_RE.test(folded[i]) && tailIsSafe(i + 1)) {
      return { lines: lines.slice(0, i), stripped: true };
    }
  }
  // A sign-off ("Üdvözlettel,") followed only by a few short lines (name,
  // title, company, phone) ends the authored text. Never when it would leave
  // nothing, never when a question, a P.S. or a request follows it.
  for (let i = lines.length - 1; i >= 1; i--) {
    if (!SIGN_OFF_RE.test(folded[i])) continue;
    const tail = lines.slice(i + 1).filter((l) => l.trim());
    const shortTail = tail.length <= 6 && tail.every((l) => l.trim().length <= 60 && !l.includes("?"));
    const hasBody = lines.slice(0, i).some((l) => l.trim());
    if (shortTail && hasBody && tailIsSafe(i + 1)) return { lines: lines.slice(0, i), stripped: true };
    break;
  }
  return { lines, stripped: false };
}

function tidy(lines: string[]): string {
  return lines
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip quoted history from a plain-text email body (§5.2 step 4): Gmail
 * "On … wrote:" / HU "… írta:" headers, Outlook "From: / Sent: / To:" blocks
 * and "-----Original Message-----", Apple Mail, `>` lines, and the
 * signature ("-- ", "Sent from my iPhone", a closing "Üdvözlettel," block).
 * Text above the quote is kept; inline replies interleaved with `>` quotes
 * are kept too (flagged `lowConfidence`). A forwarded message ("----------
 * Forwarded message ---------") is NOT stripped — it is the content.
 */
export function stripQuoted(input: string): StripResult {
  const original = input.replace(/\r\n?/g, "\n");
  const lines = original.split("\n");
  const folded = lines.map((l) => foldText(l));
  let lowConfidence = false;
  let stripped = false;

  let authored: string[];
  const found = findQuoteHeader(lines, folded);
  const header = found.index;
  if (found.suspicious) lowConfidence = true;
  if (header >= 0) {
    stripped = true;
    const before = lines.slice(0, header);
    const after = lines.slice(header + 1);
    const afterQuoted = after.filter((l) => l.trim() && isQuoteLine(l));
    // Inline replies: `>` quotes after the header with our own lines between
    // them (not just a trailing signature of the quoted mail).
    const interleaved = afterQuoted.length > 0 && hasLinesBetweenQuotes(after);
    if (interleaved) {
      lowConfidence = true;
      authored = [...before, ...after.filter((l) => !isQuoteLine(l) && !isHeaderContinuation(l))];
    } else {
      authored = before;
    }
  } else {
    const quoteCount = lines.filter((l) => l.trim() && isQuoteLine(l)).length;
    if (quoteCount > 0) {
      stripped = true;
      if (hasLinesBetweenQuotes(lines)) lowConfidence = true;
      authored = lines.filter((l) => !isQuoteLine(l));
    } else {
      authored = lines;
    }
  }

  const signature = stripSignature(authored);
  if (signature.stripped) stripped = true;
  const text = tidy(signature.lines);
  if (!text) {
    // Nothing of ours would remain (an empty reply over a quote, a stray
    // header): keep the whole body rather than lose it, and say so.
    return { text: tidy(lines), strippedSomething: false, lowConfidence: stripped || lowConfidence };
  }
  return { text, strippedSomething: stripped, lowConfidence };
}

/** True when non-quote, non-blank lines sit between two `>` lines. */
function hasLinesBetweenQuotes(lines: string[]): boolean {
  let sawQuote = false;
  let ownAfterQuote = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isQuoteLine(line)) {
      if (ownAfterQuote) return true;
      sawQuote = true;
    } else if (sawQuote) {
      ownAfterQuote = true;
    }
  }
  return false;
}

function isHeaderContinuation(line: string): boolean {
  return /^\s*<?[^\s@]+@[^\s@]+>?\s*(?:wrote|írta|irta)?:?\s*$/i.test(line);
}

// ─── Hard triggers (D4) ─────────────────────────────────────────────────────

type TriggerWord = {
  /** The id stored in `classification.triggers` ("word:kérnénk"). */
  label: string;
  /** Folded whole-token forms. */
  forms?: readonly string[];
  /** Folded stems: any token starting with one matches. */
  stems?: readonly string[];
};

/**
 * Instruction words (folded). Hungarian first — the D4 list (kérnénk,
 * lehetne, még, mehet, kellene, javítsátok) with common inflections, plus
 * the request verbs real emails use (szeretnénk, tudnátok, legyen, módosít,
 * cserél, töröl, küldjétek, hiba …). English: polite asks and change verbs.
 */
export const TRIGGER_WORDS: readonly TriggerWord[] = [
  { label: "kérnénk", forms: ["kernenk", "kernem", "kernek", "kerne", "kernetek", "kerjuk", "kerem", "kerlek", "kerjetek", "kerhetnenk", "kerhetnem", "kerhetem", "kerhetek", "kerek", "kerunk"] },
  { label: "lehetne", forms: ["lehetne", "lehetnenek", "lehetnek", "lehetseges"] },
  { label: "még", forms: ["meg", "megis", "megsem"] },
  { label: "mehet", forms: ["mehet", "mehetne", "mehetnek", "mehetunk", "mehetnenk"] },
  { label: "kellene", forms: ["kell", "kellene", "kellenne", "kellenenek", "kellenek", "kellett", "kene", "kenne"] },
  { label: "lenne", forms: ["lenne", "lennenek"] },
  { label: "szükség", stems: ["szukseg"] },
  { label: "csináljátok", stems: ["csinal"] },
  { label: "készítsétek", stems: ["keszit"] },
  { label: "javítsátok", stems: ["javit", "kijavit"] },
  { label: "szeretnénk", forms: ["szeretnenk", "szeretnem", "szeretnek", "szeretnetek"] },
  { label: "tudnátok", forms: ["tudnatok", "tudnad", "tudnal", "tudna", "tudnanak", "tudnank"] },
  { label: "legyen", forms: ["legyen", "legyenek", "legyetek"] },
  { label: "módosítsátok", stems: ["modosit"] },
  { label: "cseréljétek", stems: ["cserel"] },
  { label: "töröljétek", stems: ["torol"] },
  { label: "küldjétek", stems: ["kuldj", "kuldd", "kuldenetek", "kuldenel"] },
  { label: "tegyétek", forms: ["tegyetek", "tedd", "tegyuk", "tennetek"] },
  { label: "hozzáadni", stems: ["hozzaad", "hozzatenn"] },
  { label: "hiba", stems: ["hiba", "hibas", "hibat"] },
  { label: "sürgős", stems: ["surgos"] },
  { label: "élesítés", stems: ["elesit"] },
  { label: "please", forms: ["please", "pls", "plz", "kindly"] },
  { label: "need", forms: ["need", "needs", "needed"] },
  { label: "should", forms: ["should", "must"] },
  { label: "change", forms: ["change", "changes", "update", "fix", "add", "remove", "delete", "replace", "instead", "adjust", "swap"] },
  { label: "urgent", forms: ["asap", "urgent", "urgently"] },
  { label: "broken", forms: ["broken", "bug", "wrong", "missing", "issue", "error"] },
];

/** Multi-word triggers (folded tokens in sequence). */
export const TRIGGER_PHRASES: ReadonlyArray<{ label: string; tokens: readonly string[] }> = [
  { label: "nem működik", tokens: ["nem", "mukodik"] },
  { label: "jó lenne", tokens: ["jo", "lenne"] },
  { label: "could you", tokens: ["could", "you"] },
  { label: "can you", tokens: ["can", "you"] },
  { label: "would you", tokens: ["would", "you"] },
  { label: "go ahead", tokens: ["go", "ahead"] },
  { label: "go live", tokens: ["go", "live"] },
  { label: "make sure", tokens: ["make", "sure"] },
  { label: "not working", tokens: ["not", "working"] },
];

export type TriggerContext = {
  hasAttachment?: boolean;
  hasLink?: boolean;
  /** A recipient on this message who was not on the thread before. */
  newRecipient?: boolean;
};

/**
 * D4 hard triggers in a (quote-stripped) message, as stable ids:
 * `question_mark`, `word:<label>` per instruction word / phrase,
 * `attachment`, `link`, `new_recipient`. Unique, in that order. A link is
 * detected from the text too when `hasLink` is not given.
 */
export function hardTriggers(text: string, context: TriggerContext = {}): string[] {
  const hits: string[] = [];
  const add = (id: string) => {
    if (!hits.includes(id)) hits.push(id);
  };
  const withoutUrls = text.replace(URL_RE, " ");
  // "?" and its full-width / Arabic forms; a "?" inside a URL is the link's.
  if (/[?？؟]/.test(withoutUrls)) add("question_mark");

  const tokens = tokenize(foldText(withoutUrls)).map((t) => t.word);
  const wordHits = new Set<string>();
  for (const token of tokens) {
    for (const trigger of TRIGGER_WORDS) {
      if (
        trigger.forms?.includes(token) ||
        trigger.stems?.some((stem) => token.startsWith(stem))
      ) {
        wordHits.add(trigger.label);
      }
    }
  }
  for (const phrase of TRIGGER_PHRASES) {
    const n = phrase.tokens.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      if (phrase.tokens.every((t, k) => tokens[i + k] === t)) {
        wordHits.add(phrase.label);
        break;
      }
    }
  }
  // Report in declaration order (stable for tests and the Inbox reason line).
  for (const trigger of [...TRIGGER_WORDS, ...TRIGGER_PHRASES]) {
    if (wordHits.has(trigger.label)) add(`word:${trigger.label}`);
  }
  if (context.hasAttachment) add("attachment");
  if (context.hasLink ?? containsLink(text)) add("link");
  if (context.newRecipient) add("new_recipient");
  return hits;
}

// ─── Acknowledge shortcut (§6.3) ────────────────────────────────────────────

/** The thank-you words one of which a candidate must contain (folded). */
const THANKS_WORDS: ReadonlySet<string> = new Set([
  "koszonom", "koszonjuk", "koszonet", "koszonettel", "koszi", "koszike", "kosz", "koszonok",
  "thanks", "thank", "thx", "ty", "cheers",
]);

/**
 * Everything else a pure thank-you may contain (folded). Deliberately
 * closed: any other word ("rendben", "így jó", "tökéletes", "great") makes
 * the message NOT a candidate — the model then decides between acknowledge
 * and approve (D32), never this shortcut.
 */
const THANKS_FILLER: ReadonlySet<string> = new Set([
  "szepen", "nagyon", "igazan", "tenyleg", "mindent", "mindenkinek", "is", "en", "mi", "a", "az",
  "gyors", "valaszt", "valaszodat", "segitseget", "munkat", "munkatokat", "infot", "informaciot",
  "visszajelzest", "szia", "sziasztok", "hello", "hallo", "hali", "udv", "udvozlettel", "udvozlet",
  "you", "so", "much", "very", "many", "lot", "for", "the", "everything", "all", "again", "guys",
  "team", "everyone", "quick", "reply", "response", "help", "hi", "hey", "best", "regards", "kind",
  "br", "megkaptam", "megkaptuk", "megjott", "received", "got", "it",
]);

const GREETING_START_RE = /^(?:szia|sziasztok|hello|hallo|hali|hi|hey|kedves|dear|jo napot)\b/;

/** Max length of a candidate after stripping (characters). */
export const ACKNOWLEDGE_MAX_CHARS = 200;

/**
 * The deterministic acknowledge shortcut (§6.3): true only when NO hard
 * trigger fired AND the text is short AND it is nothing but a thank-you —
 * thanks words from a closed vocabulary, an optional greeting line
 * ("Szia Ádám!") and an optional name line at the end ("Anna"). Emoji and
 * punctuation are ignored.
 */
export function isAcknowledgeCandidate(text: string, triggers: readonly string[]): boolean {
  if (triggers.length > 0) return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > ACKNOWLEDGE_MAX_CHARS) return false;

  // Segments split at line breaks and sentence punctuation; names are only
  // allowed in the greeting (first) and the sign-off (last) segment.
  let segments = trimmed.split(/[\n,.!;:]+/).map((seg) => seg.trim()).filter(Boolean);
  const isVocab = (word: string) => {
    const f = foldText(word);
    return THANKS_WORDS.has(f) || THANKS_FILLER.has(f);
  };
  const isName = (word: string) => /^\p{Lu}[\p{L}'-]*$/u.test(word) && !isVocab(word);
  if (segments.length > 1) {
    // Emoji and other letter-less "words" are ignored.
    const words = segments[segments.length - 1].split(/\s+/).filter((w) => /\p{L}/u.test(w));
    if (words.length <= 3 && words.every((w) => isName(w) || isVocab(w)) && words.some(isName)) {
      segments = [...segments.slice(0, -1), words.filter((w) => !isName(w)).join(" ")];
    }
  }
  if (segments.length > 1) {
    const first = segments[0];
    if (GREETING_START_RE.test(foldText(first)) && first.split(/\s+/).length <= 4) {
      segments = segments.slice(1);
    }
  }

  const tokens = tokenize(foldText(segments.join(" "))).map((t) => t.word);
  if (tokens.length === 0 || tokens.length > 20) return false;
  if (!tokens.some((t) => THANKS_WORDS.has(t))) return false;
  return tokens.every((t) => THANKS_WORDS.has(t) || THANKS_FILLER.has(t));
}

// ─── Dates ──────────────────────────────────────────────────────────────────

export type ExtractedDate = {
  /** YYYY-MM-DD (org timezone), or null when ambiguous. */
  date: string | null;
  /** The phrase as written in the email. */
  phrase: string;
  kind: "explicit" | "weekday" | "relative";
  /** Set for numeric formats that could be day/month or month/day. */
  ambiguous?: true;
  /** For an ambiguous phrase: the readings (YYYY-MM-DD) it could mean. */
  candidates?: string[];
};

const MONTHS: ReadonlyArray<{ month: number; names: readonly string[] }> = [
  { month: 1, names: ["januar", "january", "jan"] },
  { month: 2, names: ["februar", "february", "febr", "feb"] },
  { month: 3, names: ["marcius", "march", "marc", "mar"] },
  { month: 4, names: ["aprilis", "april", "apr"] },
  { month: 5, names: ["majus", "may", "maj"] },
  { month: 6, names: ["junius", "june", "jun"] },
  { month: 7, names: ["julius", "july", "jul"] },
  { month: 8, names: ["augusztus", "august", "aug"] },
  { month: 9, names: ["szeptember", "september", "szept", "sept", "sep"] },
  { month: 10, names: ["oktober", "october", "okt", "oct"] },
  { month: 11, names: ["november", "nov"] },
  { month: 12, names: ["december", "dec"] },
];
const MONTH_BY_NAME = new Map<string, number>(
  MONTHS.flatMap(({ month, names }) => names.map((n) => [n, month] as const)),
);
// Longest first so "szeptember" wins over "szept".
const MONTH_ALT = [...MONTH_BY_NAME.keys()].sort((a, b) => b.length - a.length).join("|");

/** Weekday qualifiers (folded) that point back in time. */
const PAST_QUALIFIERS: ReadonlySet<string> = new Set(["mult", "last", "elozo", "previous"]);

/** Weekday stems (folded) → 0 = Sunday … 6 = Saturday. */
const WEEKDAYS: ReadonlyArray<{ day: number; re: string }> = [
  { day: 1, re: "hetfo|monday" },
  { day: 2, re: "kedd|tuesday" },
  { day: 3, re: "szerda|wednesday" },
  { day: 4, re: "csutortok|thursday" },
  { day: 5, re: "pentek|friday" },
  { day: 6, re: "szombat|saturday" },
  { day: 0, re: "vasarnap|sunday" },
];

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A month/day with no year: the year that puts it closest to `today`. */
function nearestYear(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  let best: { date: string; distance: number } | null = null;
  for (const y of [year - 1, year, year + 1]) {
    if (!isValidYmd(y, m, d)) continue;
    const date = ymd(y, m, d);
    const distance = Math.abs(Date.parse(`${date}T00:00:00Z`) - todayMs);
    if (!best || distance < best.distance) best = { date, distance };
  }
  return best?.date ?? null;
}

function resolveDayMonth(
  first: number,
  second: number,
  year: number | null,
  today: string,
  order: "month-first" | "either",
): { date: string | null; candidates?: string[] } {
  const reading = (m: number, d: number) =>
    year !== null ? (isValidYmd(year, m, d) ? ymd(year, m, d) : null) : nearestYear(m, d, today);
  if (order === "month-first") return { date: reading(first, second) };
  const asMonthFirst = first <= 12 ? reading(first, second) : null;
  const asDayFirst = second <= 12 ? reading(second, first) : null;
  if (asMonthFirst && asDayFirst && asMonthFirst !== asDayFirst) {
    return { date: null, candidates: [asMonthFirst, asDayFirst] };
  }
  return { date: asMonthFirst ?? asDayFirst };
}

/** ISO week (Monday-based) start of a date. */
function mondayOf(date: string): string {
  const offset = (weekdayOf(date) + 6) % 7;
  return addCalendarDays(date, -offset);
}

/**
 * Explicit dates and day words in an email, resolved in the org timezone
 * against the message's arrival (`receivedAtMs`):
 *   - year-first numeric (2026-10-24, 2026.10.24., 2026. 10. 24.) — exact;
 *   - month names, HU / EN, with HU suffixes (okt. 24., október 24-ig,
 *     2026. okt. 24., Oct 24th, 24 October 2026);
 *   - HU month.day. (10.24.) and slash / dot day-month forms with the year
 *     last (24/10/2026) — resolved only when one number is > 12, otherwise
 *     returned `ambiguous` with both readings, never guessed;
 *   - weekday words (hétfőre, péntekig, szerdán, by Monday, on Friday): the
 *     next such day strictly after the arrival date; HU "jövő <nap>" is that
 *     day in NEXT week; EN "next <day>" too, but ambiguous when that day is
 *     still ahead this week;
 *   - today / tomorrow (ma, mára, holnap, holnapra, holnapután).
 * A date without a year takes the year that puts it closest to the arrival.
 */
export function extractDates(text: string, receivedAtMs: number, tz: string): ExtractedDate[] {
  const folded = foldText(text);
  const today = localDateOf(receivedAtMs, tz);
  const found: Array<ExtractedDate & { start: number; end: number }> = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const push = (start: number, end: number, entry: ExtractedDate) => {
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    found.push({ ...entry, phrase: text.slice(start, end).trim(), start, end });
  };
  const scan = (re: RegExp, handle: (m: RegExpExecArray) => ExtractedDate | null) => {
    for (const m of folded.matchAll(re)) {
      const entry = handle(m as RegExpExecArray);
      if (entry) push(m.index, m.index + m[0].length, entry);
    }
  };
  const SUFFIX = "(?:\\.|-?(?:an|en|on|ig|re|ra|ei|ai|ji|je|ja|i|a|e|n|th|st|nd|rd)\\b)?";

  // 1. Year first, numeric: 2026-10-24 · 2026.10.24. · 2026. 10. 24.
  scan(new RegExp(`\\b(\\d{4})(?:-|\\.\\s?|/)(\\d{1,2})(?:-|\\.\\s?|/)(\\d{1,2})${SUFFIX}`, "g"), (m) => {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? { date: ymd(y, mo, d), phrase: "", kind: "explicit" } : null;
  });

  // 2. (Year.) month-name day: "2026. okt. 24.", "október 24-ig", "Oct 24th, 2026".
  scan(
    new RegExp(
      `(?:\\b(\\d{4})\\.?\\s*)?\\b(${MONTH_ALT})(\\.)?\\s*(\\d{1,2})${SUFFIX}(?:,\\s*(\\d{4})\\b)?`,
      "g",
    ),
    (m) => {
      const name = m[2];
      // HU "már" (already) folds onto EN "mar": a bare "mar" needs its dot.
      if (name === "mar" && !m[3]) return null;
      const month = MONTH_BY_NAME.get(name)!;
      const day = Number(m[4]);
      const year = m[1] ? Number(m[1]) : m[5] ? Number(m[5]) : null;
      const date =
        year !== null ? (isValidYmd(year, month, day) ? ymd(year, month, day) : null) : nearestYear(month, day, today);
      return date ? { date, phrase: "", kind: "explicit" } : null;
    },
  );

  // 3. Day month-name (year): "24 October 2026", "24. okt.".
  scan(new RegExp(`\\b(\\d{1,2})(?:\\.|th|st|nd|rd)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b(\\.)?(?:,?\\s*(\\d{4})\\b)?`, "g"), (m) => {
    const name = m[2];
    if (name === "mar" && !m[3]) return null; // HU "már", see above
    const month = MONTH_BY_NAME.get(name)!;
    const day = Number(m[1]);
    const year = m[4] ? Number(m[4]) : null;
    const date =
      year !== null ? (isValidYmd(year, month, day) ? ymd(year, month, day) : null) : nearestYear(month, day, today);
    return date ? { date, phrase: "", kind: "explicit" } : null;
  });

  // 4. Numeric with the year last: 24/10/2026 · 10/24/2026 · 24.10.2026.
  scan(/\b(\d{1,2})([./])\s?(\d{1,2})\2\s?(\d{4})\b\.?/g, (m) => {
    const resolved = resolveDayMonth(Number(m[1]), Number(m[3]), Number(m[4]), today, "either");
    if (resolved.candidates) return { date: null, phrase: "", kind: "explicit", ambiguous: true, candidates: resolved.candidates };
    return resolved.date ? { date: resolved.date, phrase: "", kind: "explicit" } : null;
  });

  // 5. No year: HU "10.24." (month.day.). Slash forms need a year ("24/7"
  // is not July 24).
  scan(/(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?![\d])/g, (m) => {
    const resolved = resolveDayMonth(Number(m[1]), Number(m[2]), null, today, "either");
    if (resolved.candidates) return { date: null, phrase: "", kind: "explicit", ambiguous: true, candidates: resolved.candidates };
    return resolved.date ? { date: resolved.date, phrase: "", kind: "explicit" } : null;
  });

  // 6. Weekdays: (jövő|next|this|by|on) <day><HU suffix>.
  for (const { day, re } of WEEKDAYS) {
    scan(
      // "Black Friday" / "Cyber Monday" are campaigns, not dates.
      new RegExp(
        `(?:\\b(jovo|next|this|ezen a|mult|last|elozo|previous)\\s+)?(?<!black\\s)(?<!cyber\\s)\\b(?:${re})(?:re|ra|ig|n|en|on|an|i|ja|je)?\\b`,
        "g",
      ),
      (m) => {
        const qualifier = m[1];
        // "múlt pénteki anyag", "last Friday": a past day is not a deadline.
        if (qualifier && PAST_QUALIFIERS.has(qualifier)) return null;
        const todayWeekday = weekdayOf(today);
        const ahead = ((day - todayWeekday + 7) % 7) || 7; // strictly after today
        const nextOccurrence = addCalendarDays(today, ahead);
        if (qualifier === "jovo" || qualifier === "next") {
          const nextWeek = addCalendarDays(mondayOf(today), 7 + ((day + 6) % 7));
          if (qualifier === "next" && nextOccurrence !== nextWeek) {
            return { date: null, phrase: "", kind: "weekday", ambiguous: true, candidates: [nextOccurrence, nextWeek] };
          }
          return { date: nextWeek, phrase: "", kind: "weekday" };
        }
        return { date: nextOccurrence, phrase: "", kind: "weekday" };
      },
    );
  }

  // 7. Today / tomorrow.
  scan(/\b(holnaputan|holnap(?:ra|ig)?|tomorrow|today|tonight|mara|ma)\b/g, (m) => {
    const word = m[1];
    const offset = word === "holnaputan" ? 2 : word.startsWith("holnap") || word === "tomorrow" ? 1 : 0;
    return { date: addCalendarDays(today, offset), phrase: "", kind: "relative" };
  });

  return found
    .sort((a, b) => a.start - b.start)
    .map(({ start: _s, end: _e, ...entry }) => {
      void _s;
      void _e;
      return entry;
    });
}

// ─── Urgency + due date (§6.1) ──────────────────────────────────────────────

const URGENT_PHRASES: ReadonlyArray<readonly string[]> = [
  ["elesben", "hibas"], ["elesben", "nem"], ["minel", "elobb"], ["mielobb"], ["azonnal"],
  ["surgos"], ["surgosen"], ["asap"], ["urgent"], ["urgently"], ["right", "away"], ["as", "soon", "as", "possible"],
  ["nem", "mukodik"], ["leallt"], ["is", "down"], ["not", "working"],
];

/** The urgency phrase in a message ("élesben hibás", "ASAP"), or null. */
export function detectUrgency(text: string): string | null {
  const tokens = tokenize(foldText(text)).map((t) => t.word);
  for (const phrase of URGENT_PHRASES) {
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
      if (phrase.every((p, k) => tokens[i + k] === p)) return phrase.join(" ");
    }
  }
  return null;
}

export type DueDateDecision = {
  date: string;
  source: "email" | "urgent" | "default";
  /** The email phrase it came from (email), the urgency phrase (urgent). */
  phrase?: string;
};

/**
 * §6.1 due date: a resolved date in the email wins (the earliest one on or
 * after the arrival date — a deadline, not a past reference); otherwise an
 * urgent email gets today; otherwise arrival + N working days (default 2).
 * Ambiguous dates never win — the agent asks instead (D18).
 */
export function resolveDueDate(args: {
  receivedAtMs: number;
  tz: string;
  dates: readonly ExtractedDate[];
  urgentPhrase?: string | null;
  defaultWorkingDays?: number;
}): DueDateDecision {
  const today = localDateOf(args.receivedAtMs, args.tz);
  const upcoming = args.dates
    .filter((d): d is ExtractedDate & { date: string } => d.date !== null && !d.ambiguous && d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (upcoming.length > 0) return { date: upcoming[0].date, source: "email", phrase: upcoming[0].phrase };
  if (args.urgentPhrase) return { date: today, source: "urgent", phrase: args.urgentPhrase };
  return {
    date: addWorkingDays(args.receivedAtMs, args.defaultWorkingDays ?? DEFAULT_DUE_WORKING_DAYS, args.tz),
    source: "default",
  };
}

// ─── Bulk / automated (D24 skip layer) ──────────────────────────────────────

/** Gmail labels that never reach Triage (D24). */
export const SKIPPED_GMAIL_LABELS: ReadonlySet<string> = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "SPAM",
  "TRASH",
]);

export type MailHeaders = Record<string, string | undefined> | ReadonlyArray<{ name: string; value: string }>;

const AUTO_REPLY_SUBJECT_RE =
  /^(?:automatic reply|auto(?:matic)?[- ]?(?:reply|response)|out of (?:the )?office|automatikus valasz|hazon kivul|abwesenheitsnotiz)\b/;
const NO_REPLY_SENDER_RE = /(?:^|<)\s*(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster)[^@\s]*@/;

export type BulkSignals = {
  /** Bulk, junk or machine mail: never enters Triage, whoever sent it. */
  drop: boolean;
  /**
   * Mailing-list headers only (`List-Unsubscribe`, `List-Id`, `Precedence:
   * list`). NOT a drop on its own: a Google Groups alias (hello@agency →
   * the team) adds them to ordinary client mail. The B3 filter decides with
   * sender context — see `skipBeforeTriage`.
   */
  list: boolean;
  /** Every signal that fired, e.g. `precedence:bulk`, `list_unsubscribe`. */
  reasons: string[];
};

/**
 * D24 layer 1 as signals, for the B3 filter.
 *   drop: `precedence:bulk|junk`, `auto_submitted:<v>` (anything but "no"),
 *         `autoreply_header`, `autoreply_subject`, `noreply_sender`,
 *         `label:<GMAIL_LABEL>` (Promotions / Social / Updates / Forums /
 *         Spam / Trash).
 *   list: `list_unsubscribe`, `list_id`, `precedence:list`.
 * The decision itself is `skipBeforeTriage(signals, sender)`.
 */
export function isBulkOrAutomated(
  headers: MailHeaders,
  options: { labelIds?: readonly string[] } = {},
): BulkSignals {
  const map = new Map<string, string>();
  const entries = Array.isArray(headers)
    ? (headers as ReadonlyArray<{ name: string; value: string }>).map((h) => [h.name, h.value] as const)
    : Object.entries(headers as Record<string, string | undefined>);
  for (const [name, value] of entries) {
    if (value !== undefined && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), value);
  }
  const drop: string[] = [];
  const list: string[] = [];
  if (map.has("list-unsubscribe")) list.push("list_unsubscribe");
  if (map.has("list-id")) list.push("list_id");
  const precedence = map.get("precedence")?.trim().toLowerCase();
  if (precedence === "list") list.push("precedence:list");
  else if (precedence === "bulk" || precedence === "junk") drop.push(`precedence:${precedence}`);
  const autoSubmitted = map.get("auto-submitted")?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") drop.push(`auto_submitted:${autoSubmitted.split(";")[0].trim()}`);
  if (map.has("x-autoreply") || map.has("x-autorespond")) drop.push("autoreply_header");
  const subject = map.get("subject");
  if (subject && AUTO_REPLY_SUBJECT_RE.test(foldText(subject.trim()))) drop.push("autoreply_subject");
  const from = map.get("from");
  if (from && NO_REPLY_SENDER_RE.test(from.toLowerCase())) drop.push("noreply_sender");
  for (const label of options.labelIds ?? []) {
    if (SKIPPED_GMAIL_LABELS.has(label)) drop.push(`label:${label}`);
  }
  return { drop: drop.length > 0, list: list.length > 0, reasons: [...drop, ...list] };
}

/**
 * The D24 skip decision for B3 (TODO(B3): email/ingest.ts calls it after
 * resolving the sender): drop signals always skip; list signals skip only
 * mail that is neither from a known client sender (contact email or client
 * domain, `matchClientByDomain`) nor on a tracked thread.
 */
export function skipBeforeTriage(
  signals: BulkSignals,
  sender: { knownClientSender: boolean; trackedThread: boolean },
): boolean {
  if (signals.drop) return true;
  return signals.list && !sender.knownClientSender && !sender.trackedThread;
}
