# 01 — Auth hardening

**Type**: AFK
**Blocked by**: none
**Unblocks**: nothing strictly (other issues do not depend on this), but should land early as a defensive baseline.

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Authorization · User stories 46–47

## What to build

Close three currently-leaky Convex queries by adding `requireAdmin` checks, and hide the `Invoices` sidebar item from members.

Backend:
- `getReadyToInvoice` (will be deleted in #13, but harden it now in case it survives the cutover)
- `getProjectInvoiceMetrics`
- `getInvoicePreview`

Use the existing `requireAdmin` helper pattern (see `convex/invoices.ts:1194` for prior art).

Frontend:
- Hide the `Invoices` nav row in `lib/navigation.ts` (or wherever nav visibility is computed) for non-admin members.
- Use `<Show when={{ role: 'admin' }}>` from `@clerk/nextjs` per `CLAUDE.md` Auth Flow conventions.

## Acceptance criteria

- [ ] `getReadyToInvoice`, `getProjectInvoiceMetrics`, `getInvoicePreview` all reject member callers (verified manually with a member account).
- [ ] `Invoices` nav row is invisible when signed in as a member.
- [ ] Existing admin behavior is unchanged for all three queries.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

1. Sign in as an admin → `Invoices` nav appears, queries return data.
2. Sign in as a member → `Invoices` nav row is gone; calling the queries directly via the Convex dashboard with a member identity returns an authorization error.

## User stories addressed

- 46 (admin-only queries/mutations)
- 47 (Invoices nav hidden for members)

## Notes

- No tests required (small change; manual verification + existing query behavior preserved).
- The 3 queries above are the only currently-leaky ones identified in the PRD. New queries created in #04, #07, #09, #10, #12 must include `requireAdmin` from the start.
