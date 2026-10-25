/**
 * The one MCP reference parser (docs/prd-mcp.md §7): turns any reference the
 * model passes (in `fetch` refs or `search` filters) into a typed reference.
 * Pure: it only classifies the string. Convex resolves and ownership-checks
 * every parsed ref against the caller's org (I3), so a wrong-org or
 * unreadable record is "not found", never "forbidden".
 *
 * Imported by Convex too (convex/lib/mcpRefs.ts), so it uses relative
 * imports only.
 *
 * Accepted forms:
 * - special refs `me`, `workspace` and `changes` (lowercase only);
 * - an app URL (a pasted link) — tasks, comments, projects, clients, members;
 * - a task identifier `KEY-N`, case-insensitive (old identifiers resolve
 *   through `taskIdentifierAliases` in Convex);
 * - a bare short key: the project code (`ARLO`), case-insensitive — task
 *   identifiers are built on it (owner, 2026-10-24);
 * - a client prefix written `client:KONV`, case-insensitive (`project:ARLO`
 *   qualifies a project code the same way);
 * - an external source ref `<source>:<id>` (docs/prd-mcp.md D21), e.g.
 *   `gmail:18c2f0a1b2c3d4e5`: the task that carries it. `client` and
 *   `project` are qualifiers, never sources;
 * - a member email;
 * - an invoice number as the app writes it (`INV-007`; admins only, checked
 *   in Convex). A number shaped like a task key (`INV-120`) parses as a task
 *   key; Convex then also tries it as an invoice number and returns both as
 *   candidates when both exist;
 * - a Convex record ID.
 */

import { normalizeIdentifier } from "../../convex/tasks/model";
import { CLIENT_PREFIX_PATTERN } from "../../convex/lib/clientPrefix";

export const SPECIAL_REFS = ["me", "workspace", "changes"] as const;
export type SpecialRefName = (typeof SPECIAL_REFS)[number];

/** Tables an ID or link can point at in this slice. */
export const REF_TABLES = ["tasks", "comments", "projects", "clients", "users", "timeEntries", "invoices"] as const;
export type RefTable = (typeof REF_TABLES)[number];

export type ParsedRef =
  | { kind: "special"; name: SpecialRefName }
  /** `ARLO-21`, normalized to uppercase. */
  | { kind: "task"; identifier: string }
  /** A bare short key: a project code, as typed (matched case-insensitively). */
  | { kind: "key"; key: string }
  /** `client:KONV`: a client prefix, as typed (matched case-insensitively). */
  | { kind: "client_key"; key: string }
  /** A member email, lowercased. */
  | { kind: "email"; email: string }
  /** An external source ref (D21), canonical: source lowercased, ID as typed. */
  | { kind: "external"; ref: string }
  /** An invoice number (`INV-007`), as typed; Convex matches it like the invoice page URL. */
  | { kind: "invoice"; number: string }
  /** A record ID; `table` is known when it came from a link. */
  | { kind: "id"; id: string; table?: RefTable };

export type RefParseResult =
  | { ok: true; input: string; ref: ParsedRef }
  | { ok: false; input: string; error: string };

/** The forms a reference may take, for model-facing errors and descriptions. */
export const REF_FORMS =
  'a task key (ARLO-21) or a task\'s external ref (gmail:<threadId>), project code (ARLO), client prefix (client:KONV), member email, invoice number (INV-007, admins), record ID, an Agency Flow link, or "me" / "workspace"';

/** `<source>:<id>`: a source of letters, digits, `-` / `_` (starting with a letter) and an ID without spaces. */
const EXTERNAL_REF = /^([A-Za-z][A-Za-z0-9_-]{0,31}):(\S{1,256})$/;
/** Ref qualifiers, so never external-ref sources. */
export const RESERVED_EXTERNAL_SOURCES = ["client", "project"] as const;

export const EXTERNAL_REF_FORMAT =
  "<source>:<id>, e.g. gmail:18c2f0a1b2c3d4e5 (source: letters, digits, - or _; id: up to 256 characters, no spaces; client and project are reserved)";

/**
 * The canonical form of an external source ref (D21): the source
 * lowercased, the ID kept exactly (source IDs are case-sensitive).
 */
export function normalizeExternalRef(raw: string): { ok: true; ref: string } | { ok: false; error: string } {
  const match = EXTERNAL_REF.exec(raw.trim());
  const source = match?.[1].toLowerCase();
  if (!match || !source || (RESERVED_EXTERNAL_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, error: `Invalid external ref "${raw.trim().slice(0, 80)}". Write ${EXTERNAL_REF_FORMAT}.` };
  }
  return { ok: true, ref: `${source}:${match[2]}` };
}

/** Short keys: 1–10 letters or digits, the client prefix format (project codes are a subset). */
const KEY_PATTERN = CLIENT_PREFIX_PATTERN;
const CLIENT_QUALIFIER = /^client:(.*)$/i;
const PROJECT_QUALIFIER = /^project:(.*)$/i;
/** Convex IDs are long alphanumeric strings; never confused with a short key. */
const ID_PATTERN = /^[A-Za-z0-9]{20,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * An invoice number: a prefix starting with a letter, ending in digits
 * (`INV-007`, `ACME-2026-12`). Only reached when the input is no task key,
 * short key or record ID (lib/billing/labels.ts formatInvoiceNumber).
 */
const INVOICE_NUMBER_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,30}[0-9]$/;

// Search params of task links (lib/task-detail.ts: TASK_PARAM, LEGACY_DETAIL_PARAM,
// COMMENT_PARAM) and the admin's member view (`/my-tasks?user=`).
const TASK_PARAM = "task";
const DETAIL_PARAM = "detail";
const COMMENT_PARAM = "comment";
const USER_PARAM = "user";

function isSpecialRef(value: string): value is SpecialRefName {
  return (SPECIAL_REFS as readonly string[]).includes(value);
}

function isRecordId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** A task by identifier or (old links) by ID. */
function taskRef(value: string): ParsedRef | null {
  const identifier = normalizeIdentifier(value);
  if (identifier) return { kind: "task", identifier };
  return isRecordId(value) ? { kind: "id", id: value, table: "tasks" } : null;
}

/** Classifies a pasted app link by its route (see lib/mcp/links.ts for the routes). */
function parseUrl(input: string, appOrigin: string | undefined): ParsedRef | string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return `"${input}" is not a valid link.`;
  }
  if (appOrigin !== undefined && url.origin !== appOrigin) {
    return `"${input}" is not an Agency Flow link. Links must start with ${appOrigin}.`;
  }

  const params = url.searchParams;
  const comment = params.get(COMMENT_PARAM)?.trim();
  if (comment) {
    return isRecordId(comment) ? { kind: "id", id: comment, table: "comments" } : `Invalid comment link "${input}".`;
  }
  // The task drawer opens on any route: `?task=ARLO-21` (or legacy `?detail=<id>`).
  const drawerTask = params.get(TASK_PARAM)?.trim();
  if (drawerTask) return taskRef(drawerTask) ?? `Invalid task link "${input}".`;
  const detail = params.get(DETAIL_PARAM)?.trim();
  if (detail) return taskRef(detail) ?? `Invalid task link "${input}".`;

  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    // A malformed escape (e.g. `%E0%A4%A`) must fail this ref, not the call.
    return `Invalid link "${input}".`;
  }
  const [section, id] = segments;
  switch (section) {
    case "tasks":
      if (id) return taskRef(id) ?? `Invalid task link "${input}".`;
      break;
    case "projects":
      if (id && isRecordId(id)) return { kind: "id", id, table: "projects" };
      break;
    case "clients":
      if (id && isRecordId(id)) return { kind: "id", id, table: "clients" };
      break;
    case "invoices":
      // The invoice page: /invoices/INV-007 (or a pre-2026-05 /invoices/<id>).
      if (id && isRecordId(id)) return { kind: "id", id, table: "invoices" };
      if (id && INVOICE_NUMBER_PATTERN.test(id)) return { kind: "invoice", number: id };
      break;
    case "my-tasks": {
      const user = params.get(USER_PARAM)?.trim();
      if (user && isRecordId(user)) return { kind: "id", id: user, table: "users" };
      break;
    }
  }
  return `Unsupported Agency Flow link "${input}". Links to tasks, comments, projects, clients, invoices and members (/my-tasks?user=…) are supported.`;
}

/**
 * Classifies one reference. `appOrigin` (the route passes the app's origin)
 * rejects links to other hosts; Convex parses without it, after the route.
 * Special refs match lowercase only, so uppercase project codes and client
 * prefixes (`ME`, `WORK`) stay free for their own kind.
 */
export function parseRef(raw: string, options: { appOrigin?: string } = {}): RefParseResult {
  const input = raw.trim();
  if (input.length === 0) {
    return { ok: false, input, error: "Empty reference." };
  }
  if (isSpecialRef(input)) {
    return { ok: true, input, ref: { kind: "special", name: input } };
  }
  if (/^https?:\/\//i.test(input)) {
    const parsed = parseUrl(input, options.appOrigin);
    return typeof parsed === "string" ? { ok: false, input, error: parsed } : { ok: true, input, ref: parsed };
  }
  const qualified = CLIENT_QUALIFIER.exec(input);
  if (qualified) {
    const key = qualified[1].trim();
    return KEY_PATTERN.test(key)
      ? { ok: true, input, ref: { kind: "client_key", key } }
      : {
          ok: false,
          input,
          error: `Invalid client reference "${input}". Client prefixes are 1–10 letters or digits (client:KONV); clients without one are referenced by ID or link.`,
        };
  }
  const project = PROJECT_QUALIFIER.exec(input);
  if (project) {
    const key = project[1].trim();
    return KEY_PATTERN.test(key)
      ? { ok: true, input, ref: { kind: "key", key } }
      : { ok: false, input, error: `Invalid project reference "${input}". Project codes are 1–10 letters or digits (project:ARLO).` };
  }
  if (input.includes(":")) {
    // Any other `x:y` is an external source ref (D21) — or a mistyped one.
    const external = normalizeExternalRef(input);
    return external.ok
      ? { ok: true, input, ref: { kind: "external", ref: external.ref } }
      : { ok: false, input, error: `${external.error} External refs name the task that carries them (see save_tasks externalRefs).` };
  }
  if (EMAIL_PATTERN.test(input)) {
    return { ok: true, input, ref: { kind: "email", email: input.toLowerCase() } };
  }
  const identifier = normalizeIdentifier(input);
  if (identifier) {
    return { ok: true, input, ref: { kind: "task", identifier } };
  }
  if (KEY_PATTERN.test(input)) {
    return { ok: true, input, ref: { kind: "key", key: input } };
  }
  if (isRecordId(input)) {
    return { ok: true, input, ref: { kind: "id", id: input } };
  }
  if (INVOICE_NUMBER_PATTERN.test(input)) {
    return { ok: true, input, ref: { kind: "invoice", number: input } };
  }
  return { ok: false, input, error: `Unrecognized reference "${input}". Use ${REF_FORMS}.` };
}

/** Parses each ref once, dropping exact duplicates while keeping input order. */
export function parseRefs(raw: readonly string[], options: { appOrigin?: string } = {}): RefParseResult[] {
  const seen = new Set<string>();
  const results: RefParseResult[] = [];
  for (const value of raw) {
    const result = parseRef(value, options);
    if (seen.has(result.input)) continue;
    seen.add(result.input);
    results.push(result);
  }
  return results;
}
