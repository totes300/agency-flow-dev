import { query } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { getOrgSettings } from "../lib/orgHelpers";
import { getWorkspaceRefsForAuth } from "../workspaceRefs";

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
 * `truncated` lists tables over the read cap; the renderer must say so.
 */
export const workspace = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    const { refs, truncated } = await getWorkspaceRefsForAuth(ctx, auth);
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
      truncated,
    };
  },
});
