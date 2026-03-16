# Phase 0 — Foundation

> **Goal**: The org-aware infrastructure every module depends on. Nothing else works without this.


---

## Architectural decisions (this phase establishes them)

| Decision | Choice | Why |
|----------|--------|-----|
| **Multi-tenant** | Clerk Organization = tenant | All data isolated by orgId |
| **Roles** | Clerk org roles: `admin` + `member` | From JWT, not custom field |
| **Timezone** | Org-level IANA timezone setting | Timer, time entry dates, reports all align to this |
| **Base fields** | `createdAt`, `updatedAt`, `createdBy` on every table | Sorting, audit, debug — can't backfill later |
| **Soft delete** | `archivedAt: number \| undefined` (timestamp, not boolean) | If set: archived + when. If unset: active. |
| **Currency** | Org default currency, ~15 ISO 4217 subset | Chain: org → client → project → invoice |
| **Rounding** | Org setting: 1m / 5m / 6m / 15m, always ceil | Applies to timer and manual entry |
| **Statuses** | Custom `statuses` table + 5 system types | Org-level, configurable. System logic uses the type. |
| **Billing state** | `invoicedInReportId` FK on time entry (not on task) | Work and money axes separated |
| **Rate snapshot** | Rate stored on time entry at creation | No retroactive rate change problems |

---


- Clerk auth (sign-in/up, pre-built components)
- Clerk Organizations (multi-tenant, team switcher)
- User sync (Clerk → Convex `users` table, `syncUser` mutation)
- Route protection (`proxy.ts` Clerk middleware)
- App shell (sidebar, breadcrumbs, shadcn/ui)
- Org settings page (Clerk `OrganizationProfile` embed)

### 1. Convex auth helpers

**File**: `convex/lib/auth.ts`

```typescript
// getAuthContext(ctx) — call at the start of every protected query/mutation
// Returns: { userId: Id<"users">, orgId: string, orgRole: "admin" | "member", isAdmin: boolean, user: Doc<"users"> }
// Throws: if no auth, no org, no Convex user

// requireAdmin(ctx) — same as getAuthContext but throws if not admin

// getUserConvexId(ctx) — Clerk identity → Convex users table ID
```

**Where do orgId and orgRole come from?**
- `ctx.auth.getUserIdentity()` → the Clerk JWT contains `orgId` and `orgRole`
- In Clerk Organizations, the user selects which org they're in → this goes into the JWT
- Convex `auth.config.ts` is already configured with the Clerk JWT issuer

**Critical**: Every query and mutation starts with this helper. If there's no orgId, the user isn't in an org → error.

### 2. orgSettings table + seed

**Schema**:
```typescript
orgSettings: defineTable({
  orgId: v.string(),
  defaultCurrency: v.string(),           // "USD"
  timezone: v.string(),                  // "America/New_York" (IANA)
  roundingMinutes: v.number(),           // 1, 5, 6, or 15
  // Branding (used in Phase 2, but define the fields now)
  brandName: v.optional(v.string()),
  brandLogoStorageId: v.optional(v.id("_storage")),
  brandAddress: v.optional(v.string()),
  brandTaxId: v.optional(v.string()),
  brandEmail: v.optional(v.string()),
  brandPhone: v.optional(v.string()),
  // Base
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_orgId", ["orgId"])
```

**Seed logic**: When a user logs in and the org has no orgSettings record → auto-create:
```
{ defaultCurrency: "USD", timezone: "America/New_York", roundingMinutes: 1 }
```

**Queries/Mutations**:
- `orgSettings.get` — returns the current org's settings
- `orgSettings.update` — admin only, modifies settings

### 3. statuses table + seed

**Schema**:
```typescript
statuses: defineTable({
  orgId: v.string(),
  name: v.string(),
  color: v.string(),
  icon: v.optional(v.string()),
  type: v.union(
    v.literal("backlog"),
    v.literal("in_progress"),
    v.literal("review"),
    v.literal("blocked"),
    v.literal("done")
  ),
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_type", ["orgId", "type"])
```

**5 system types**:
- `backlog` — unprioritized pile, nobody's working on it
- `in_progress` — someone is actively working on it
- `review` — waiting on someone (admin review, client review)
- `blocked` — cannot proceed
- `done` — complete

**The system uses type, not name**:
- Tabs: Active = in_progress + review + blocked, Backlog = backlog, Review = review, Blocked = blocked, Done = done
- "Member can't mark done" = member cannot switch to type:done status
- New custom statuses can be assigned to any type by the admin

**Seed set (8 default statuses)**:

| Name | Type | Color | Sort |
|------|------|-------|------|
| Inbox | backlog | gray | 0 |
| Today | backlog | blue | 1 |
| Next up | in_progress | blue | 2 |
| In progress | in_progress | amber | 3 |
| Admin review | review | purple | 4 |
| Client review | review | coral | 5 |
| Stuck | blocked | red | 6 |
| Done | done | green | 7 |

**Queries/Mutations**:
- `statuses.list` — all org statuses, sorted by sortOrder
- `statuses.create` — admin only, new status
- `statuses.update` — admin only, modify name/color/icon/type/order
- `statuses.archive` — admin only (set archivedAt)
- `statuses.seed` — if 0 statuses exist, create the 8 defaults

### 4. Sidebar navigation

**Route structure**:
```
app/(dashboard)/
  tasks/page.tsx              # everyone
  clients/page.tsx            # admin only
  clients/[id]/page.tsx       # admin only
  projects/page.tsx           # admin only
  projects/[id]/page.tsx      # admin only
  reports/page.tsx            # admin only (placeholder for Phase 2)
  my-time/page.tsx            # everyone (placeholder for Phase 2)
  settings/page.tsx           # admin only
```

**Sidebar nav items**:
```typescript
// Admin sees:
[Tasks, Clients, Projects, Reports, My Time, Settings]

// Member sees:
[Tasks, My Time]
```

**Saved Views section**: Below the main nav, separate group. User-level (each user sees their own). Becomes functional in Phase 5, placeholder for now.

**Role-based display**: Use `<Show when={{ role: 'admin' }}>` Clerk component, OR the Convex `getAuthContext` isAdmin flag on the client side.

### 5. Admin-only route protection

`proxy.ts` already protects all dashboard routes for auth. But admin-only routes (clients, projects, reports, settings) need server-side role checks too.

**Approach**: On every admin-only page:
1. Convex query checks orgRole
2. If member → redirect to /tasks, or 403

### 6. Placeholder pages

Every route needs a basic page that:
- Checks permissions on admin-only routes
- Shows an empty state ("No clients yet" etc.)
- Contains header + breadcrumb

---

## Acceptance criteria

- [ ] `getAuthContext()` works, orgId + role + userId extractable
- [ ] `requireAdmin()` throws if member
- [ ] orgSettings table exists, seed runs if no record
- [ ] orgSettings.get and orgSettings.update work
- [ ] statuses table exists, 8 default seeds run
- [ ] statuses CRUD works (admin only)
- [ ] Sidebar shows Agency Flow nav (admin: 6 items, member: 2 items)
- [ ] Saved Views section placeholder in sidebar
- [ ] Admin-only routes block members
- [ ] Every route has a placeholder page
- [ ] Schema deployed and validated
