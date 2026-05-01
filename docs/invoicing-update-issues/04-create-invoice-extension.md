# 04 — `createInvoice` extension

**Type**: AFK
**Blocked by**: #03 (template field must exist to seed from)
**Unblocks**: #05 (message block reads `messageToClient`), #07 (banner Generate button uses resume-draft), #09 (batch generate uses auto-Paid path)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Schema changes · § Auto-Paid €0 retainer invoices · § Concurrency rules · User stories 20, 39, 42, 43, 44, 45

## What to build

### Schema

Add one optional field to `invoices`:

```ts
messageToClient: v.optional(v.string()),
```

`invoices.status` enum unchanged (`void` stays).

### `createInvoice` mutation extension

Three new behaviors, all server-side, all in `convex/invoices.ts`:

1. **Seed `messageToClient`** from `orgSettings.invoiceMessageTemplate` on creation. If template is unset, leave field undefined.

2. **Auto-Paid €0 retainer**: when project type is retainer AND computed `total === 0`, set `status: "paid"` and `paidAt: Date.now()` at creation. Skip the draft → invoiced transition entirely. (No `finalizedAt` field — see PRD note: lock semantics ship with PDF infra later.)

3. **Return existing draft for T&M and Fixed**: extend the retainer-month return-existing rule (currently at `convex/invoices.ts:1276`) to T&M and Fixed projects. If a draft invoice already exists for the same project + period, return that invoice's id instead of creating a new one. Caller distinguishes by checking the returned invoice's `_creationTime` or by getting back the same id.

Public signature unchanged. Admin-only (already is).

### Tests (mandatory — `convex/lib/__tests__/` style)

Cover:
- Within-budget retainer (€0) → `status: "paid"`, `paidAt` set, draft skipped.
- Money-due retainer → `status: "draft"`, no `paidAt`, normal path.
- `messageToClient` seeded when template set; undefined when template unset.
- T&M with existing draft → returns existing id, no new doc created.
- Fixed with existing draft → returns existing id, no new doc created.
- Member call → rejected (auth).

## Acceptance criteria

- [ ] Schema migration adds `messageToClient`.
- [ ] All three behaviors implemented.
- [ ] Tests cover all 6 cases above and pass.
- [ ] Public signature of `createInvoice` unchanged.
- [ ] Existing retainer-month tests still pass (no regressions).
- [ ] `npx tsc --noEmit` clean.

## Verification

1. Open a within-budget retainer in the UI, click Generate → invoice appears with status Paid, total €0.
2. Open a money-due retainer, click Generate → invoice appears as Draft.
3. Generate twice on the same T&M period → second click returns the same invoice (verify in DB or via UI behavior in #07/#09 once those land).
4. With template set in #03, generated invoices have message pre-filled (verifiable in DB; UI lands in #05).

## User stories addressed

- 20 (clicking Generate on existing draft → opens that draft)
- 39 (€0 retainer auto-Paid, message editable indefinitely — message lock not enforced here, that's a future PR)
- 42, 43 (CreateInvoiceModal pre-select most relevant period, resume-draft toast — frontend lands with #09)
- 44, 45 (€0 preview clean — covered by existing preview code; no new work here)

## Notes

- Per memory `project_mvp_dummy_data`: direct schema narrow OK, no migration needed.
- Concurrency: `createInvoice`'s existing optimistic concurrency on `nextInvoiceNumber` continues to work — no new locking primitives needed.
- The "resuming draft" toast text and modal flow live in #07 (per-banner Generate) and #09 (Inbox Generate) — this issue ships only the backend behavior + tests.
