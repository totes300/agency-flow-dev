import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { createRefResolver, type RefCandidate } from "../lib/mcpRefs";
import { buildRecord, FETCH_INCLUDES, orgClock, type FetchInclude } from "../lib/mcpRecords";
import { getOrgSettings } from "../lib/orgHelpers";
import { REF_CAP, getWorkspaceRefsForAuth, type WorkspaceRefTable } from "../workspaceRefs";

const WORKSPACE_TABLE_LABELS: Record<WorkspaceRefTable, string> = {
  statuses: "statuses",
  labels: "labels",
  projects: "projects",
  clients: "clients",
  orgMembers: "members",
  workCategories: "work categories",
};

/**
 * MCP `fetch` special refs (docs/prd-mcp.md §6, D9). Each function calls
 * `getMcpAuthContext` first (I1) and takes no org, user or role argument (I2).
 * They return compact data; the Next.js route renders the markdown.
 */

/** `fetch("me")`: who the connection acts as, in which org, with which role. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    const settings = await getOrgSettings(ctx, auth.orgId);
    return {
      user: { name: auth.user.name, email: auth.user.email ?? null },
      org: { id: auth.orgId, name: settings?.brandName ?? null },
      role: auth.orgRole,
    };
  },
});

/**
 * `fetch("workspace")`: the reference data an agent needs to write valid
 * input — status, label and category names, members by email, project codes
 * and client prefixes. Display fields only, like the UI's workspace query.
 * Never a partial result (owner decision D-B, like reports): a table over the
 * read cap refuses the whole fetch instead of returning clipped rows.
 */
export const workspace = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    const { refs, truncated } = await getWorkspaceRefsForAuth(ctx, auth);
    if (truncated.length > 0) {
      const tables = truncated.map((t) => WORKSPACE_TABLE_LABELS[t]).sort().join(", ");
      throw new ConvexError(
        `The workspace has more than ${REF_CAP} ${tables}, so fetch("workspace") cannot return a complete list. ` +
          "Look up the specific records you need by reference instead.",
      );
    }
    const clientNames = new Map(refs.clients.map((c) => [c._id, c.name]));
    return {
      orgTaskKey: refs.orgTaskKey,
      statuses: refs.statuses.map((s) => ({
        name: s.name,
        category: s.category,
        isDefault: s.isDefault,
        archived: s.archived,
      })),
      labels: refs.labels.map((l) => ({ name: l.name, archived: l.archived })),
      workCategories: refs.workCategories.map((c) => ({ name: c.name, archived: c.archived })),
      members: refs.members.map((m) => ({ name: m.name, email: m.email, role: m.role })),
      projects: refs.projects.map((p) => ({
        code: p.code,
        name: p.name,
        client: clientNames.get(p.clientId) ?? null,
        archived: p.archived,
      })),
      clients: refs.clients.map((c) => ({
        id: c._id,
        name: c.name,
        prefix: c.prefix,
        archived: c.archived,
      })),
    };
  },
});

/** Most refs one `records` call resolves (the tool's `refs[]` cap, docs/prd-mcp.md §6). */
const MAX_RECORD_REFS = 25;

/**
 * `fetch(refs[])` for records: tasks, comments, time entries, projects,
 * clients and members, by any reference form (docs/prd-mcp.md §7). Every
 * ref is resolved and access-checked in the caller's org (I3); a missing,
 * foreign or unreadable record is "not found", an ambiguous short key or
 * email returns its candidates. Results keep the input order, one per ref.
 * `now` is the caller's clock (queries never read it) for "overdue".
 */
export const records = query({
  args: {
    refs: v.array(v.string()),
    include: v.array(v.union(...FETCH_INCLUDES.map((i) => v.literal(i)))),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    if (args.refs.length > MAX_RECORD_REFS) {
      throw new ConvexError(`Fetch at most ${MAX_RECORD_REFS} refs per call.`);
    }
    const clock = await orgClock(ctx, auth.orgId, args.now);
    const include = new Set<FetchInclude>(args.include);
    const resolver = createRefResolver(ctx, auth);
    const results = [];
    for (const input of args.refs) {
      const resolution = await resolver.resolve(input);
      if (!resolution.ok) {
        results.push({
          input,
          ok: false as const,
          message: resolution.message,
          candidates: resolution.candidates ?? ([] as RefCandidate[]),
        });
        continue;
      }
      const record = await buildRecord(ctx, auth, resolution.resolved, include, clock);
      results.push(
        record
          ? { input, ok: true as const, record }
          : { input, ok: false as const, message: `${input} not found.`, candidates: [] as RefCandidate[] },
      );
    }
    return { timezone: clock.timezone, today: clock.today, results };
  },
});
