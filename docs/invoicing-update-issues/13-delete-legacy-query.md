# 13 — Delete legacy `getReadyToInvoice`

**Type**: AFK
**Blocked by**: #07 (banner replaces last consumer of legacy query), #08 (breakdown rebuild stops reading it), #09 (`getReadyToInvoiceUnified` is the new source of truth)
**Unblocks**: nothing — final cleanup.

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Lifecycle ("`getReadyToInvoice` is **deleted** in the same PR that ships `getReadyToInvoiceUnified`")

## What to build

Delete the legacy retainer-only query and its dedicated UI consumer.

### Delete

- `getReadyToInvoice` from `convex/invoices.ts` (or wherever it lives).
- `<ReadyToInvoiceCard />` — should already be deleted by #08, this is a verification step. If anything still references it, delete those too.

### Verify all callers migrated

```sh
git grep getReadyToInvoice                # expect zero matches except this issue file
git grep ReadyToInvoiceCard               # expect zero matches except this issue file
```

If any matches remain, migrate them to `getReadyToInvoiceUnified` before deleting.

## Acceptance criteria

- [ ] `getReadyToInvoice` query deleted.
- [ ] `<ReadyToInvoiceCard />` file + all imports gone.
- [ ] `git grep getReadyToInvoice` clean (excluding this file and any migration history docs).
- [ ] `git grep ReadyToInvoiceCard` clean (same exclusion).
- [ ] `npm run build` succeeds.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

1. Run the two `git grep` commands.
2. `npm run build` succeeds.
3. Visit `/invoices`, every project Overview, sidebar — no missing data, no console errors.

## User stories addressed

(Cleanup; no direct user story.)

## Notes

- Per memory `feedback_one_pr_refactors`: this issue is part of the single-PR bundle, not a separate cleanup PR.
- Per `CLAUDE.md`: avoid backwards-compat shims. Don't keep a deprecated wrapper. Just delete.
