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
 * - special refs `me` and `workspace` (lowercase only);
 * - an app URL (a pasted link) — tasks, comments, projects, clients, members;
 * - a task identifier `KEY-N`, case-insensitive (old identifiers resolve
 *   through `taskIdentifierAliases` in Convex);
 * - a short key: a project code (`ARLO`) or a client prefix (`KONV`),
 *   case-insensitive; Convex decides which (both → ambiguous, candidates);
 * - a member email;
 * - a Convex record ID.
 */

import { normalizeIdentifier } from "../../convex/tasks/model";

export const SPECIAL_REFS = ["me", "workspace"] as const;
export type SpecialRefName = (typeof SPECIAL_REFS)[number];

/** Tables an ID or link can point at in this slice. */
export const REF_TABLES = ["tasks", "comments", "projects", "clients", "users", "timeEntries"] as const;
export type RefTable = (typeof REF_TABLES)[number];

export type ParsedRef =
  | { kind: "special"; name: SpecialRefName }
  /** `ARLO-21`, normalized to uppercase. */
  | { kind: "task"; identifier: string }
  /** A project code or client prefix, as typed (matched case-insensitively). */
  | { kind: "key"; key: string }
  /** A member email, lowercased. */
  | { kind: "email"; email: string }
  /** A record ID; `table` is known when it came from a link. */
  | { kind: "id"; id: string; table?: RefTable };

export type RefParseResult =
  | { ok: true; input: string; ref: ParsedRef }
  | { ok: false; input: string; error: string };

/** Maximum refs per `fetch` call (§6). */
export const MAX_REFS = 25;

/** The forms a reference may take, for model-facing errors and descriptions. */
export const REF_FORMS =
  'a task key (ARLO-21), project code (ARLO), client prefix (KONV), member email, record ID, an Agency Flow link, or "me" / "workspace"';

/** Short keys: project codes are 1–10 letters/digits; client prefixes are at most 10 characters. */
const KEY_PATTERN = /^[A-Za-z0-9]{1,10}$/;
/** Convex IDs are long alphanumeric strings; never confused with a short key. */
const ID_PATTERN = /^[A-Za-z0-9]{20,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
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
    case "my-tasks": {
      const user = params.get(USER_PARAM)?.trim();
      if (user && isRecordId(user)) return { kind: "id", id: user, table: "users" };
      break;
    }
  }
  return `Unsupported Agency Flow link "${input}". Links to tasks, comments, projects, clients and members (/my-tasks?user=…) are supported.`;
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
