# Authentication and tenant isolation

Agency Flow is multi-tenant. A tenant-isolation failure is a security incident, not
just a data bug.

## Trust boundary

- Clerk Organization is the tenant boundary.
- Derive identity, active organization, and role from the authenticated server-side
  context.
- Never authorize an operation using a client-provided user ID, role, or `orgId`.
- Client-side role checks and route guards improve UX but do not replace backend
  authorization.

## Protected Convex operations

At the start of a protected query or mutation, use the established helpers in
`convex/lib/auth.ts` such as `getAuthContext` or `requireAdmin`.

For actions, cross into an authenticated internal query where database-backed auth
context is required. Keep sensitive implementation functions internal unless they
must be callable by clients.

## Read rules

- Collection reads should use an index whose leading fields establish the active
  organization scope.
- Direct `ctx.db.get` calls must be followed by an ownership check before the
  document is returned or used.
- Related documents loaded by ID require the same check; validating only the root
  document is insufficient if children can reference another tenant.
- Search indexes must include and constrain an organization filter field.
- Prefer returning not-found behavior for inaccessible tenant resources when that
  avoids leaking their existence.

## Write rules

- Set `orgId` from authenticated context when creating tenant-owned documents.
- Before updating, deleting, archiving, attaching, or relating an existing record,
  verify it belongs to the active organization.
- Validate that referenced users, projects, clients, tasks, and other foreign keys
  belong to the same organization.
- Enforce role and ownership policies in the backend even if the corresponding UI
  control is hidden.

## Tasks

- Every task read and write goes through `convex/tasks/access.ts`
  (`loadTaskForRead`, `loadTaskForWrite`, `filterReadableTasks`,
  `userCanReadTask`). Do not re-implement `isAdmin || assigneeIds.includes(...)`
  checks; a member's access comes from `taskAssignees` edges (own or the
  parent's), never from the `assigneeIds` cache.
- Task rows and edges are written only by `convex/tasks/write.ts`.
- Task search (`search_title`) always filters on `orgId` and the hits are
  access-filtered before anything is returned (pickers, agent mentions, agent
  tools).
- Agent tools call the task queries with the running user's identity; an
  @-mentioned task is re-resolved through `access.ts` before its title reaches
  the model.

## MCP (OAuth) token surface

The MCP server (`docs/prd-mcp.md` §5) is a second way in, with its own rules:

- Every `convex/mcp/*` function calls `getMcpAuthContext` first (I1) and takes no
  `orgId`, user or role argument (I2); `convex/__tests__/mcpInvariants.test.ts`
  enforces both on the source.
- The org comes from the verified token's `org_id`; the role comes **only** from
  `orgMembers`, never from the token (OAuth tokens carry no org role). Do not reuse
  the session-token parsing of `getAuthContext` for OAuth identities.
- Every reference resolved from tool input (ID, link, key, email, external ref) is
  ownership-checked in the caller's org; a foreign or unreadable record is "not
  found", never "forbidden" (I3).
- A session JWT cannot call `convex/mcp/*` and an OAuth JWT cannot call UI
  functions: the `client_id` claim decides the surface (I4).
- A batch write is one mutation: all items succeed or none (I5).
- Revocation is enforced here, not in Clerk: a revoked `mcpConnections` row (org +
  user + client) refuses that client's every token on the next call, and
  `MCP_DISABLED="true"` refuses all MCP calls. Removing a member cuts access on the
  next call because membership is re-read every time.

## Review checklist

- Can the caller choose the organization used for authorization?
- Does every ID-based read verify the fetched document's organization?
- Are all related IDs checked against the same tenant?
- Does the query start from an organization-scoped index and remain bounded?
- Are admin/member/self permissions enforced server-side?
- Could an error, log, export, or AI/tool response expose another tenant's data?
- Are secrets confined to server-side or Convex environment variables?

## Tests

Security-sensitive backend changes should include negative tests where practical:

- unauthenticated caller;
- authenticated caller without an active organization;
- member attempting an admin operation;
- tenant A attempting to read or mutate tenant B's document;
- cross-tenant foreign-key or attachment reference.
