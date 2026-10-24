import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { clientPrefixKey, effectiveClientPrefix } from "./helpers";
import { loadTaskForReadOrNull, type TaskAccess } from "../tasks/access";
import { resolveTaskRef } from "../tasks/lookup";
import { visibleTimeEntries } from "../timeEntries";
import { REF_CAP } from "../workspaceRefs";
import { parseRef, REF_TABLES, type RefTable } from "../../lib/mcp/refs";

/**
 * Resolves MCP references (docs/prd-mcp.md §7) inside the caller's org with
 * the app's own access rules (I3). The pure parser (lib/mcp/refs.ts)
 * classifies the string; this module finds the record and checks it:
 *
 * - tasks: identifier (live or alias) or ID, readable per tasks/access.ts;
 * - comments: ID, on a task the caller can read;
 * - time entries: ID, visible per `visibleTimeEntries` (members: own only);
 * - projects / clients: ID, project code, client prefix (case-insensitive);
 * - members: ID, email (case-insensitive), with a membership in the org.
 *
 * Missing, other-org and unreadable records are all "not found" — never
 * "forbidden" — so references cannot probe other tenants. A short key or
 * email that matches more than one record is ambiguous and returns the
 * candidates; the resolver never guesses.
 */

export type RefType = "task" | "comment" | "time_entry" | "project" | "client" | "member";

export type Resolved =
  | { type: "task"; access: TaskAccess }
  | { type: "comment"; comment: Doc<"comments">; access: TaskAccess }
  | { type: "time_entry"; entry: Doc<"timeEntries"> }
  | { type: "project"; project: Doc<"projects"> }
  | { type: "client"; client: Doc<"clients"> }
  | { type: "member"; user: Doc<"users">; role: "admin" | "member" };

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
};

const TYPE_NOUN: Record<RefType, string> = {
  task: "task",
  comment: "comment",
  time_entry: "time entry",
  project: "project",
  client: "client",
  member: "member",
};

const NOT_FOUND_HINT: Record<RefType, string> = {
  task: "Use search to find tasks.",
  comment: "Use search to find comments.",
  time_entry: "Use search to find time entries.",
  project: 'Project codes are listed in fetch("workspace").',
  client: 'Client prefixes are listed in fetch("workspace").',
  member: 'Members are listed in fetch("workspace").',
};

/** A message naming every candidate by its unique ID, so the model can retry exactly. */
export function ambiguousMessage(input: string, candidates: readonly RefCandidate[]): string {
  const list = candidates
    .map((c) => `${TYPE_NOUN[c.type]} ${c.key ? `${c.key} · ` : ""}${c.name} (ref ${c.id})`)
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
    }
  }

  /** Whether `raw` is an ID of `table` at all (regardless of org or access). */
  function isIdOf(table: RefTable, raw: string): boolean {
    return ctx.db.normalizeId(table, raw) !== null;
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
        if (!allows("task")) return wrongType("a task key");
        const taskId = await resolveTaskRef(ctx, orgId, ref.identifier);
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

      case "key": {
        if (!allows("project") && !allows("client")) return wrongType("a project code or client prefix");
        const projects = allows("project")
          ? await ctx.db
              .query("projects")
              .withIndex("by_orgId_code", (q) => q.eq("orgId", orgId).eq("code", ref.key.toUpperCase()))
              .take(10)
          : [];
        const key = clientPrefixKey(ref.key);
        const clients = allows("client")
          ? (await orgClients()).filter((c) => {
              const prefix = effectiveClientPrefix(c);
              return prefix !== null && clientPrefixKey(prefix) === key;
            })
          : [];
        if (projects.length + clients.length === 0) {
          const hint = expected
            ? NOT_FOUND_HINT[expected]
            : 'Project codes and client prefixes are listed in fetch("workspace").';
          return { ok: false, message: `${parsed.input} not found. ${hint}` };
        }
        if (projects.length + clients.length > 1) {
          const candidates: RefCandidate[] = [
            ...projects.map((p) => ({ type: "project" as const, id: p._id, key: p.code, name: p.name })),
            ...clients.map((c) => ({ type: "client" as const, id: c._id, key: effectiveClientPrefix(c), name: c.name })),
          ];
          return { ok: false, message: ambiguousMessage(parsed.input, candidates), candidates };
        }
        return {
          ok: true,
          resolved:
            projects.length === 1 ? { type: "project", project: projects[0] } : { type: "client", client: clients[0] },
        };
      }

      case "id": {
        const tables = ref.table ? [ref.table] : REF_TABLES.filter((t) => allows(TABLE_TYPE[t]));
        if (ref.table && !allows(TABLE_TYPE[ref.table])) return wrongType(`a link to a ${TYPE_NOUN[TABLE_TYPE[ref.table]]}`);
        // A real Convex ID names exactly one table; the first that accepts it decides.
        const table = tables.find((t) => isIdOf(t, ref.id));
        if (!table) return notFound(expected);
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

  return { resolve, require };
}

export type RefResolver = ReturnType<typeof createRefResolver>;
