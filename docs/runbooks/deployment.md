# Deployment runbook

This runbook records deployment concerns without duplicating the current route or
dependency inventory. Confirm commands and platform configuration against the
repository and provider dashboards at deployment time.

## Preflight

1. Inspect the working tree and confirm the intended release contents.
2. Run the relevant verification suite:

   ```bash
   npx tsc --noEmit
   npm run lint
   npm test
   npm run build
   ```

3. Confirm development-only tooling, local endpoints, fixtures, and seed behavior
   cannot run in production. Prefer build-time exclusion or automated checks over a
   recurring manual source edit.
4. Review schema, migration, backfill, and generated-code changes before deploying
   Convex.

## Environment configuration

Use `.env.example` as the variable inventory. Do not copy real values into source,
logs, issue documents, or agent instructions.

The application requires Convex and Clerk configuration. AI worksheet summaries
also use Convex-side secret configuration:

- `AI_KEY_ENCRYPTION_KEK` encrypts customer-provided API keys at rest.
- `AI_GATEWAY_API_KEY` and `ANTHROPIC_API_KEY` are optional operator fallbacks.

Set Convex runtime variables through the Convex environment tooling for each target
environment. Next.js/Vercel environment variables and Convex environment variables
are separate stores.

## Encryption-key handling

Generate the key with a cryptographically secure method documented in
`.env.example`. Store and back it up through the team's secret-management process.

Do not rotate `AI_KEY_ENCRYPTION_KEK` as an ordinary configuration change. Existing
customer keys are encrypted with it; rotation requires a coordinated migration or a
customer re-entry plan. Verify the rollback and recovery approach before changing
the value.

## Deployment sequence

1. Confirm target environments and secrets.
2. Deploy Convex schema and functions using the repository's current supported
   workflow.
3. Deploy the Next.js application.
4. Exercise authentication, organization switching, one protected read, one
   protected write, and the feature changed by the release.
5. Check logs for authorization failures, missing environment variables, webhook
   failures, and unexpected client-visible errors without exposing sensitive data.

## Rollback readiness

Before a risky release, identify which parts are backward compatible and which
require coordinated rollback. Database/schema transitions should follow a
widen-migrate-narrow approach when existing data or running clients would otherwise
become incompatible.
