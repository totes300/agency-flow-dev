/**
 * Pure rules of the Gmail sync (docs/prd-email-triage.md B3, D24, D33,
 * D34, D36, §5.2, I1, I13). No Convex, no network — shared by the V8
 * functions (`email/sync.ts`) and the Node action (`email/syncNode.ts`),
 * and unit-tested.
 */

import { skipBeforeTriage, SKIPPED_GMAIL_LABELS, type BulkSignals } from "./model";

// ─── Limits ──────────────────────────────────────────────────────────────────

/** A sync run holds the mailbox this long — longer than a Node action may run (10 min), so a lease never ends under a live run. */
export const SYNC_LEASE_MS = 11 * 60_000;
/** Messages fetched per run; the next run (1 min later) continues. */
export const SYNC_RUN_MESSAGE_CAP = 100;
/** A run stops taking new work after this long (well inside the lease). */
export const SYNC_RUN_TIME_BUDGET_MS = 4 * 60_000;
/** History records per page. */
export const SYNC_HISTORY_PAGE_SIZE = 100;
/** The bounded resync (D34 recovery button, expired cursor): Gmail search — the inbox and sent mail, no categories (D24). */
export const RESYNC_QUERY = "newer_than:7d (in:inbox OR in:sent) -category:{promotions social updates forums}";
export const RESYNC_PAGE_SIZE = 100;
/** An attachment larger than this is listed with its size, never stored (B3). */
export const MAX_STORED_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** A mailbox failing this long gets a "Mailbox not syncing" Triage item. */
export const SYNC_ATTENTION_AFTER_MS = 10 * 60_000;
/** Parser caps in characters (the byte budget below is the real bound). */
export const STORED_TEXT_CAP = 100_000;
export const STORED_HTML_CAP = 300_000;
/** A downloaded message is retried this often (a crash mid-parse); then it is recorded as unprocessable and passed. */
export const MAX_MESSAGE_ATTEMPTS = 3;
/** Unprocessable messages remembered on the connector row. */
export const UNPROCESSABLE_CAP = 20;
/** An idle run (nothing new, no error to clear) writes `lastSyncAt` at most this often. */
export const LAST_SYNC_WRITE_EVERY_MS = 5 * 60_000;
export const THREAD_PARTICIPANTS_CAP = 50;
/** A Date header further in the future than this is not trusted (Gmail's internalDate wins). */
export const DATE_SKEW_MS = 24 * 60 * 60_000;

/** Gmail labels a synced message must carry one of (D24: the inbox and our own sent mail). */
export const SYNCED_LABELS: ReadonlySet<string> = new Set(["INBOX", "SENT"]);

// ─── The D24 decision ────────────────────────────────────────────────────────

export type IngestSkipReason =
  | "duplicate" //            I1: this mailbox already has the Gmail message
  | "internal" //             a colleague's (authenticated) mail in the inbox — not client mail
  | "not_inbox" //            neither INBOX nor SENT (drafts, archived-only, chat)
  | "label" //                Promotions / Social / Updates / Forums / Spam / Trash
  | "bulk" //                 bulk / automated headers (model.skipBeforeTriage)
  | "app_sent" //             our own send (B5) — stored by the send pipeline
  | "untracked_outbound" //   a team member's mail on a conversation we don't track
  | "ignored_domain" //       orgSettings.ignoredEmailDomains
  | "unknown_sender_member"; // I13: unknown sender in a member's mailbox

export type IngestFacts = {
  labelIds: readonly string[];
  signals: BulkSignals;
  /** Our own mail: the message carries Gmail's SENT label (M3 — a From header alone proves nothing). */
  outbound: boolean;
  /** Inbound with a team member's address in From: a colleague when authenticated, else forged (M3). */
  teamSender: boolean;
  /** Gmail's Authentication-Results: DMARC pass, or SPF / DKIM pass aligned with the From domain (M1). */
  senderVerified: boolean;
  /** The (verified) sender is already a participant of the conversation it is tracked on (M2). */
  senderIsParticipant: boolean;
  /** I1: (connector, gmailMessageId) is already stored. */
  alreadyStored: boolean;
  /** The Message-ID is one of our own sends (a B5 draft in flight, or an outbound row we stored). */
  appSent: boolean;
  ignoredDomain: boolean;
  /** A client contact email or a client domain (`matchClientByDomain`) — AND authenticated (M1). */
  knownClientSender: boolean;
  /** The Gmail thread is stored for this mailbox, a References / In-Reply-To hit, or the client's task id in the subject. */
  trackedThread: boolean;
  mailboxOwnerIsAdmin: boolean;
};

export type IngestDecision =
  | { store: false; reason: IngestSkipReason }
  | {
      store: true;
      direction: "inbound" | "outbound";
      /** Neither a known client nor a tracked thread: B4 screens it (`screenSender`) — admin mailboxes only. */
      unknownSender: boolean;
    };

/**
 * The D24 filter as implemented (first match wins):
 *
 *   already stored (I1)                         → skip duplicate
 *   no INBOX / SENT label                       → skip not_inbox
 *   a skipped Gmail category / Spam / Trash      → skip label
 *   outbound (SENT label only, M3):
 *              our own app send / known copy     → skip app_sent
 *              drop signals (auto-reply, bulk)  → skip bulk
 *              on a tracked thread              → STORE outbound (D33)
 *              otherwise                        → skip untracked_outbound
 *   inbound:   a colleague, authenticated       → skip internal
 *              sender domain ignored             → skip ignored_domain
 *              bulk (drop, or list headers from
 *              an unknown sender off-thread)    → skip bulk
 *              known, authenticated client      → STORE inbound
 *              tracked thread: admin's mailbox,
 *              or the sender is a participant   → STORE inbound (M2)
 *              admin's mailbox                  → STORE inbound, unknown sender (screened)
 *              member's mailbox                 → skip unknown_sender_member (I13)
 *
 * An unauthenticated client address or a forged colleague is never "known":
 * it lands in the unknown-sender rows (screened in an admin's mailbox, never
 * stored in a member's) and the message is flagged `unverifiedSender`.
 */
export function decideIngest(f: IngestFacts): IngestDecision {
  if (f.alreadyStored) return { store: false, reason: "duplicate" };
  if (!f.labelIds.some((l) => SYNCED_LABELS.has(l))) return { store: false, reason: "not_inbox" };
  if (f.labelIds.some((l) => SKIPPED_GMAIL_LABELS.has(l))) return { store: false, reason: "label" };
  if (f.outbound) {
    if (f.appSent) return { store: false, reason: "app_sent" };
    if (f.signals.drop) return { store: false, reason: "bulk" };
    if (f.trackedThread) return { store: true, direction: "outbound", unknownSender: false };
    return { store: false, reason: "untracked_outbound" };
  }
  if (f.teamSender && f.senderVerified) return { store: false, reason: "internal" };
  if (f.ignoredDomain) return { store: false, reason: "ignored_domain" };
  const known = f.knownClientSender && f.senderVerified && !f.teamSender;
  const participant = f.senderIsParticipant && f.senderVerified && !f.teamSender;
  const tracked = f.trackedThread && (f.mailboxOwnerIsAdmin || known || participant);
  if (skipBeforeTriage(f.signals, { knownClientSender: known, trackedThread: tracked })) {
    return { store: false, reason: "bulk" };
  }
  if (known || tracked) return { store: true, direction: "inbound", unknownSender: !known && !participant };
  if (f.mailboxOwnerIsAdmin) return { store: true, direction: "inbound", unknownSender: true };
  return { store: false, reason: "unknown_sender_member" };
}

// ─── Sender authentication (M1) ──────────────────────────────────────────────

/** Relaxed alignment: the same domain, or one is a subdomain of the other. */
function aligned(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/^@/, "");
  const y = b.trim().toLowerCase().replace(/^@/, "");
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
}

const domainOf = (value: string) => {
  const v = value.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  return at >= 0 ? v.slice(at + 1) : v;
};

/**
 * Gmail's own verdict on the sender (M1): the FIRST `Authentication-Results`
 * header from `mx.google.com` (the one Gmail added — anything below it came
 * with the message and is not trusted). Verified = DMARC pass for the From
 * domain, or SPF / DKIM pass aligned with the From domain. No such header →
 * not verified. Pure.
 */
export function senderAuthentication(
  headers: ReadonlyArray<{ name: string; value: string }>,
  fromEmail: string,
): { verified: boolean; dmarc: string | null } {
  const fromDomain = domainOf(fromEmail);
  const header = headers.find((h) => h.name.toLowerCase() === "authentication-results");
  if (!header || !fromDomain || !/^\s*mx\.google\.com\s*;/i.test(header.value)) return { verified: false, dmarc: null };
  let verified = false;
  let dmarc: string | null = null;
  for (const segment of header.value.slice(0, 4_000).split(";").slice(1)) {
    const m = /^\s*(dkim|spf|dmarc)\s*=\s*([a-z]+)/i.exec(segment);
    if (!m) continue;
    const method = m[1].toLowerCase();
    const result = m[2].toLowerCase();
    const prop = (re: RegExp) => re.exec(segment)?.[1] ?? null;
    if (method === "dmarc") {
      dmarc = result;
      const from = prop(/header\.from=([^\s;]+)/i);
      if (result === "pass" && (!from || aligned(from, fromDomain))) verified = true;
    } else if (method === "dkim" && result === "pass") {
      const d = prop(/header\.(?:i|d)=([^\s;]+)/i);
      if (d && aligned(domainOf(d), fromDomain)) verified = true;
    } else if (method === "spf" && result === "pass") {
      const mailFrom = prop(/smtp\.mailfrom=([^\s;]+)/i);
      if (mailFrom && aligned(domainOf(mailFrom), fromDomain)) verified = true;
    }
  }
  if (dmarc === "fail") verified = false; // an explicit DMARC fail wins
  return { verified, dmarc };
}

// ─── Byte budget (H2) ────────────────────────────────────────────────────────

/** One stored message stays well under Convex's 1 MiB document limit. */
export const MESSAGE_BYTE_BUDGET = 700_000;
const SUBJECT_BYTES = 2_000;
const NAME_BYTES = 300;
const EMAIL_BYTES = 320;
const ATTACHMENT_NAME_BYTES = 300;
const BODY_TEXT_BYTES = 200_000;
/** Ids, stage fields, classification later on. */
const FIXED_OVERHEAD_BYTES = 30_000;

export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The longest prefix of `text` within `maxBytes` of UTF-8 (never splits a character). */
export function capUtf8(text: string, maxBytes: number): string {
  if (text.length * 3 <= maxBytes) return text;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const size = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : 3;
    if (n + size > maxBytes) return text.slice(0, i);
    n += size;
    if (size === 4) i++;
  }
  return text;
}

type Address = { name?: string; email: string };

function capAddress(a: Address): Address | null {
  if (utf8Length(a.email) > EMAIL_BYTES) return null;
  const name = a.name ? capUtf8(a.name, NAME_BYTES) : "";
  return name ? { name, email: a.email } : { email: a.email };
}

/**
 * H2: cap every stored field by UTF-8 bytes so one message fits the budget:
 * subject, addresses (100 each — the rest counted), attachment names, then
 * the body text and the full HTML / text from what is left. Pure.
 */
export function fitMessageBudget<A extends { name: string }>(m: {
  subject: string;
  from: Address;
  to: readonly Address[];
  cc: readonly Address[];
  bodyText: string;
  bodyHtml: string;
  attachments: readonly A[];
  maxAddresses?: number;
}): {
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  toOverflow: number;
  ccOverflow: number;
  bodyText: string;
  bodyHtml: string;
  attachments: A[];
} {
  const max = m.maxAddresses ?? 100;
  const subject = capUtf8(m.subject, SUBJECT_BYTES);
  const from = capAddress(m.from) ?? { email: "invalid@invalid" };
  const list = (all: readonly Address[]) => all.slice(0, max).map(capAddress).filter((a): a is Address => a !== null);
  const to = list(m.to);
  const cc = list(m.cc);
  const attachments = m.attachments.map((a) => ({ ...a, name: capUtf8(a.name, ATTACHMENT_NAME_BYTES) }));
  const fixed =
    FIXED_OVERHEAD_BYTES +
    utf8Length(subject) +
    [from, ...to, ...cc].reduce((n, a) => n + utf8Length(a.email) + utf8Length(a.name ?? "") + 40, 0) +
    attachments.reduce((n, a) => n + utf8Length(a.name) + 200, 0);
  const room = Math.max(0, MESSAGE_BYTE_BUDGET - fixed);
  const bodyText = capUtf8(m.bodyText, Math.min(BODY_TEXT_BYTES, Math.floor(room / 2)));
  const bodyHtml = capUtf8(m.bodyHtml, Math.max(0, room - utf8Length(bodyText)));
  return {
    subject,
    from,
    to,
    cc,
    toOverflow: Math.max(0, m.to.length - max),
    ccOverflow: Math.max(0, m.cc.length - max),
    bodyText,
    bodyHtml,
    attachments,
  };
}

// ─── Attachments (L6) ────────────────────────────────────────────────────────

/** Types a browser would run or render as a page — stored as a plain download instead. */
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript|application\/ecmascript|text\/ecmascript|application\/x-shockwave-flash|text\/x-sgml|multipart\/.*|message\/.*)$/i;

/** The content type a stored attachment blob gets: active types become `application/octet-stream` (the original stays on the message row). */
export function safeStorageType(mime: string): string {
  const m = mime.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(m) || ACTIVE_TYPES.test(m)) return "application/octet-stream";
  return m;
}

/** A domain is ignored when it equals an ignored domain or is a subdomain of one. */
export function isIgnoredDomain(domain: string, ignored: readonly string[]): boolean {
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  return ignored.some((raw) => {
    const i = raw.trim().toLowerCase().replace(/^@/, "");
    return i.length > 0 && (d === i || d.endsWith(`.${i}`));
  });
}

/**
 * D33 applies only to a reply TO the client: at least one recipient outside
 * the team (an internal forward of the thread to a colleague is history, not
 * an answer).
 */
export function isReplyToOutsider(
  recipients: ReadonlyArray<{ email: string }>,
  isTeam: (email: string) => boolean,
): boolean {
  return recipients.some((r) => !isTeam(r.email.toLowerCase()));
}

// ─── Dates and cursors ───────────────────────────────────────────────────────

/** The stored `sentAt`: the Date header unless missing or implausible, else Gmail's internalDate. */
export function chooseSentAt(dateHeader: number | null, internalDate: number | null, now: number): number {
  if (dateHeader !== null && dateHeader > 0 && dateHeader <= now + DATE_SKEW_MS) return dateHeader;
  return internalDate ?? dateHeader ?? now;
}

/** Gmail history ids are decimal strings; compare without losing precision. */
export function compareHistoryIds(a: string, b: string): number {
  const x = a.replace(/^0+/, "");
  const y = b.replace(/^0+/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The later of two cursors (a cursor never moves backwards); ignores empty / non-numeric ids. */
export function laterCursor(current: string | undefined, next: string | undefined): string | undefined {
  const valid = (s: string | undefined): s is string => typeof s === "string" && /^\d+$/.test(s);
  if (!valid(next)) return valid(current) ? current : undefined;
  if (!valid(current)) return next;
  return compareHistoryIds(next, current) > 0 ? next : current;
}

// ─── Failures ────────────────────────────────────────────────────────────────

export type SyncErrorKind = "disconnected" | "permission" | "quota" | "transient" | "unknown";

/** Backoff before the next automatic run, by consecutive failures. Disconnected / permission wait for a reconnect. */
export function syncBackoffMs(kind: SyncErrorKind, failures: number): number | null {
  if (kind === "disconnected" || kind === "permission") return null;
  const step = Math.max(0, Math.min(failures - 1, 5));
  const base = kind === "quota" ? 2 * 60_000 : 60_000;
  return Math.min(base * 2 ** step, 30 * 60_000);
}

/** What the connector row and the Triage item say to do about it (§7.6). */
export function syncErrorFix(kind: SyncErrorKind): string {
  switch (kind) {
    case "disconnected":
      return "Reconnect Gmail to resume syncing.";
    case "permission":
      return "Reconnect Gmail and allow read access.";
    case "quota":
      return "Gmail is rate-limiting this mailbox — syncing resumes by itself.";
    case "transient":
      return "Gmail didn't answer — retrying by itself.";
    case "unknown":
      return "Retrying by itself. If it keeps failing, use Resync last 7 days.";
  }
}
