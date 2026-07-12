# Agency Flow

Multi-tenant B2B SaaS built with Next.js, Convex, Clerk, TypeScript, and
shadcn/ui. Read exact versions and scripts from `package.json` and the lockfile.

## Work from current sources

- Inspect the repository before assuming routes, APIs, schema, or project state.
  Use `app/` for routes, `convex/schema.ts` for data, and the current task's PRD or
  issue under `docs/` for scope. Older phase documents may be historical.
- Keep changes within the requested scope and preserve unrelated user or agent work.

## Documentation when needed

- Next.js change: read the relevant version-matched file in
  `node_modules/next/dist/docs/` before coding.
- Convex change: first read `convex/_generated/ai/guidelines.md` and compare its
  target version with the installed package. If they differ, flag the mismatch and
  verify version-specific APIs elsewhere.
- shadcn/ui or Clerk change: use the installed matching project skill and its
  version-aware workflow. For other external APIs, prefer installed or official
  documentation; use Context7 only as an available fallback, pinned to the
  installed version. Do not block a task on an optional MCP server.

## Non-negotiable invariants

- Clerk Organization is the tenant boundary. Protected backend operations derive
  organization and role from server-side auth, never from client-supplied IDs.
- Use organization-scoped indexes for lists. After ID-based reads, verify ownership
  before returning, relating, or mutating records. Enforce authorization in Convex;
  route guards and hidden UI are not security boundaries.
- Never expose secrets in client code, logs, commits, fixtures, or responses.
- The worktree may contain concurrent work. Inspect status and relevant diffs before
  editing. Do not use `git stash`, `git clean`, `git restore`, `git checkout --`, or
  destructive resets to create a clean baseline.

## Verification

Run checks proportionate to the change and report what ran: `npx tsc --noEmit`,
`npm run lint`, `npm test`, and `npm run build` when warranted. Do not introduce new
failures or silently expand scope to repair unrelated existing ones.

Open detailed guidance only when relevant: `docs/architecture.md`,
`docs/development.md`, `docs/security/tenancy.md`, and `docs/runbooks/`.
