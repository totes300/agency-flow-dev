# Development guide

## Local setup

Copy `.env.example` to `.env.local`, configure Clerk, and initialize Convex. Run
Convex before Next.js so the generated client and environment values are available.

```bash
npx convex dev
npm run dev
```

Use separate terminal sessions for the two long-running processes.

## MCP server (local)

- `npm run dev` serves https on port 3001 (`next dev --experimental-https`): Clerk
  requires an https MCP resource URL. The MCP endpoint is
  `https://localhost:3001/mcp`.
- Set `MCP_RESOURCE_URL=https://localhost:3001/mcp` in `.env.local` **and** on the
  Convex dev deployment (`npx convex env set MCP_RESOURCE_URL …`);
  `convex/auth.config.ts` refuses to deploy without it.
- Next.js creates a local certificate authority with mkcert for that https server.
  Clients on the same computer must trust it. Node-based clients such as Claude
  Code need `NODE_EXTRA_CA_CERTS` pointing at mkcert's root CA; on macOS:
  `NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/mkcert/rootCA.pem"`.
  Claude's web and desktop connectors are reached from Anthropic's servers and
  cannot connect to localhost.
- Connect: `claude mcp add --transport http agency-flow https://localhost:3001/mcp`
  (then `/mcp` to sign in) or `codex mcp add agency-flow --url …` and
  `codex mcp login agency-flow`. `/connected-apps` in the app shows the same steps.

## Common checks

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Choose checks based on risk. A focused unit test is useful while iterating; run the
broader checks before handing off a cross-cutting change. Report skipped checks and
unrelated pre-existing failures instead of silently expanding the task.

## Documentation workflow

Before changing framework or backend code:

1. Inspect `package.json` and the lockfile for the installed version.
2. For Next.js, read the relevant file under `node_modules/next/dist/docs/`.
3. For Convex, compare the header of `convex/_generated/ai/guidelines.md` with the
   installed version, then apply compatible guidance.
4. For other fast-moving libraries, prefer installed or official documentation and
   any relevant project skill that is available in the current agent environment.

Do not make a specific optional MCP server a prerequisite for development.

## Frontend workflow

- Add shadcn primitives through the project's installed shadcn CLI and inspect the
  current component API before composing them.
- Keep routes and pages focused on orchestration. Extract a component when it owns
  meaningful behavior, state, or a coherent visual section.
- Share domain elements and interaction patterns when they must remain consistent
  and have the same semantics. Do not extract solely to satisfy a line-count rule.
- Put currency, date, and timezone formatting behind helpers that receive the
  required context explicitly.
- Prefer render-time derivation to synchronized state. Use memoization only for a
  measured or clearly expensive computation.
- Store navigation-relevant filters and tabs in URL state; keep hover, open state,
  draft input, and other ephemeral details local.

## Async operations

- Await or deliberately void asynchronous operations.
- Handle user-visible failures at one clear boundary. Avoid duplicate toasts from a
  hook and its caller.
- Roll back optimistic UI when the underlying write fails.
- Do not swallow errors broadly; retain enough context for diagnosis without
  logging secrets or sensitive customer data.

## Loading and empty states

Use this sequence for data-driven views:

1. While data is unresolved, render a content-aware skeleton.
2. Once resolved and empty, render an intentional feature empty state.
3. Otherwise render the content.

Skeletons should reflect the actual table, form, card, or list structure rather
than generic rectangles.

## Planning and backlog

Read the current task-specific PRD or issue before implementation. Update
`docs/backlog.md` when the work is tracked there, including verification performed
and intentionally deferred follow-ups. Do not treat old phase documents as current
requirements without checking their status.
