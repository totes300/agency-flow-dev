# 05 — `<InvoiceMessageBlock />` on invoice document

**Type**: HITL (visual fidelity to design)
**Blocked by**: #04 (`messageToClient` schema + seeding)
**Unblocks**: #09 (the Generate flow opens the invoice editor which includes this block)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #6 · User stories 37, 38, 39, 40

## What to build

A new shared component `components/invoices/invoice-message-block.tsx` that renders on the invoice document.

### Props

```ts
type Props = {
  invoice: Doc<"invoices">; // includes status, messageToClient, project type ref
  template: string | undefined; // orgSettings.invoiceMessageTemplate
};
```

### Behavior matrix

| Invoice state | Block visibility | Editable? |
|---|---|---|
| Draft (any project type) | Visible — show empty affordance if `messageToClient` is empty | Yes |
| €0 auto-Paid retainer (status=paid, total=0, type=retainer) | Visible | **Yes — indefinitely** (no lock) |
| Money-due Invoiced or Paid (status≠draft, total>0) | Visible if non-empty; nothing if empty | **No — read-only** |
| Void | Read-only |  No |

Empty-state affordance (draft only): subtle `+ Add a message to client` button that, when clicked, opens the editor seeded with the template. If user discards without typing, save nothing.

### Persistence

Calls `updateInvoice({ id, messageToClient })` mutation on commit (debounced or on blur — match existing line-item edit pattern in the invoice editor).

### Print/sent rendering

When the invoice doc is rendered for print/PDF (future PR) or as `messageToClient` is empty AND status≠draft, the block renders **nothing** — no placeholder.

## Acceptance criteria

- [ ] Component lives at `components/invoices/invoice-message-block.tsx`.
- [ ] All 4 rows of the behavior matrix render correctly (verified manually).
- [ ] Empty draft shows the `+ Add a message to client` affordance.
- [ ] Edit persists via `updateInvoice` mutation. Errors caught with `toastError` per `CLAUDE.md` mutation rule.
- [ ] €0 auto-Paid retainer remains editable after generation.
- [ ] Money-due Invoiced/Paid is read-only.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

1. Generate a draft invoice → block shows `+ Add a message to client`. Click it, type, save. Refresh → message persists.
2. Money-due draft → finalize to Invoiced → block becomes read-only.
3. Generate a within-budget retainer (auto-Paid) → block stays editable. Edit, save, refresh, persists.
4. Money-due Invoiced with empty `messageToClient` → block renders nothing.

## User stories addressed

- 37 (per-invoice editable, template-seeded)
- 38 (empty-state affordance in draft, no placeholder on sent)
- 39 (€0 retainer indefinitely editable)
- 40 (money-due locks at draft → invoiced)

## Notes

- **Use `context7` for Tiptap docs** if this block uses Tiptap (per `CLAUDE.md` library-docs rule). If a plain `Textarea` suffices, use shadcn — confirm via `shadcn` skill.
- The `updateInvoice` mutation must accept `messageToClient` updates; verify it does or extend it. If extension needed, also gate by status (only draft + €0-retainer-paid allow update). Add a small server-side test for that gate.
- Per `CLAUDE.md`: this is a domain UI element, lives in `components/invoices/` from first use.
