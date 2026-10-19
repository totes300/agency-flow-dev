# Agency Flow — Tenant Isolation, Authorization, Financial Auditability & Period-Close Review Specification

## Assignment

Act as a senior staff security engineer, B2B SaaS architect and financial-
systems controls reviewer. Perform a precise, evidence-based, adversarial audit
of Agency Flow's identity, organization isolation, authorization, membership
lifecycle, sensitive-data visibility and financially significant change
history.

Agency Flow will hold multiple agencies' operational and financial data. Each
agency will rely on it for employee and contractor time, internal cost rates,
client bill rates, retainers, worksheets, statements and invoices. A failure in
this area can expose one agency's data to another, reveal confidential labor
costs, allow unauthorized billing changes, or make a client dispute impossible
to reconstruct.

Treat cross-tenant access, privilege escalation, silent financial mutation and
irreversible loss of audit evidence as the highest-severity failures.

This assignment is **review-only**. Do not modify application code, schema,
tests, configuration, authentication providers or production data. You may add
only the requested review deliverables under:

```text
docs/fable-to-review/results/tenant-auth-audit/
```

If proving a finding would require a code change, describe the smallest
deterministic test or experiment instead of implementing it.

## Required repository precautions

Before reviewing:

1. Read the repository-root `AGENTS.md` and `CLAUDE.md` completely.
2. Read `convex/_generated/ai/guidelines.md` completely before reasoning about
   Convex functions, authorization or data access.
3. Before evaluating Next.js routing, middleware or server behavior, read the
   relevant version-matched documentation under `node_modules/next/dist/docs/`.
4. Read Clerk integration documentation already present in the repository and
   inspect the installed package types. Do not assume training-memory behavior.
5. Treat the worktree as shared and potentially dirty.
6. Never run `git stash`, `git reset --hard`, `git checkout --`, `git restore`,
   `git clean` or any destructive Git command.
7. Do not reformat, regenerate or overwrite existing files.
8. Do not send source code, credentials or customer-like seed data to an
   external review service without explicit authorization.
9. Prefer read-only inspection. Use `rg` and `rg --files` for discovery.
10. Record commit hash, branch and `git status --short` in review metadata, but
    do not attempt to clean the worktree.
11. Never print secret environment-variable values. It is acceptable to record
    whether a required variable is configured, never its contents.

## Primary question

Can Agency Flow safely host real, mutually untrusted agencies while ensuring
that every sensitive or financially significant action is authorized,
tenant-isolated, historically stable and reconstructable?

The answer must not be a general security impression. Prove or disprove every
invariant with:

- function-level authorization traces;
- a role-and-resource permission matrix;
- cross-tenant negative tests;
- lifecycle and stale-session scenarios;
- financial state-transition tables;
- audit-event coverage;
- evidence showing what the UI exposes to each role.

## Business outcomes this review must protect

The review must explicitly assess whether the system prevents:

1. Agency A reading, searching, exporting or mutating Agency B's data.
2. A regular member becoming or acting as an admin.
3. A former member retaining access after removal.
4. A user seeing confidential employee cost rates or profitability without
   business authorization.
5. A user editing another person's time without explicit permission.
6. A finalized worksheet, statement or invoice changing without evidence.
7. A closed billing period being reopened or rewritten without attribution.
8. A financial dispute that cannot be reconstructed from stored evidence.
9. An AI action or background process bypassing the permissions of the human
   who initiated it.
10. A public file or export URL leaking private client information.

## Scope priorities

Review in this order:

1. Authentication boundary and Clerk-to-Convex identity mapping.
2. Tenant isolation across every public and externally reachable function.
3. Server-side authorization and role enforcement.
4. Membership creation, update, removal and stale-token behavior.
5. Sensitive financial-data visibility.
6. Time-entry ownership and admin-on-behalf operations.
7. Period close/reopen and invoice lifecycle authorization.
8. Financial audit trail and historical reconstruction.
9. Webhooks, actions, cron jobs, AI tools, file access and exports.
10. Authorization UX, operational monitoring and scalability of controls.

Do not spend meaningful time on generic UI aesthetics, marketing pages,
unrelated task-management polish or speculative infrastructure replacement.

## Trust boundaries and system model

Map and validate this complete chain:

```text
Browser / user session
  -> Next.js route protection (`proxy.ts`)
  -> Clerk session and active organization
  -> Clerk JWT claims (`subject`, `orgId`, `orgRole`)
  -> Convex authentication provider
  -> `getAuthContext` / `requireAdmin`
  -> Convex public query, mutation or action
  -> direct record and referenced-record tenant checks
  -> state change / file / export / AI operation
  -> persistent audit evidence
  -> UI, PDF, worksheet, invoice or API response
```

Also map external and asynchronous paths:

```text
Clerk webhook
  -> signature validation
  -> user or membership upsert/delete
  -> relationship with already-issued sessions

Public action / internal action / cron / AI run
  -> initiating identity
  -> internal query or mutation
  -> effective organization and role
  -> downstream writes

Storage upload / permanent URL / generated export
  -> authorization at creation
  -> authorization at retrieval
  -> lifetime, revocation and tenant boundary
```

Do not treat Next.js route hiding as authorization. The final enforcement must
exist at every server-side data boundary reachable without that UI.

## Current product-role decision

The implemented product currently distinguishes two organization roles:

```text
admin
member
```

Review the security and business correctness of the implemented roles as they
exist. Do not silently invent and implement new roles.

However, the deliverables must include a proposed business permission model
that answers whether the production product eventually needs distinct
capabilities such as finance/billing, project manager, contractor or read-only
client access. Separate:

- what must be fixed before onboarding any real agency;
- what is safe with the current `admin`/`member` model;
- what should be a later product enhancement.

A richer RBAC system is not automatically the correct solution. Prefer the
smallest model that makes confidential data and financial authority explicit.

## Architecture and code inventory

This is a starting inventory, not an allowlist. Follow imports, internal calls,
referenced IDs and UI consumers wherever they cross a trust boundary.

### Authentication and organization membership

- `proxy.ts`
- `lib/route-access.ts`
- `convex/auth.config.ts`
- `convex/http.ts`
- `convex/lib/auth.ts`
- `convex/users.ts`
- `convex/orgMembers.ts`
- `convex/orgSettings.ts`
- root and organization-aware layouts/providers
- sign-in, sign-up, organization-selection and organization-switching UI
- Clerk webhook configuration and environment-variable documentation
- relevant tests, fixtures and identity helpers under `convex/__tests__/`

### Core tenant-owned tables and cross-references

- `convex/schema.ts`
- `convex/clients.ts`
- `convex/clientContacts.ts`
- `convex/projects.ts`
- `convex/tasks.ts`
- `convex/comments.ts`
- `convex/attachments.ts`
- `convex/commentAttachments.ts`
- `convex/timeEntries.ts`
- `convex/timer.ts`
- `convex/workCategories.ts`
- `convex/statuses.ts`
- `convex/projectCategoryEstimates.ts`
- `convex/planner.ts`
- `convex/workday.ts`
- `convex/myTasks.ts`

### Confidential rates and financial records

- `convex/userRates.ts`
- `convex/categoryRates.ts`
- `convex/projectRateOverrides.ts`
- `convex/lib/orgHelpers.ts`
- `convex/projects.ts`
- `convex/timeEntries.ts`
- `convex/retainerPeriods.ts`
- `convex/invoices.ts`
- `convex/statements.ts`
- `convex/worksheets.ts`
- `convex/worksheetsHelpers.ts`
- `convex/timesheets.ts`
- `convex/lib/settleGuards.ts`
- `convex/lib/settleEntries.ts`
- invoice, reporting, project-profitability and settings UI

### Audit-like data and state transitions

- `convex/activityLog.ts`
- the `activityLog`, `retainerPeriods`, `timeEntries`, `invoices`, `agentRuns`
  and `agentProposals` schema definitions
- invoice status transitions and bulk status operations in `convex/invoices.ts`
- close and reopen operations in `convex/retainerPeriods.ts`
- time-entry settlement, lock and unlock paths
- archive, restore, delete, void and bulk-update mutations
- UI that presents actor, timestamp, status history or change history

### External, asynchronous, AI and storage boundaries

- `convex/http.ts`
- `convex/retainerCron.ts`
- `convex/aiIntegration.ts`
- `convex/agentRunner.ts`
- `convex/agentThreads.ts`
- `convex/agentArtifacts.ts`
- `convex/agentProposals.ts`
- `convex/agentAudit.ts`
- `convex/connectors.ts`
- `convex/linkPreviews.ts`
- `convex/attachments.ts`
- storage IDs and generated worksheet/export delivery paths
- secret encryption/decryption code under `convex/lib/secretCrypto.ts`

### Tests and operational configuration

- all auth-, lifecycle-, invoice-, settlement- and worksheet-related tests
- `package.json` scripts
- deployment configuration
- environment-variable examples and documentation
- CSP and response-header configuration, if present
- error reporting, structured logs and monitoring configuration

## Mandatory discovery pass

Before deep review, build a machine-readable or Markdown inventory containing:

1. Every public Convex `query`, `mutation` and `action`.
2. Every Convex HTTP route.
3. Every Next.js API route or server action.
4. Every internal function callable from a public action or HTTP route.
5. Every cron or scheduler entry point.
6. Every table with `orgId` and every tenant-owned table without `orgId`.
7. Every index that begins with `orgId`, and every tenant-sensitive access that
   uses an index without `orgId`.
8. Every mutation that accepts a record ID, user ID or organization-like ID.
9. Every response that exposes cost, revenue, margin, billing address, tax ID,
   email, AI content, connector metadata or storage IDs.
10. Every archive, restore, delete, close, reopen, finalize, void, mark-paid and
    bulk mutation.

For each public entry point record:

| Field | Required content |
|---|---|
| Function | Module and export name |
| Exposure | Query, mutation, action, HTTP, server action or cron |
| Caller identity | How identity is established |
| Required role | Implemented and intended role |
| Tenant source | Trusted JWT org, database record or explicit argument |
| Root record checks | Direct record ownership validation |
| Related-record checks | Validation of every referenced ID |
| Sensitive response/write | What confidential or financial data is touched |
| Audit evidence | Actor, timestamp, before/after and reason retained |
| Negative test | Existing, missing or recommended test |
| Verdict | Pass, fail, unclear or not applicable |

The inventory must be complete enough that an unlisted public function is
treated as a review defect.

## Security and business invariants

Give every invariant an explicit verdict: **Proven**, **Violated**, **Unclear**
or **Not applicable**. Cite exact file/function evidence and a deterministic
test for every non-Proven result.

### A. Authentication and identity

#### A1. No unauthenticated data access

Every non-public resource requires authentication at the actual server data
boundary. Public marketing routes do not imply public application data.

#### A2. Trusted identity source

The effective user, organization and role come only from verified identity or
an authenticated internal call chain. Client arguments may narrow access but
must never grant it.

#### A3. User-record binding

The Clerk subject resolves to exactly one active application user. Deleted,
duplicated, unlinked or partially synchronized user rows cannot create access
under the wrong identity.

#### A4. Organization membership agreement

JWT organization claims and the persisted organization membership must not
silently disagree. Determine whether the database membership is an authority,
cache or display-only record, and prove the behavior for stale claims.

#### A5. Role cannot be client-selected

Changing UI state, request arguments, URLs, cached values or local storage
cannot grant admin behavior.

#### A6. Fail closed

Missing claims, malformed roles, missing users, missing memberships and
provider/configuration failures deny access without leaking tenant existence.

### B. Tenant isolation

#### B1. Root-record isolation

Every read and write verifies that the target root record belongs to the active
organization before returning or mutating it.

#### B2. Related-record isolation

Every foreign-key-like reference belongs to the same organization as the root
record. This includes client/project/task/category/status/user/comment/file/
invoice/period/agent/thread/artifact relationships.

#### B3. Query isolation before materialization

Tenant filters are applied in the database query or index whenever possible,
not only after broad collection. Post-filtering must never create leakage,
excess reads or side channels.

#### B4. Search isolation

Full-text search, autocomplete, counters, previews and recent-item surfaces
cannot reveal names, existence, snippets or counts from another organization.

#### B5. Aggregation isolation

Dashboards, reports, metrics, invoice readiness, retainer calculations and AI
contexts cannot include rows from another organization even when referenced
IDs are malformed or legacy data is inconsistent.

#### B6. Export isolation

PDFs, worksheets, CSV/data exports and generated documents contain only the
active organization's authorized records.

#### B7. Storage isolation

Upload, attachment, logo and generated-file retrieval cannot be used to access
another tenant's private object merely by knowing or guessing its storage ID.

#### B8. Error indistinguishability

Unauthorized cross-tenant IDs should generally behave like nonexistent IDs.
Errors must not reveal customer names, emails, amounts, record types or tenant
existence.

### C. Authorization and confidential-data visibility

#### C1. Server-side admin enforcement

Every admin-only capability calls a server-side authorization guard. Route
redirects, hidden buttons and disabled controls are defense-in-depth only.

#### C2. Least privilege for members

Members can perform only the work needed for daily collaboration and their own
time tracking. Establish the actual current boundary rather than assuming it.

#### C3. Cost-rate confidentiality

Per-person cost rates, entry cost snapshots, labor cost, gross margin and
profitability are available only to roles explicitly authorized by the
business model. Check both direct APIs and indirect calculations.

#### C4. Bill-rate and billing-configuration authority

Only authorized users can change category bill rates, project overrides,
retainer fees, overage rates, fixed prices, invoice settings and client billing
identity.

#### C5. Time-entry ownership

A member can create, edit and delete only permitted time entries. Admin-on-
behalf operations must use explicit admin authority, preserve the entry owner
and attribute the acting admin.

#### C6. Project visibility

Determine whether organization membership grants access to every project or
whether `teamMembers` is intended as an authorization boundary. Ensure backend
behavior, UI language and business expectation agree.

#### C7. Bulk-operation equivalence

Bulk operations enforce the same authorization, tenant and state guards as the
equivalent single-record operation for every row, including partial failure.

#### C8. Archived and deleted records

Archive, restore and delete operations cannot bypass permissions or silently
destroy financial evidence. Soft-deleted users remain resolvable for history
without retaining live access.

### D. Membership lifecycle and session revocation

#### D1. Webhook authenticity

Clerk webhook signatures, timestamps and required headers are validated.
Malformed or unsigned requests cannot create users or memberships.

#### D2. Webhook replay and idempotency

Duplicate, retried or out-of-order user/membership webhooks converge to the
correct state without privilege resurrection or duplicate identity rows.

#### D3. Removal takes effect

After membership deletion, the user cannot access the organization through a
still-valid browser session, cached token, Convex connection, action or direct
API call beyond the explicitly accepted revocation window.

#### D4. Role downgrade takes effect

Admin-to-member downgrade revokes admin operations predictably, including
already-open tabs and in-flight actions.

#### D5. Organization switching is isolated

Rapid switching between organizations cannot display or mutate stale data from
the previous organization. Subscriptions, query caches, timers, modal state and
exports must rebind safely.

#### D6. Partial synchronization is safe

User-created-before-membership, membership-created-before-user, deleted-user,
and webhook-failure states fail safely and are recoverable.

#### D7. Last-admin safety

Determine how the system prevents an organization from accidentally losing all
administrative control, or document the recovery process if Clerk owns it.

### E. Financial lifecycle and period close

#### E1. Explicit state machines

Document and prove allowed transitions for:

- time entry: open/editable -> settled/locked -> reopened if allowed;
- retainer period: open -> closed -> reopened;
- invoice: draft -> invoiced -> paid/void and permitted reversals;
- worksheet/report artifacts: draft/generated/final if applicable.

No mutation may create an undocumented transition.

#### E2. Authorization of transitions

Only the intended role can close/reopen periods, create/finalize/void invoices,
mark payments, alter invoice lines or regenerate client-facing documents.

#### E3. Locked means immutable

Every mutation path — single, bulk, timer autosave, task archive, migration-like
helper and AI proposal — honors settled/invoiced/closed locks.

#### E4. Atomic close/finalize

A close or finalize operation cannot leave a partially transitioned period,
invoice, entry set or sequence number. Analyze Convex transaction boundaries,
action-to-mutation boundaries, retries and OCC behavior.

#### E5. Reopen and reversal integrity

Reopening or reversing clears only the intended locks, preserves historical
evidence, respects overlapping invoices and cannot make issued documents
silently disagree with live data.

#### E6. Issued-invoice stability

Issued and paid invoices cannot be edited or hard-deleted. Voids retain their
identifier and historical values. Any correction workflow is explicit.

#### E7. Worksheet and statement stability

Determine whether generated client-facing worksheets/statements are live views
or immutable artifacts. The UI must not present a live recomputation as a
historically fixed document.

#### E8. Concurrent-transition safety

Two admins, bulk actions, retries and background jobs cannot double-finalize,
double-number, double-settle or reopen around a competing invoice transition.

### F. Auditability and dispute reconstruction

#### F1. Actor attribution

Every financially significant mutation records the effective actor. When an
admin acts for another user, store both the subject/owner and acting actor.

#### F2. Event timestamp

Events store a trustworthy server timestamp distinct from business dates such
as entry date, invoice issue date or report month.

#### F3. Before-and-after evidence

For fields whose change can alter billing, cost, margin, settlement or client
documents, retain enough evidence to reconstruct the prior and resulting
states. A single `updatedAt` is not sufficient.

#### F4. Action and reason

The trail distinguishes create, edit, delete, archive, restore, bulk edit,
close, reopen, finalize, mark paid, undo payment and void. Destructive or
exceptional reversals should support a reason where operationally appropriate.

#### F5. Audit immutability

Ordinary application users and admins cannot edit or delete audit evidence
through public APIs. Retention behavior is documented.

#### F6. Snapshot linkage

An issued invoice or finalized artifact can be linked to the exact entry set,
rates, configuration and generated content it represented.

#### F7. Human-readable reconstruction

For a disputed invoice, a reviewer can answer who changed what and when,
whether entries were subsequently altered, and why a total changed without
querying raw production tables manually.

#### F8. Bulk-action detail

Bulk audit events retain row-level success/failure and prior state rather than
an unactionable single event saying only that a bulk action occurred.

#### F9. Failed-attempt visibility

Define which denied or failed high-risk operations should be observable to
operators without logging sensitive payloads.

### G. Actions, AI, integrations and background jobs

#### G1. Caller authority propagation

A public action must authorize the human caller before invoking internal
functions. Internal functions cannot become an authority bypass simply because
they are internal.

#### G2. AI least privilege

AI context contains only data the initiating user may access. AI tools and
proposal approval cannot write outside that user's organization or authority.

#### G3. Proposal revalidation

Approving an old AI proposal revalidates current tenant, permissions, target
existence and business-state locks rather than trusting creation-time checks.

#### G4. Cron isolation

Scheduled jobs process organizations independently. A malformed tenant's data
cannot cause writes into another tenant or prevent all other organizations
from progressing.

#### G5. Connector isolation

Credentials and connector records are scoped by organization and user as
designed. Decrypted secrets never reach unauthorized clients or logs.

#### G6. Secret handling

API keys are encrypted at rest where required, masked in responses, never
logged, and removable. Key-rotation and missing-key failures are safe.

#### G7. SSRF and external fetches

Any server-side URL fetch validates schemes, redirects, DNS/address targets,
size, timeouts and response type. Authorization to trigger a fetch is explicit.

### H. Files, exports and browser-facing controls

#### H1. Upload authorization

Upload URLs are issued only to authenticated users with permission for the
intended owning resource.

#### H2. Retrieval authorization

Knowing a storage identifier alone must not grant access to confidential client
content unless the product explicitly classifies that object as public.

#### H3. Public-object classification

For intentionally public permanent image URLs, document the classification,
business justification, enumeration risk, cache lifetime, deletion/revocation
behavior and whether client-confidential images are allowed.

#### H4. Safe content handling

Uploads, rich text, filenames, invoice messages and exports cannot introduce
stored XSS, content-type confusion or active document content.

#### H5. Export authorization at generation time

Every worksheet/PDF/export action performs current authorization and does not
rely only on a prior UI query.

#### H6. Browser cache and organization switch

Sensitive pages and downloaded/generated responses do not leak through shared
browser caching, stale React state or organization switching.

### I. Operational controls and scalability

#### I1. Security-relevant observability

Operators can detect repeated authorization failures, webhook failures,
membership-sync lag, high-risk financial transitions and export failures.

#### I2. No secret or PII logging

Logs exclude raw secrets, tokens, sensitive webhook bodies, confidential file
contents and unnecessary personal or financial data.

#### I3. Bounded authorization reads

Authorization and tenant checks use suitable indexes and do not collect entire
tables. The security model remains reliable at production tenant counts.

#### I4. Bounded audit reads

Audit history is indexed, paginated and retainable without making normal writes
or investigations unbounded.

#### I5. Recovery procedures

Document how operators recover from webhook outage, broken membership sync,
accidental role loss, corrupted cross-reference and disputed financial change.

#### I6. Backfill safety

Any proposed audit-table or authorization migration includes a safe rollout,
legacy-row policy and verification plan. Do not silently assign tenant or actor
identity when it cannot be proven.

## Required role-and-permission matrix

Produce the implemented matrix and a recommended production matrix. At minimum
include these resources/actions:

| Resource/action | Member | Admin | Confidential? | Current enforcement | Recommended |
|---|---:|---:|---:|---|---|
| View organization members | | | | | |
| Invite/remove/change role | | | | | |
| View all projects | | | | | |
| View project team only | | | | | |
| Create/edit/archive project | | | | | |
| Track own time | | | | | |
| View another person's time | | | | | |
| Edit/delete another person's time | | | | | |
| View user cost rates | | | Yes | | |
| View entry cost and profit | | | Yes | | |
| Edit cost rates | | | Yes | | |
| Edit bill rates | | | Yes | | |
| Edit retainer/fixed-price terms | | | Yes | | |
| Close/reopen a billing period | | | Yes | | |
| Create/edit/finalize invoice | | | Yes | | |
| Mark paid/undo/void | | | Yes | | |
| Generate/export worksheet | | | Potentially | | |
| Configure AI key/connectors | | | Yes | | |
| View AI audit records | | | Potentially | | |
| View security/financial audit history | | | Yes | | |

For every mismatch between current behavior and recommended behavior, state
whether it is a production blocker, near-term hardening or later enhancement.

## Required cross-tenant adversarial matrix

Create two organizations with distinct admins, members and recognizable test
records. Use synthetic values only.

```text
ORG_A: admin_A, member_A, client_A, project_A, task_A, entry_A, invoice_A
ORG_B: admin_B, member_B, client_B, project_B, task_B, entry_B, invoice_B
```

For every public ID-taking function, attempt at least:

1. `admin_A` with an ORG_B record ID.
2. `member_A` with an ORG_B record ID.
3. `member_A` with an ORG_A admin-only record/action.
4. Unauthenticated caller with an ORG_A ID.
5. Valid ORG_A root ID combined with an ORG_B related ID.
6. Archived/deleted ORG_A user or resource.
7. Malformed but type-valid input where possible.

Cover reads and writes independently. A safe failed write does not prove a safe
read, and returning an empty UI does not prove the underlying API is safe.

At minimum include attacks against:

- client and client contact;
- project and project team member;
- task, subtask, status and work category;
- comment, reaction and attachment;
- timer and time entry owner/task combination;
- user/category/project rates;
- retainer period close/reopen;
- invoice query, edit, line mutation, transition and delete;
- worksheet/export actions;
- agent/thread/artifact/proposal APIs;
- notification and planning records;
- storage retrieval.

Record actual result, expected result, error class, information disclosed and
whether the database changed.

## Mandatory membership and stale-session scenarios

Exercise or specify deterministic tests for:

1. User created before organization membership webhook.
2. Membership created before user webhook.
3. Duplicate membership-created webhook.
4. Membership update arriving before create.
5. Membership delete followed by delayed update/create replay.
6. User deletion while memberships remain.
7. Membership removal while an application tab and Convex subscription remain
   open.
8. Admin downgrade while the admin settings or invoice editor is open.
9. User switching ORG_A -> ORG_B while ORG_A queries are in flight.
10. User switching organizations with a running timer.
11. Same person belonging to two organizations with different roles.
12. Missing `orgId`, unknown `orgRole` and missing local user record.
13. Clerk outage or webhook secret misconfiguration.
14. Reconciliation after webhook delivery resumes.

For revocation, measure and document the actual window rather than saying
access is revoked “eventually.”

## Mandatory financial transition review

Build an executable or table-driven transition matrix for each lifecycle.

### Invoice transitions

Verify all single and bulk paths for:

```text
draft -> invoiced
draft -> void
invoiced -> paid
invoiced -> draft
invoiced -> void
paid -> invoiced
all rejected transitions
void -> terminal
```

For each transition prove:

- role and tenant guard;
- required preconditions;
- number allocation behavior;
- time-entry settlement behavior;
- retained actor/timestamp/history;
- idempotency and concurrent-call behavior;
- document stability;
- allowed correction path.

### Retainer period and cycle transitions

Verify:

- close one period;
- reopen one period;
- close an entire rollover cycle;
- partial pre-closed cycle behavior;
- close around draft/invoiced/paid/void invoices;
- reopen around overlapping invoices;
- two admins closing concurrently;
- close or reopen through a cross-tenant ID;
- actor attribution and historical evidence after reopen.

### Time-entry lock transitions

Verify every writer against:

- open entry;
- period-closed entry;
- invoiced entry;
- voided/reopened invoice relationship;
- bulk billable update;
- task archive timer autosave;
- admin-on-behalf edit/delete;
- AI or internal mutation if capable of touching time.

## Mandatory audit-coverage ledger

Create a ledger of every financially significant event:

| Event | Current actor | Current time | Before/after | Reason | Immutable | Reconstructable | Verdict |
|---|---|---|---|---|---|---|---|
| Create/edit/delete time entry | | | | | | | |
| Admin edits another user's entry | | | | | | | |
| Upsert/remove user cost rate | | | | | | | |
| Upsert/remove category bill rate | | | | | | | |
| Upsert/remove project override | | | | | | | |
| Change client currency | | | | | | | |
| Change project billing terms | | | | | | | |
| Close/reopen retainer period | | | | | | | |
| Close rollover cycle | | | | | | | |
| Create/refresh/delete draft invoice | | | | | | | |
| Finalize invoice | | | | | | | |
| Edit invoice line/message/rounding | | | | | | | |
| Mark paid/undo paid/void | | | | | | | |
| Generate/regenerate worksheet | | | | | | | |
| Membership add/remove/role change | | | | | | | |
| Configure/remove AI key/connector | | | | | | | |
| Approve AI proposal | | | | | | | |

Do not equate `createdBy`, `updatedAt`, a task activity stream or current row
state with a complete financial audit trail. Determine what evidence actually
survives multiple edits and reversals.

## Authorization UI/UX review

This is not a visual-polish exercise. Review whether the product communicates
authority, confidentiality and irreversible consequences accurately.

Inspect at minimum:

1. Organization switching.
2. Team member list and roles.
3. Admin-only Settings navigation.
4. User cost-rate settings.
5. Project rates and retainer settings.
6. Editing another user's time.
7. Period close and reopen controls.
8. Invoice finalize, mark-paid, undo and void controls.
9. Worksheet generation/export.
10. Audit/history surfaces, if present.

Evaluate:

- Does the UI clearly distinguish cost rate from client bill rate?
- Is confidential profitability hidden from members both visually and at the
  API boundary?
- Does acting for another person show whose record will change and who performs
  the action?
- Do close/finalize/void dialogs explain what becomes locked and what remains
  editable?
- Does a reopen action explain downstream document consequences?
- Are forbidden controls absent, rather than merely failing after submission?
- Does the UI recover safely from role downgrade or organization switch?
- Is there an understandable history for financial disputes?
- Are errors actionable without leaking resource existence?

Capture screenshots or route/component references for important mismatches.
Do not recommend UI changes without the matching server-side rule.

## Static-analysis method

The reviewer must perform all of these passes:

### Pass 1 — Entry-point census

Enumerate public queries, mutations, actions, HTTP routes, API routes, server
actions, crons and externally invoked internal functions.

### Pass 2 — Guard classification

Classify each entry point as:

```text
unauthenticated-intentional
authenticated-any-member
admin-only
owner-or-admin
resource-team-member
internal-system
unclear
```

### Pass 3 — ID provenance

For every argument containing an ID, trace:

```text
argument
  -> record fetch
  -> org ownership check
  -> related-record check
  -> authorization decision
  -> read/write/output
```

Flag authorization that happens after sensitive values have already been
loaded into an external action, log, error or response.

### Pass 4 — Response-field review

Trace sensitive fields to every frontend consumer and export. Include derived
fields even if raw rates are omitted; profitability can leak through totals.

### Pass 5 — Lifecycle mutation review

Trace every mutation of settled, closed, issued, paid and void states. Compare
single, bulk and background paths.

### Pass 6 — Audit evidence review

For each financial event, determine exactly which persisted rows survive and
whether an investigator can reconstruct the previous state.

### Pass 7 — Scale review

Identify `.collect()`, broad scans, unbounded joins and audit queries whose
costs grow across a tenant or the whole database. Prioritize cases where scale
pressure might tempt future developers to weaken security checks.

## Dynamic and test review

Run existing read-only checks that are safe in the local environment and record
exact commands and results. At minimum consider:

- TypeScript typecheck;
- unit/integration tests;
- linting scoped to relevant files;
- Convex test identities for two organizations;
- targeted negative tests for authorization and lifecycle transitions.

Do not claim coverage from a green suite unless the suite actually contains
negative tenant and role tests. Report pre-existing failures separately from
review findings.

Recommended test architecture:

```text
fixture: orgA + orgB
identities: unauthenticated, adminA, memberA, adminB, removedA
resources: one complete financial chain per org
table-driven calls: each public function x adversarial identity/input
assertions: response/error + no unauthorized database change
```

For actions and exports, verify both the public action authorization and every
internal function's argument/tenant assumptions.

## Required hypotheses to prove or disprove

Treat these only as leads, not established findings:

### H1. JWT membership drift

`getAuthContext` appears to derive `orgId` and admin status from verified Clerk
JWT claims while a separate `orgMembers` table is maintained by webhooks.
Determine whether a removed or downgraded member can retain access with stale
claims and whether membership-table disagreement is detected.

### H2. Related-ID tenant gaps

Several tables have indexes such as `by_clientId`, `by_projectId` or other
non-org-leading indexes. Determine whether every caller validates the parent
and every referenced child before use.

### H3. Financial audit trail is incomplete

Task activity history and timestamps may exist without immutable before/after
events for rate, time, retainer and invoice changes. Prove what a billing
dispute can and cannot reconstruct.

### H4. Admin-on-behalf attribution gap

Time entries store an owner and may store creation/update metadata, but the
review must prove whether an admin editing another user's time leaves durable
evidence of both parties and the previous values.

### H5. Public permanent image URLs

`convex/http.ts` intentionally serves storage content through an unauthenticated
permanent `/image?id=...` route with public immutable caching. Determine whether
the business classification, upload paths and revocation behavior make this
acceptable for potentially confidential client content.

### H6. Webhook ordering and replay

User and organization-membership webhooks may arrive multiple times or out of
order. Prove convergence, role downgrade/deletion behavior and recovery after
delivery failures.

### H7. Bulk/single guard divergence

Bulk invoice, time-entry or planning operations may not enforce exactly the
same per-row checks and audit evidence as their single-record equivalents.

### H8. Live documents presented as fixed history

Some worksheets or statements may recompute from live rows rather than retain
an immutable generated snapshot. Determine whether UI language and dispute
expectations match actual behavior.

### H9. AI/internal authority widening

AI actions and internal calls may carry explicit org/user IDs after an initial
auth step. Prove that stale proposals, tampered arguments or call-chain changes
cannot widen authority.

### H10. Project team semantics are ambiguous

Projects contain team-member data, but organization membership may grant broad
read access. Determine whether project team is assignment metadata or an access
control boundary, then align code, tests and UI language.

## Severity model

### Critical

- Cross-tenant read or write of customer, financial, credential or private
  content.
- Authentication bypass or member-to-admin privilege escalation.
- Public retrieval of confidential documents at practical scale.
- Unauthorized invoice finalization, payment marking, voiding or period close.
- Secret/key disclosure.

### High

- Former member retains meaningful access beyond the accepted revocation
  window.
- Confidential cost/profit data exposed to an unintended role.
- Issued financial records can be changed or destroyed without evidence.
- Related-record tenant mismatch causes incorrect billing or export content.
- High-impact state transition is non-atomic or concurrency-unsafe.
- Financial changes cannot be attributed or reconstructed.

### Medium

- Excess privilege without demonstrated financial or cross-tenant impact.
- Important audit metadata missing where current state remains recoverable.
- Error or count leaks record existence without sensitive content.
- Security-relevant operation lacks adequate monitoring.
- Authorization check is correct but unbounded at realistic scale.

### Low

- Defense-in-depth gap with a strong primary control.
- Misleading authorization UX without a server-side bypass.
- Documentation or operational-runbook deficiency.

Do not lower severity because exploitation requires knowing a Convex document
ID. Treat IDs as identifiers, not authorization secrets.

## Finding format

Every finding must include:

```text
ID: AUTH-001
Title:
Severity:
Confidence: High / Medium / Low
Status: Proven / Strongly supported / Needs runtime proof
Affected invariant(s):
Business impact:
Threat actor / precondition:
Exact code path:
Current behavior:
Expected behavior:
Minimal reproduction:
Evidence:
Why existing guards/tests do not prevent it:
Smallest safe remediation direction:
Regression-test specification:
Rollout or migration concern:
```

For cross-tenant findings, name both the attacker identity and victim resource
in the reproduction. For audit findings, show a concrete dispute that cannot be
answered. Avoid vague recommendations such as “add authorization everywhere.”

## Required deliverables

Create all deliverables under
`docs/fable-to-review/results/tenant-auth-audit/`.

### 1. `EXECUTIVE-SUMMARY.md`

Maximum roughly 1,500 words. Answer:

- Is it safe to onboard unrelated real agencies today?
- Can members access only the intended data?
- Are cost rates and profitability confidential?
- Does membership removal revoke access reliably?
- Can issued billing records be trusted as historical evidence?
- Can a client dispute be reconstructed?
- What are the top five production blockers?
- What is the recommended remediation sequence?

Include separate verdicts:

```text
Tenant isolation: GO / CONDITIONAL GO / NO-GO
Authorization: GO / CONDITIONAL GO / NO-GO
Membership lifecycle: GO / CONDITIONAL GO / NO-GO
Financial auditability: GO / CONDITIONAL GO / NO-GO
Period close and invoice controls: GO / CONDITIONAL GO / NO-GO
```

### 2. `ENTRY-POINT-AUTH-MATRIX.md`

The complete public entry-point inventory with guard, tenant source, sensitive
data, related-ID validation, audit evidence and negative-test coverage.

### 3. `ROLE-PERMISSION-MATRIX.md`

Current implemented permissions, intended business permissions, mismatches and
the smallest recommended production model.

### 4. `TENANT-ATTACK-MATRIX.md`

Results or deterministic specifications for the two-organization adversarial
matrix. Include read, write, search, aggregation, export, storage and error-
disclosure behavior.

### 5. `MEMBERSHIP-LIFECYCLE.md`

Clerk/Convex sequence diagrams and verdicts for create, update, downgrade,
delete, stale session, organization switch, webhook retry and reconciliation.
State the measured or expected revocation window.

### 6. `FINANCIAL-STATE-MACHINES.md`

Invoice, period/cycle and time-entry-lock transition tables including role,
tenant, precondition, atomicity, audit evidence and concurrency behavior.

### 7. `AUDIT-COVERAGE-LEDGER.md`

The mandatory event ledger plus two worked dispute reconstructions:

1. an admin changes a person's time after client review;
2. an issued invoice total or underlying worksheet is challenged later.

Show which questions the current data can answer and which it cannot.

### 8. `SENSITIVE-DATA-FLOW.md`

Trace cost rates, profitability, billing identity, tax details, AI keys,
connector credentials, private attachments and exports from storage through
APIs to UI/log/output. Identify authorized audiences.

### 9. `FINDINGS.md`

All findings in required format, ordered by severity and then business impact.
Clearly separate proven defects, design decisions and future hardening.

### 10. `TEST-PLAN.md`

Exact automated regression tests to add, including fixture setup, identity,
function call, expected error/result and no-write assertions. Prioritize a
reusable authorization test harness rather than one-off tests.

### 11. `REMEDIATION-ROADMAP.md`

Group work into:

```text
P0 — before any real agency is onboarded
P1 — before billing is treated as authoritative
P2 — operational hardening after controlled launch
Later — justified product evolution
```

Include dependencies, migration/backfill needs, rollout risk and verification
gate for every item. Do not implement fixes.

### 12. `REVIEW-METADATA.md`

Record commit, branch, dirty-worktree status, relevant package versions,
commands run, test results, skipped checks, environmental limitations and files
reviewed.

## Completion criteria

The review is complete only when:

- every public/external entry point is inventoried;
- every ID-taking function has root and related-record tenant checks traced;
- every sensitive response field has an authorized audience;
- two-organization negative tests cover all critical resource families;
- member/admin/removed-user behavior is tested independently;
- webhook ordering, role downgrade and stale-session behavior are resolved;
- current and recommended permission matrices are explicit;
- invoice, retainer-period and entry-lock state machines are proven;
- single and bulk transition paths are compared;
- every financially significant event has an audit-coverage verdict;
- at least two real dispute scenarios are reconstructed;
- files, exports, AI, connectors, actions and cron paths are included;
- scalability of auth/audit queries is assessed;
- every invariant has a verdict;
- every Critical/High finding has deterministic reproduction steps;
- P0 blockers have regression-test specifications and rollout gates;
- no application code or production data was modified.

## Review quality bar

An acceptable result is not:

- “Most functions call `getAuthContext`, so tenancy looks good.”
- “Clerk handles security.”
- “Document IDs are hard to guess.”
- “The buttons are hidden for members.”
- “Invoices have statuses, so they are auditable.”
- “There is an activity log.”
- a generic OWASP checklist without application-specific traces;
- a list of theoretical issues without deterministic tests.

An acceptable result demonstrates, with code and tests, which identity controls
each operation, how every related record stays inside one tenant, what survives
financial changes, how revocation behaves, and whether the application can
defend its billing history during a real customer dispute.
