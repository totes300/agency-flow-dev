# Phase 2 — Clients

> **Goal**: Client directory — who you work for, what currency, what billing details. Every project, task, and time entry chains back here.
> **Depends on**: Phase 0 (Foundation)
> **Access**: Admin only

---

## Decisions

| Question | Decision |
|----------|----------|
| Client detail scope? | Full in v1 (contact + billing + logo) — needed for PDF invoices |
| Proposals / contracts? | ❌ Out of v1 — a link in notes field suffices |
| Invoice prefix? | ✅ Lives on client, auto-generated from name (first 4 alphanumeric chars, uppercase, diacritics stripped), editable |
| Billing email? | ✅ Separate field on client (not a contact) — invoices go here |
| Contacts? | ✅ List (1:N separate table), name + email (unique per org) + phone + primary flag |
| Active/inactive status? | ❌ Not needed, archive is enough |
| Currencies? | ~15 ISO 4217 subset (EUR, USD, GBP, HUF, CHF, CZK, PLN, etc.) |
| Currency lock? | ❌ Client currency always modifiable (doesn't affect existing projects) |
| Cascade behavior? | Archive cascades down (client → projects → tasks → timers stop). Restore does NOT cascade. |
| Email uniqueness? | ✅ Contact email unique per org — future email module (v2) matches on this |
| Undo toast? | 5s delayed mutation on archive. Visually disappears immediately, undo reverts. |

---

## Schema

```typescript
clients: defineTable({
  orgId: v.string(),
  name: v.string(),                         // Required, trimmed
  currency: v.string(),                     // ISO 4217, default: org default
  invoicePrefix: v.string(),                // Auto-generated, editable, e.g., "ACME"
  billingEmail: v.optional(v.string()),     // Separate from contacts — invoices go here
  billingAddress: v.optional(v.string()),   // Multi-line
  taxId: v.optional(v.string()),            // e.g., EIN or VAT number
  logoStorageId: v.optional(v.id("_storage")),
  notes: v.optional(v.string()),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_orgId", ["orgId"])

clientContacts: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  name: v.string(),                         // Required
  email: v.string(),                        // Required, UNIQUE per org
  phone: v.optional(v.string()),
  isPrimary: v.boolean(),                   // Exactly one primary per client
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_clientId", ["clientId"])
  .index("by_orgId_email", ["orgId", "email"])
```

## What it stores

### Client (main record)
**Required**: Company name + currency + invoice prefix
**Billing details** (optional, but needed for PDF invoices in Phase 2):
- Billing email, billing address (multi-line), tax ID, logo, notes

### Invoice prefix
- Auto-generated from client name: first 4 alphanumeric characters, uppercase, diacritics stripped
  - "Acme Corp" → "ACME"
  - "Müller & Co" → "MULL"
- **Editable** — admin can override
- In Phase 2 (Billing): invoice number format is `PREFIX-YEAR-SEQ` (e.g., ACME-2026-001)

### Contacts list (1:N, separate table)
- **Name**: required
- **Email**: required, **unique per org** (not globally, within the org)
  - Validation: if email already exists on another client → error "This email is already assigned to [other client name]"
  - Why unique: the future email module (inbound email → client match) relies on this
- **Phone**: optional
- **Primary flag**: exactly one contact should be primary per client
  - If you mark a new contact as primary, the old one loses it
  - If you delete the only primary → the oldest remaining becomes primary

### Currency
- Default: org default currency
- Modifiable at any time (no lock)
- Projects inherit this as default, but can override

## Operations

### Create
- **Modal form**: Name (required) + currency (dropdown, defaults to org's) → create
- Invoice prefix auto-generated from name, but editable in the modal
- Optional: contact details, billing details (can fill in now or later)
- At least 1 contact recommended but not required at creation

### Edit
- **All fields modifiable**, including currency (no lock)
- Changing name does NOT auto-change invoice prefix (that's separately editable)

### Archive
- **Cascades**: Client archive → all projects → all tasks archived
- **Running timers** on archived tasks → automatically stop, time entry created
- **5s undo toast**: Visually disappears immediately, actual mutation runs with 5s delay
  - If Undo → nothing happens
  - If no click → executes after 5s
  - If network error → auto-reverts
- **Restore does NOT cascade**: restoring a client only restores the client — projects and tasks must be restored individually
  - UX: on restore, show toast/banner: "Projects and tasks are still archived — restore them individually."

### Hard delete
- **Blocked if time entries exist** on any project → "Cannot delete: archive instead"
  - Check: any timeEntry where the task's project belongs to this client?
- **If no time**: cascade delete — contacts, projects, tasks, everything
- **Confirmation dialog**: "This will permanently delete [client name] and all associated data. This cannot be undone."

## Queries / Mutations

```
clients.list        — all org clients (archived optionally)
                     Returns: name, currency, active project count, current month time
clients.get         — one client by ID (detailed, includes contacts)
clients.create      — admin only
clients.update      — admin only
clients.archive     — admin only (cascade, 5s delayed)
clients.restore     — admin only (does NOT cascade)
clients.remove      — admin only (hard delete, blocked if time exists)

clientContacts.list    — all contacts for a client
clientContacts.create  — admin only (email uniqueness check)
clientContacts.update  — admin only
clientContacts.remove  — admin only
clientContacts.setPrimary — admin only (old primary loses flag)
```

## UI

### List view (`/clients`)
- **Table**: Company name, currency badge, active project count, current month hours
- **Search**: by name
- **"Show archived" toggle**
- **"+ New client" button** → modal
- Click row → client detail page

### Detail view (`/clients/[id]`)
- **Header**: Name + currency badge + invoice prefix
- **Contacts list**: Table — name, email, phone, primary badge. + Add contact button.
- **Billing details**: Billing email, address, tax ID, logo upload
- **Notes**: free-text field
- **Active projects list**: Table — project name, type badge, monthly hours, last activity
  - Click → navigates to project detail page
- **Edit button**: inline editing or modal for main fields
- **Archive / Delete** in the ⋮ menu

### Logo upload
- Convex file storage (`_storage` table)
- Max 2MB, image types (PNG, JPG, SVG)
- Preview after upload
- Delete button to remove logo

## Acceptance criteria

- [ ] Admin creates client (name + currency), appears in list
- [ ] Invoice prefix auto-generated and editable
- [ ] Contacts list: CRUD, email uniqueness within org
- [ ] Primary flag: exactly one per client
- [ ] Currency modifiable (no lock)
- [ ] List view shows: active project count + monthly hours
- [ ] Archive cascades (projects, tasks, timers stop)
- [ ] 5s undo toast pattern works
- [ ] Restore does NOT cascade + info message
- [ ] Hard delete blocked if time entries exist
- [ ] Logo upload and preview works
- [ ] Member cannot see the /clients route
- [ ] All data filtered by orgId
