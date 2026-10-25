import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { clientPrefixKey, referenceClientPrefix } from "./helpers";
import { loadTaskForReadOrNull, type TaskAccess } from "../tasks/access";
import { resolveTaskRef } from "../tasks/lookup";
import { visibleTimeEntries } from "../timeEntries";
import { REF_CAP } from "../workspaceRefs";
import { externalRefOwner } from "./mcpExternalRefs";
import { resolveInvoiceByIdentifier } from "./invoiceIdentifier";
import { formatInvoiceNumber } from "./billing/labels";
import { parseRef, REF_TABLES, type RefTable } from "../../lib/mcp/refs";

/**
 * Resolves MCP references (docs/prd-mcp.md §7) inside the caller's org with
 * the app's own access rules (I3). The pure parser (lib/mcp/refs.ts)
 * classifies the string; this module finds the record and checks it:
 *
 * - tasks: identifier (live or alias), ID or an external source ref
 *   (`gmail:<id>`, via taskExternalRefs in the org — D21), readable per
 *   tasks/access.ts;
 * - comments: ID, on a task the caller can read;
 * - time entries: ID, visible per `visibleTimeEntries` (members: own only);
 * - projects: ID or project code (a bare short key, case-insensitive);
 * - clients: ID or `client:PREFIX` (case-insensitive; valid prefixes only);
 * - members: ID, email (case-insensitive), with a membership in the org;
 * - planner bars: ID (the Planner is a shared board: every member reads every bar);
 * - daily notes: ID, the caller's own — admins any member's (as the app's
 *   Daily Notes panel and `/my-tasks?user=`);
 * - invoices (admins only, as in the app): ID, invoice page link or invoice
 *   number (`INV-007`, matched like the page URL). A number shaped like a
 *   task key is tried as both; when both exist the candidates come back.
 *   Members get "admin-only" for any invoice-shaped reference, never a
 *   lookup.
 *
 * Missing, other-org and unreadable records are all "not found" — never
 * "forbidden" — so references cannot probe other tenants. A key or email
 * that matches more than one record (duplicates that predate uniqueness)
 * is ambiguous and returns the candidates; the resolver never guesses.
 *
 * Read budget (Convex: 4,096 index ranges per call): a task ref costs about
 * 5 ranges (an external ref one more: its `by_orgId_ref` row); a client prefix one bounded range; an email one range plus one
 * per org member (bounded by REF_CAP), read once per call.
 */

export type RefType = "task" | "comment" | "time_entry" | "project" | "client" | "member" | "invoice" | "daily_note" | "plan_segment";

export type Resolved =
  | { type: "task"; access: TaskAccess }
  | { type: "comment"; comment: Doc<"comments">; access: TaskAccess }
  | { type: "time_entry"; entry: Doc<"timeEntries"> }
  | { type: "project"; project: Doc<"projects"> }
  | { type: "client"; client: Doc<"clients"> }
  | { type: "member"; user: Doc<"users">; role: "admin" | "member" }
  | { type: "invoice"; invoice: Doc<"invoices"> }
  | { type: "daily_note"; note: Doc<"dailyNotes"> }
  | { type: "plan_segment"; segment: Doc<"planSegments"> };

/** One record an ambiguous reference could mean; `id` references it uniquely. */
export type RefCandidate = { type: RefType; id: string; key: string | null; name: string };

export type Resolution =
  | { ok: true; resolved: Resolved }
  | { ok: false; message: string; candidates?: RefCandidate[] };

const TABLE_TYPE: Record<RefTable, RefType> = {
  tasks: "task",
  comments: "comment",
  timeEntries: "time_entry",
  projects: "project",
  clients: "client",
  users: "member",
  invoices: "invoice",
  dailyNotes: "daily_note",
  planSegments: "plan_segment",
};

const TYPE_NOUN: Record<RefType, string> = {
  task: "task",
  comment: "comment",
  time_entry: "time entry",
  project: "project",
  client: "client",
  member: "member",
  invoice: "invoice",
  daily_note: "daily note",
  plan_segment: "planner bar",
};

const NOT_FOUND_HINT: Record<RefType, string> = {
  task: "Use search to find tasks.",
  comment: "Use search to find comments.",
  time_entry: "Use search to find time entries.",
  project: 'Project codes are listed in fetch("workspace").',
  client: 'Client prefixes (client:KEY) are listed in fetch("workspace").',
  member: 'Members are listed in fetch("workspace").',
  invoice: 'Use search with types ["invoice"] to find invoices.',
  daily_note: 'Use search with types ["daily_note"] to find daily notes.',
  plan_segment: 'Bar refs are listed by fetch on the task with include ["plan"].',
};

/** Members never see invoices (the app's /invoices and /billing are admin routes). */
export const INVOICES_ADMIN_ONLY = "Invoices are admin-only, as in the app.";

/** An invoice's display key: its number once finalized, null for a never-numbered draft. */
export function invoiceKey(invoice: Doc<"invoices">): string | null {
  return invoice.number != null ? formatInvoiceNumber(invoice.prefix, invoice.number) : null;
}

/**
 * Whole days an invoice is past its due date (YYYY-MM-DD, org timezone),
 * at least 1 — the hub's "N days overdue".
 */
export function daysPastDue(dueDate: string, todayOrgTz: string): number {
  return Math.max(1, Math.round((Date.parse(`${todayOrgTz}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000));
}

/** A resolved record as a candidate of an ambiguous reference. */
function candidateOf(resolved: Resolved): RefCandidate {
  switch (resolved.type) {
    case "task":
      return { type: "task", id: resolved.access.task._id, key: resolved.access.task.identifier ?? null, name: resolved.access.task.title };
    case "comment":
      return { type: "comment", id: resolved.comment._id, key: null, name: `comment on ${resolved.access.task.identifier ?? resolved.access.task._id}` };
    case "time_entry":
      return { type: "time_entry", id: resolved.entry._id, key: null, name: resolved.entry.date };
    case "project":
      return { type: "project", id: resolved.project._id, key: resolved.project.code, name: resolved.project.name };
    case "client":
      return { type: "client", id: resolved.client._id, key: referenceClientPrefix(resolved.client), name: resolved.client.name };
    case "member":
      return { type: "member", id: resolved.user._id, key: null, name: resolved.user.name };
    case "invoice":
      return { type: "invoice", id: resolved.invoice._id, key: invoiceKey(resolved.invoice), name: resolved.invoice.subject ?? "Invoice" };
    case "daily_note":
      return { type: "daily_note", id: resolved.note._id, key: null, name: resolved.note.date };
    case "plan_segment":
      return { type: "plan_segment", id: resolved.segment._id, key: null, name: `${resolved.segment.startDate} – ${resolved.segment.endDate}` };
  }
}

/** A message naming every candidate by its unique ID, so the model can retry exactly. */
export function ambiguousMessage(input: string, candidates: readonly RefCandidate[]): string {
  const list = candidates
    .map((c) => `${TYPE_NOUN[c.type]} ${c.key ? `${c.type === "client" ? `client:${c.key}` : c.key} · ` : ""}${c.name} (ref ${c.id})`)
    .join("; ");
  return `"${input}" is ambiguous: it matches ${list}. Use one of these refs.`;
}

/**
 * A resolver for one Convex call: org-wide lookups (clients by prefix,
 * members by email) read each table once, bounded by `REF_CAP`, and refuse
 * to answer from a clipped read instead of missing a match.
 */
export function createRefResolver(ctx: QueryCtx, auth: AuthContext) {
  const { orgId } = auth;
  let clients: Promise<Doc<"clients">[]> | null = null;
  let members: Promise<Array<{ user: Doc<"users">; role: "admin" | "member" }>> | null = null;

  const orgClients = () =>
    (clients ??= ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(REF_CAP + 1)
      .then((rows) => {
        if (rows.length > REF_CAP) {
          throw new ConvexError(
            `This workspace has more than ${REF_CAP} clients, so clients cannot be looked up by prefix. Use the client's ID or link.`,
          );
        }
        return rows;
      }));

  const orgMembers = () =>
    (members ??= ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(REF_CAP + 1)
      .then(async (rows) => {
        if (rows.length > REF_CAP) {
          throw new ConvexError(
            `This workspace has more than ${REF_CAP} members, so members cannot be looked up by email. Use the member's ID or link.`,
          );
        }
        const resolved = await Promise.all(
          rows.map(async (m) => {
            const user = m.userId ? await ctx.db.get(m.userId) : null;
            return user && !user.deletedAt ? { user, role: m.role } : null;
          }),
        );
        return resolved.filter((m) => m !== null);
      }));

  async function readableTask(taskId: Id<"tasks">): Promise<TaskAccess | null> {
    return await loadTaskForReadOrNull(ctx, taskId, auth);
  }

  async function memberById(userId: Id<"users">): Promise<Resolved | null> {
    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    const membership = memberships.find((m) => m.orgId === orgId);
    const user = membership ? await ctx.db.get(userId) : null;
    return membership && user && !user.deletedAt ? { type: "member", user, role: membership.role } : null;
  }

  /** The record behind an ID in `table`, or null when missing, foreign or unreadable. */
  async function byId(table: RefTable, raw: string): Promise<Resolved | null> {
    switch (table) {
      case "tasks": {
        const id = ctx.db.normalizeId("tasks", raw);
        const access = id ? await readableTask(id) : null;
        return access ? { type: "task", access } : null;
      }
      case "comments": {
        const id = ctx.db.normalizeId("comments", raw);
        const comment = id ? await ctx.db.get(id) : null;
        if (!comment || comment.orgId !== orgId) return null;
        const access = await readableTask(comment.taskId);
        return access ? { type: "comment", comment, access } : null;
      }
      case "timeEntries": {
        const id = ctx.db.normalizeId("timeEntries", raw);
        const entry = id ? await ctx.db.get(id) : null;
        if (!entry || entry.orgId !== orgId || visibleTimeEntries(auth, [entry]).length === 0) return null;
        return { type: "time_entry", entry };
      }
      case "projects": {
        const id = ctx.db.normalizeId("projects", raw);
        const project = id ? await ctx.db.get(id) : null;
        return project && project.orgId === orgId ? { type: "project", project } : null;
      }
      case "clients": {
        const id = ctx.db.normalizeId("clients", raw);
        const client = id ? await ctx.db.get(id) : null;
        return client && client.orgId === orgId ? { type: "client", client } : null;
      }
      case "users": {
        const id = ctx.db.normalizeId("users", raw);
        return id ? await memberById(id) : null;
      }
      case "invoices": {
        const id = ctx.db.normalizeId("invoices", raw);
        const invoice = id && auth.isAdmin ? await ctx.db.get(id) : null;
        return invoice && invoice.orgId === orgId ? { type: "invoice", invoice } : null;
      }
      case "dailyNotes": {
        // As dailyNotes.get: members their own notes, admins anyone's in the org.
        const id = ctx.db.normalizeId("dailyNotes", raw);
        const note = id ? await ctx.db.get(id) : null;
        return note && note.orgId === orgId && (auth.isAdmin || note.userId === auth.userId)
          ? { type: "daily_note", note }
          : null;
      }
      case "planSegments": {
        // As planner.taskSegments / weekGrid: every member of the org reads every bar.
        const id = ctx.db.normalizeId("planSegments", raw);
        const segment = id ? await ctx.db.get(id) : null;
        return segment && segment.orgId === orgId ? { type: "plan_segment", segment } : null;
      }
    }
  }

  /**
   * An invoice by number, as the invoice page resolves its URL segment. The
   * number is tried as typed, then uppercased (prefixes are stored as set).
   */
  async function invoiceByNumber(number: string): Promise<Doc<"invoices"> | null> {
    const exact = await resolveInvoiceByIdentifier(ctx, orgId, number);
    if (exact || number === number.toUpperCase()) return exact;
    return await resolveInvoiceByIdentifier(ctx, orgId, number.toUpperCase());
  }

  /** Whether `raw` is an ID of `table` at all (regardless of org or access). */
  function isIdOf(table: RefTable, raw: string): boolean {
    return ctx.db.normalizeId(table, raw) !== null;
  }

  /** A project by code or (fallback / `client:`) a client by prefix — never guessing between duplicates. */
  async function projectOrClient(rawKey: string, asClient: boolean, input: string, clientFallback: boolean): Promise<Resolution> {
    if (!asClient) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_orgId_code", (q) => q.eq("orgId", orgId).eq("code", rawKey.toUpperCase()))
        .take(10);
      if (projects.length === 1) return { ok: true, resolved: { type: "project", project: projects[0] } };
      if (projects.length > 1) {
        const candidates = projects.map((p) => ({ type: "project" as const, id: p._id, key: p.code, name: p.name }));
        return { ok: false, message: ambiguousMessage(input, candidates), candidates };
      }
      if (!clientFallback) return { ok: false, message: `${input} not found. ${NOT_FOUND_HINT.project}` };
    }
    const key = clientPrefixKey(rawKey);
    const clients = (await orgClients()).filter((c) => {
      const prefix = referenceClientPrefix(c);
      return prefix !== null && clientPrefixKey(prefix) === key;
    });
    if (clients.length === 0) {
      return {
        ok: false,
        message: `${input} not found. ${
          asClient ? NOT_FOUND_HINT.client : 'Project codes and client prefixes (client:KEY) are listed in fetch("workspace").'
        }`,
      };
    }
    if (clients.length > 1) {
      // Duplicates that predate prefix uniqueness: never guess.
      const candidates = clients.map((c) => ({
        type: "client" as const,
        id: c._id,
        key: referenceClientPrefix(c),
        name: c.name,
      }));
      return { ok: false, message: ambiguousMessage(input, candidates), candidates };
    }
    return { ok: true, resolved: { type: "client", client: clients[0] } };
  }

  /**
   * Resolves one reference. `expected` narrows the record type (search
   * filters); a reference of another type is refused by name. `me`
   * resolves to the caller when a member is expected.
   */
  async function resolve(input: string, expected?: RefType): Promise<Resolution> {
    const parsed = parseRef(input);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    const ref = parsed.ref;
    const allows = (type: RefType) => expected === undefined || expected === type;
    const notFound = (type: RefType | undefined): Resolution => ({
      ok: false,
      message: `${parsed.input} not found. ${type ? NOT_FOUND_HINT[type] : "Use search to find records."}`,
    });
    const wrongType = (actual: string): Resolution => ({
      ok: false,
      message: `"${parsed.input}" is ${actual}, not a ${TYPE_NOUN[expected!]}. ${NOT_FOUND_HINT[expected!]}`,
    });

    switch (ref.kind) {
      case "special":
        if (ref.name === "me" && allows("member")) {
          return { ok: true, resolved: { type: "member", user: auth.user, role: auth.orgRole } };
        }
        return { ok: false, message: `"${parsed.input}" cannot be used here.` };

      case "task": {
        // A task key, unless it is an invoice number of the same shape
        // (`INV-120`): admins get both lookups, and both matches as candidates.
        if (!allows("task") && !allows("invoice")) return wrongType("a task key");
        if (!allows("task") && !auth.isAdmin) return { ok: false, message: INVOICES_ADMIN_ONLY };
        const taskId = allows("task") ? await resolveTaskRef(ctx, orgId, ref.identifier) : null;
        const access = taskId ? await readableTask(taskId) : null;
        const invoice = allows("invoice") && auth.isAdmin ? await invoiceByNumber(parsed.input) : null;
        if (access && invoice) {
          const candidates: RefCandidate[] = [
            { type: "task", id: access.task._id, key: access.task.identifier ?? null, name: access.task.title },
            { type: "invoice", id: invoice._id, key: invoiceKey(invoice), name: invoice.subject ?? "Invoice" },
          ];
          return { ok: false, message: ambiguousMessage(parsed.input, candidates), candidates };
        }
        if (access) return { ok: true, resolved: { type: "task", access } };
        if (invoice) return { ok: true, resolved: { type: "invoice", invoice } };
        return notFound(allows("task") ? "task" : "invoice");
      }

      case "invoice": {
        if (!allows("invoice")) return wrongType("an invoice number");
        if (!auth.isAdmin) return { ok: false, message: INVOICES_ADMIN_ONLY };
        const invoice = await invoiceByNumber(ref.number);
        return invoice ? { ok: true, resolved: { type: "invoice", invoice } } : notFound("invoice");
      }

      case "external": {
        if (!allows("task")) return wrongType("an external ref (a task's)");
        const taskId = await externalRefOwner(ctx, orgId, ref.ref);
        const access = taskId ? await readableTask(taskId) : null;
        return access ? { ok: true, resolved: { type: "task", access } } : notFound("task");
      }

      case "email": {
        if (!allows("member")) return wrongType("an email");
        const matches = (await orgMembers()).filter((m) => m.user.email?.toLowerCase() === ref.email);
        if (matches.length === 0) {
          return { ok: false, message: `${parsed.input} is not a member of this workspace. ${NOT_FOUND_HINT.member}` };
        }
        if (matches.length > 1) {
          const candidates = matches.map((m) => ({ type: "member" as const, id: m.user._id, key: null, name: m.user.name }));
          return { ok: false, message: ambiguousMessage(parsed.input, candidates), candidates };
        }
        return { ok: true, resolved: { type: "member", user: matches[0].user, role: matches[0].role } };
      }

      case "key":
      case "client_key": {
        // A bare key is the project code (owner, 2026-10-24); clients are
        // written `client:KONV`. A client filter accepts a bare prefix too,
        // and a bare key that is no project code falls back to a client
        // prefix in fetch, so an exact unique prefix still resolves. Where an
        // invoice may be meant (admins), a short key is also tried as an
        // invoice number (`INV042`, `C7`); more than one match → candidates.
        const asClient = ref.kind === "client_key" || expected === "client";
        const asInvoice = ref.kind === "key" && allows("invoice");
        if (asClient && !allows("client")) return wrongType("a client prefix");
        if (!asClient && !allows("project") && !asInvoice) return wrongType("a project code");
        if (asInvoice && !allows("project") && !auth.isAdmin) return { ok: false, message: INVOICES_ADMIN_ONLY };
        const invoice = asInvoice && auth.isAdmin ? await invoiceByNumber(parsed.input) : null;
        const found = asClient || allows("project") ? await projectOrClient(ref.key, asClient, parsed.input, expected !== "project") : null;
        if (!invoice) return found ?? notFound("invoice");
        if (found === null || (!found.ok && !found.candidates?.length)) {
          return { ok: true, resolved: { type: "invoice", invoice } };
        }
        const candidates: RefCandidate[] = [
          ...(found.ok ? [candidateOf(found.resolved)] : found.candidates!),
          { type: "invoice", id: invoice._id, key: invoiceKey(invoice), name: invoice.subject ?? "Invoice" },
        ];
        return { ok: false, message: ambiguousMessage(parsed.input, candidates), candidates };
      }

      case "id": {
        const tables = ref.table ? [ref.table] : REF_TABLES.filter((t) => allows(TABLE_TYPE[t]));
        if (ref.table && !allows(TABLE_TYPE[ref.table])) return wrongType(`a link to a ${TYPE_NOUN[TABLE_TYPE[ref.table]]}`);
        // A real Convex ID names exactly one table; the first that accepts it decides.
        const table = tables.find((t) => isIdOf(t, ref.id));
        if (!table) return notFound(expected);
        if (table === "invoices" && !auth.isAdmin) return { ok: false, message: INVOICES_ADMIN_ONLY };
        const resolved = await byId(table, ref.id);
        return resolved ? { ok: true, resolved } : notFound(TABLE_TYPE[table]);
      }
    }
  }

  /** Like `resolve`, but throws the model-actionable message (search filters). */
  async function require(input: string, expected: RefType): Promise<Resolved> {
    const result = await resolve(input, expected);
    if (!result.ok) throw new ConvexError(result.message);
    return result.resolved;
  }

  /**
   * Forgets the org's clients read for prefix lookups: a write tool calls it
   * after creating a client or changing a prefix, so a later item of the
   * same call finds `client:NEW`.
   */
  function invalidateClients(): void {
    clients = null;
  }

  return { resolve, require, invalidateClients };
}

export type RefResolver = ReturnType<typeof createRefResolver>;
