import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  activityLogValidator,
  activityViaValidator,
  numberScopeValidator,
  taskCategoryValidator,
  taskPriorityValidator,
  taskViewSpecValidator,
  taskViewSurfaceValidator,
} from "./tasks/model";
import { mcpWriteResultValidator } from "./lib/mcpWriteResults";
import { billingActionValidator, billingCommitResultValidator, billingParamsValidator } from "./lib/mcpBillingResults";

export default defineSchema({
  // ─── Users (synced from Clerk) ─────────────────────────────────────────────
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    externalId: v.string(),
    deletedAt: v.optional(v.number()),
    // Timer state (server-side, survives browser close)
    timerTaskId: v.optional(v.id("tasks")),
    timerStartedAt: v.optional(v.number()),
    timerAccumulatedMs: v.optional(v.number()),
    timerStatus: v.optional(v.union(v.literal("running"), v.literal("paused"))),
    // Tasks refactor (docs/prd-tasks-refactor.md §4.4). Unset = drawer.
    taskDetailMode: v.optional(v.union(v.literal("drawer"), v.literal("page"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("byExternalId", ["externalId"]),

  // ─── Org Members (synced from Clerk org memberships) ──────────────────────
  orgMembers: defineTable({
    orgId: v.string(),
    clerkUserId: v.string(),
    userId: v.optional(v.id("users")),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
    // Per-member default billing category. Resolved at entry creation via the
    // member-first chain in resolveEntryCategory (explicit ?? member default ??
    // task category). Optional: a member without a default gets the task's
    // category, i.e. pre-feature behavior.
    defaultWorkCategoryId: v.optional(v.id("workCategories")),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_clerkUserId", ["orgId", "clerkUserId"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_userId", ["userId"]),

  // ─── Org Settings (one per org) ────────────────────────────────────────────
  orgSettings: defineTable({
    orgId: v.string(),
    defaultCurrency: v.string(),
    timezone: v.string(),
    roundingMinutes: v.number(),
    // Branding (used in later phases, define fields now)
    brandName: v.optional(v.string()),
    brandLogoStorageId: v.optional(v.id("_storage")),
    brandAddress: v.optional(v.string()),
    brandTaxId: v.optional(v.string()),
    brandEmail: v.optional(v.string()),
    brandPhone: v.optional(v.string()),
    // Invoicing
    nextInvoiceNumber: v.optional(v.number()),
    invoicePrefix: v.optional(v.string()),
    defaultPaymentTermsDays: v.optional(v.number()),
    paymentInstructions: v.optional(v.string()),
    invoiceMessageTemplate: v.optional(v.string()),
    // AI integration — BYOK Anthropic key (Phase 9). Ciphertext is
    // AES-GCM-encrypted with `AI_KEY_ENCRYPTION_KEK` env var; see
    // `convex/lib/secretCrypto.ts`. The mask (e.g. `sk-ant-a…wxyz`) is
    // the only piece safe to send to the client — orgSettings.get must
    // strip the ciphertext before returning.
    //
    // The ciphertext carries a version prefix (`v1:` etc.) so we can change
    // the cipher / KDF later without ambiguity. Removed-key audit fields
    // persist across re-adds so we always know who last removed a key.
    aiAnthropicKeyCiphertext: v.optional(v.string()),
    aiAnthropicKeyMask: v.optional(v.string()),
    aiKeyConfiguredAt: v.optional(v.number()),
    aiKeyConfiguredBy: v.optional(v.id("users")),
    aiKeyRemovedAt: v.optional(v.number()),
    aiKeyRemovedBy: v.optional(v.id("users")),
    // Tasks refactor §4.2 (D2): identifier key + counter for tasks without a
    // project (`KON-7`). Incremented in the mutation that creates/moves the task.
    taskKey: v.optional(v.string()),
    nextTaskNumber: v.optional(v.number()),
    // Base
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_orgId", ["orgId"]),

  // ─── Task Statuses (per org) ───────────────────────────────────────────────
  // Tasks refactor §4.1 (D3): org-defined statuses inside 5 fixed categories
  // (convex/tasks/model.ts); the icon is derived from category + position.
  // Settings: convex/statuses.ts (category immutable once used, one default
  // per category, every category keeps an active status).
  statuses: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    category: taskCategoryValidator,
    position: v.string(),                     // fractional key, order within category
    isDefault: v.boolean(),                   // exactly one per category
    archivedAt: v.optional(v.number()),
    // Base
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_category_position", ["orgId", "category", "position"]),

  // ─── Tasks ───────────────────────────────────────────────────────────────────
  // Tasks refactor §4.2. Written only by convex/tasks/write.ts (T2); read
  // through convex/tasks/read.ts (bounded, T7) with access from access.ts (T1).
  tasks: defineTable({
    orgId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),      // TipTap JSON string
    hasDescription: v.boolean(),
    identifier: v.string(),                   // "ARLO-21"; unique per org (T5)
    numberScope: numberScopeValidator,
    number: v.number(),
    statusId: v.id("statuses"),
    statusCategory: taskCategoryValidator,    // == statuses[statusId].category (T3)
    priority: taskPriorityValidator,          // D7
    projectId: v.optional(v.id("projects")),
    clientId: v.optional(v.id("clients")),    // denormalized from project
    workCategoryId: v.optional(v.id("workCategories")),
    billable: v.boolean(),
    startDate: v.optional(v.string()),        // YYYY-MM-DD
    dueDate: v.optional(v.string()),          // YYYY-MM-DD
    estimateMinutes: v.optional(v.number()),
    parentTaskId: v.optional(v.id("tasks")),
    sortKey: v.string(),                      // fractional; one global manual order
    assigneeIds: v.array(v.id("users")),      // READ CACHE of taskAssignees
    labelIds: v.array(v.id("labels")),        // READ CACHE of taskLabels
    // Derived, maintained by the write module (§5.5).
    trackedMinutes: v.number(),
    commentCount: v.number(),
    lastCommentAt: v.optional(v.number()),
    subtaskCount: v.number(),
    subtaskDoneCount: v.number(),
    lastActivityAt: v.number(),
    lastActivity: v.optional(
      v.object({ kind: v.string(), actorId: v.id("users"), at: v.number() }),
    ),
    completedAt: v.optional(v.number()),      // set iff statusCategory is closed (T4)
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_sortKey", ["orgId", "sortKey"])
    .index("by_orgId_statusId", ["orgId", "statusId"])
    .index("by_orgId_projectId", ["orgId", "projectId"])
    .index("by_orgId_parentTaskId", ["orgId", "parentTaskId"])
    .index("by_orgId_statusCategory_sortKey", ["orgId", "statusCategory", "sortKey"])
    .index("by_orgId_projectId_statusCategory", ["orgId", "projectId", "statusCategory"])
    .index("by_orgId_identifier", ["orgId", "identifier"])
    .index("by_orgId_completedAt", ["orgId", "completedAt"])
    .index("by_orgId_createdBy", ["orgId", "createdBy"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["orgId", "statusCategory"],
    }),

  // ─── Task edges (§4.2) — written only by tasks/write.ts (T2) ─────────────
  // Source of truth for assignees (D1); `tasks.assigneeIds` is a read cache.
  taskAssignees: defineTable({
    orgId: v.string(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    assignedAt: v.number(),
    assignedBy: v.id("users"),
  })
    .index("by_orgId_userId_taskId", ["orgId", "userId", "taskId"])
    .index("by_taskId_userId", ["taskId", "userId"]),

  taskLabels: defineTable({
    orgId: v.string(),
    taskId: v.id("tasks"),
    labelId: v.id("labels"),
  })
    .index("by_orgId_labelId", ["orgId", "labelId"])
    .index("by_taskId_labelId", ["taskId", "labelId"]),

  // Org-level, multi-value, non-billing (D8).
  labels: defineTable({
    orgId: v.string(),
    name: v.string(),
    color: v.string(),
    archivedAt: v.optional(v.number()),
    position: v.string(),                     // fractional key
  }).index("by_orgId_position", ["orgId", "position"]),

  // Old identifiers keep resolving after a project move or code rename (T5).
  taskIdentifierAliases: defineTable({
    orgId: v.string(),
    identifier: v.string(),
    taskId: v.id("tasks"),
  })
    .index("by_orgId_identifier", ["orgId", "identifier"])
    .index("by_taskId", ["taskId"]),

  // External source refs on tasks (docs/prd-mcp.md D21), e.g. `gmail:<thread>`.
  // A ref belongs to at most one task per org (checked on every insert, never
  // moved); a task carries many. Written by convex/lib/mcpExternalRefs.ts,
  // removed with the task (tasks/write.ts deleteTaskRecord).
  taskExternalRefs: defineTable({
    orgId: v.string(),
    ref: v.string(),
    taskId: v.id("tasks"),
    createdAt: v.number(),
  })
    .index("by_orgId_ref", ["orgId", "ref"])
    .index("by_taskId", ["taskId"]),

  // ─── Per-user task state (§4.3) — fan-out on write ─────────────────────────
  // Unread comments, the unseen-update dot, subscription and the mute; comment
  // read receipts stay for the activity feed's "new since" divider.
  taskUserState: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    taskId: v.id("tasks"),
    lastViewedAt: v.number(),
    unreadComments: v.number(),
    hasUnseenChanges: v.boolean(),
    subscribed: v.boolean(),
    muted: v.boolean(),
  })
    .index("by_orgId_userId_unreadComments", ["orgId", "userId", "unreadComments"])
    .index("by_taskId_userId", ["taskId", "userId"]),

  // ─── Saved task views (§4.4) ───────────────────────────────────────────────
  // ownerId absent = workspace view (admin-managed). System views are code
  // constants; `viewDefaults` stores "Set default for everyone" overrides.
  taskViews: defineTable({
    orgId: v.string(),
    ownerId: v.optional(v.id("users")),
    surface: taskViewSurfaceValidator,
    name: v.string(),
    position: v.string(),                     // fractional key
    spec: taskViewSpecValidator,
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId_surface_position", ["orgId", "surface", "position"])
    .index("by_orgId_ownerId_surface", ["orgId", "ownerId", "surface"]),

  viewDefaults: defineTable({
    orgId: v.string(),
    surface: taskViewSurfaceValidator,
    systemViewKey: v.string(),
    spec: taskViewSpecValidator,
  }).index("by_orgId_surface_systemViewKey", ["orgId", "surface", "systemViewKey"]),

  // ─── Clients ──────────────────────────────────────────────────────────────────
  clients: defineTable({
    orgId: v.string(),
    name: v.string(),
    currency: v.string(),
    /** Client abbreviation shown in task lists when usePrefix=true (e.g. "KONV"). */
    prefix: v.optional(v.string()),
    /** When true, task lists show the prefix instead of the full client name. */
    usePrefix: v.optional(v.boolean()),
    /** @deprecated Use `prefix` instead. Kept temporarily for migration. */
    invoicePrefix: v.optional(v.string()),
    // Billing (structured for PDF invoices)
    billingName: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingCountry: v.optional(v.string()),
    billingCity: v.optional(v.string()),
    billingZip: v.optional(v.string()),
    billingStreet: v.optional(v.string()),
    billingStreet2: v.optional(v.string()),
    taxId: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_name", ["orgId", "name"]),

  // ─── Client Contacts ─────────────────────────────────────────────────────────
  clientContacts: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_clientId", ["clientId"])
    .index("by_orgId_email", ["orgId", "email"]),

  // ─── Projects ─────────────────────────────────────────────────────────────────
  projects: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    name: v.string(),
    // Editable, unique per org. Also the task identifier key (D2: `ARLO-21`);
    // tasks/model.ts isValidIdentifierKey. Legacy auto codes ("PRJ-042") are
    // rewritten by the seed.
    code: v.string(),
    // Next per-project task number (D2). Incremented in the same mutation that
    // creates or moves a task into the project.
    nextTaskNumber: v.optional(v.number()),
    billingType: v.union(v.literal("fixed"), v.literal("retainer"), v.literal("t_and_m"), v.literal("non_billable")),
    // Currency is NOT stored on the project. Canonical source: client.currency.
    // See D1 invariant in convex/schema.ts above `timeEntries`.
    // Team members (users assigned to this project)
    teamMembers: v.optional(v.array(v.id("users"))),
    // Retainer fields
    retainerStatus: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    includedMinutesPerMonth: v.optional(v.number()), // monthly budget in minutes
    startDate: v.optional(v.string()),              // YYYY-MM-DD
    rolloverEnabled: v.optional(v.boolean()),
    cycleLength: v.optional(v.number()),            // 1-12 months
    monthlyFee: v.optional(v.number()),             // retainer monthly fee for revenue
    // Fixed fields
    fixedPrice: v.optional(v.number()),             // sold fixed fee
    overageRate: v.optional(v.number()),             // retainer $/h for hours over budget
    // Default assignees
    defaultAssignees: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      userId: v.id("users"),
    }))),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_code", ["orgId", "code"])
    .index("by_billingType_retainerStatus", ["billingType", "retainerStatus"]),

  // ─── Project Category Estimates (Fixed budget rows) ──────────────────────────
  projectCategoryEstimates: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    workCategoryId: v.id("workCategories"),
    estimatedMinutes: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_projectId", ["projectId"]),

  // ─── Invoices ──────────────────────────────────────────────────────────────
  invoices: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    clientId: v.id("clients"),
    // Allocated at FINALIZATION (draft → invoiced), not at draft creation —
    // Stripe-style. Drafts have no number, so deleting a draft never burns a
    // sequence number and the issued series stays gapless (a NAV/EU
    // requirement). Once allocated, a number is never removed — voided
    // invoices keep theirs as part of the audit trail.
    number: v.optional(v.number()),
    prefix: v.string(),
    subject: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("invoiced"),
      v.literal("paid"),
      v.literal("void")
    ),
    currency: v.string(),
    // Money is integer minor units only (docs/prd-billing-refactor.md N6);
    // queries add decimal display copies (`lib/billing/invoiceView`). Equal
    // until tax lines exist.
    subtotalMinor: v.number(),
    totalMinor: v.number(),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    note: v.optional(v.string()),
    // Editable per-invoice message rendered on the invoice document. Seeded
    // from `orgSettings.invoiceMessageTemplate` at creation; admin can edit.
    messageToClient: v.optional(v.string()),
    // The close that produced the invoice — its period, rounding and retainer
    // figures live there (§5.2). Absent on fixed-fee invoices (D5).
    closeId: v.optional(v.id("billingCloses")),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projectId", ["projectId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"])
    // Friendly-URL lookup: `/invoices/INV-035` → (orgId, "INV-", 35).
    .index("by_orgId_prefix_number", ["orgId", "prefix", "number"]),

  // ─── Invoice Line Items ───────────────────────────────────────────────────
  invoiceLineItems: defineTable({
    orgId: v.string(),
    invoiceId: v.id("invoices"),
    sortOrder: v.number(),
    lineType: v.union(
      v.literal("time"),
      v.literal("fixed"),
      v.literal("overage"),
      v.literal("manual")
    ),
    description: v.string(),
    // Display quantity: billed hours on time/overage lines (derived at
    // commit, never fed back into money), 1 on fixed lines, and the
    // multiplier a manual line's amount is priced from.
    quantity: v.number(),
    // Raw summed minutes of a time/overage line — its source quantity.
    quantityMinutes: v.optional(v.number()),
    workCategoryId: v.optional(v.id("workCategories")),
    // Money in integer minor units (N6). `groupKey` ties a time line to its
    // pricing group (category::task::rate). Membership lives in the close
    // snapshot (`billingCloseEntries`), not on the line.
    unitPriceMinor: v.number(),
    amountMinor: v.number(),
    groupKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_invoiceId", ["invoiceId"]),

  // ─── Time Entries ────────────────────────────────────────────────────────────
  // INVARIANT (D1 — see docs/d1-currency-integrity-plan.md):
  //   timeEntries.rateCurrency MUST equal client.currency(task.projectId.clientId)
  //   for every entry at creation and update time. The Project Summary card
  //   (api.projects.getSummary) aggregates money amounts without currency
  //   partitioning, so mixed-currency entries on a single project would
  //   silently produce wrong totals.
  //
  //   Enforcement: resolveRateSnapshot in convex/lib/orgHelpers.ts snapshots
  //   rateCurrency = getProjectCurrency(project) = client.currency.
  //   Drift vectors eliminated: client.currency is immutable (convex/clients.ts:178),
  //   project.clientId is immutable (convex/projects.ts update mutation).
  //
  //   DO NOT patch rateCurrency or project.clientId directly. DO NOT add a mutation that allows client.currency edits.
  timeEntries: defineTable({
    orgId: v.string(),
    // Denormalized from the task at creation (docs/prd-billing-refactor.md
    // §5.2). Stable by construction: entries are only created on project
    // tasks, a task with entries can never change (or drop) its project, and
    // an entry can only move to a task in the same project. Lets every
    // project reader use `by_orgId_projectId` instead of fanning out over tasks.
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    date: v.string(),                         // YYYY-MM-DD (org timezone)
    // Wall-clock start of the entry in epoch ms. Required: powers the Workday
    // grid's hour-of-day axis and any future calendar/overlap features. End is
    // derived as startedAt + durationMinutes * 60_000 (avoids rounding drift —
    // durationMinutes is rounded by orgSettings.roundingMinutes, wall-clock is not).
    startedAt: v.number(),
    durationMinutes: v.number(),
    note: v.optional(v.string()),
    isBillable: v.boolean(),
    method: v.union(v.literal("timer"), v.literal("manual")),
    // Rate snapshot — rateCurrency invariant above.
    costRate: v.number(),
    billableRate: v.number(),
    rateCurrency: v.string(),
    // Billing category for this entry, resolved at creation via the member-
    // default chain (resolveEntryCategory: explicit ?? owner default ?? task
    // category). Sticky: changed only by an explicit category edit, never
    // re-derived on task move. Every financial reader groups by this field.
    snapshotCategoryId: v.optional(v.id("workCategories")),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),

    // ─── Month-Close — skip-to-next-close stamp ──────────────────────────
    //
    // A period-end date (YYYY-MM-DD): "exclude this entry from every close
    // whose period end is ≤ this date." Set/cleared only by the admin-only
    // `billingCloses.skipEntries`; read by the pure scope rule
    // (`lib/billing/scope.ts`, PRD §6). Only meaningful on OPEN entries — the
    // skip mutation rejects closed ones. No index: membership is always
    // derived over an already-fetched project entry set.
    skippedThrough: v.optional(v.string()),    // YYYY-MM-DD (a period end)

    // ─── Billing refactor — close lock (docs/prd-billing-refactor.md) ────
    //
    // The live close this entry settles in (`lib/billing/closeLifecycle`).
    // A lock (N1) and lookup key only: the close's membership truth is its
    // `billingCloseEntries` snapshot (N2). Unset = open.
    closeId: v.optional(v.id("billingCloses")),
  })
    .index("by_orgId", ["orgId"])
    // Prefix (orgId, projectId) lists a project's entries; adding
    // closeId === undefined lists its OPEN entries.
    .index("by_orgId_projectId_closeId", ["orgId", "projectId", "closeId"])
    .index("by_taskId", ["taskId"])
    .index("by_userId_date", ["userId", "date"])
    .index("by_orgId_date", ["orgId", "date"]),

  // ─── Billing closes (docs/prd-billing-refactor.md §5.1) ──────────────────
  //
  // A close is the committed decision "these entries settle period P of
  // project X". Live while `draft` or `final`; `released` rows stay for
  // audit. Money is integer minor units. Written only by
  // `lib/billing/closeLifecycle`.
  billingCloses: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    kind: v.union(v.literal("retainer"), v.literal("t_and_m")),
    periodStart: v.string(),            // YYYY-MM-01
    periodEnd: v.string(),              // YYYY-MM-DD (month or cycle end)
    status: v.union(v.literal("draft"), v.literal("final"), v.literal("released")),
    invoiceId: v.optional(v.id("invoices")),

    // Frozen at commit — pricing inputs and outputs.
    currency: v.string(),
    roundingMinutes: v.number(),
    includedMinutes: v.number(),
    overageRateMinor: v.number(),
    usageMinutes: v.number(),
    overageMinutes: v.number(),
    amountMinor: v.number(),

    committedAt: v.number(),
    committedBy: v.id("users"),
    finalizedAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    releasedReason: v.optional(
      v.union(v.literal("draft_deleted"), v.literal("invoice_voided"), v.literal("reopened")),
    ),
  })
    .index("by_orgId_projectId_periodStart", ["orgId", "projectId", "periodStart"])
    .index("by_orgId_status", ["orgId", "status"]),

  // The immutable membership snapshot of a close (N2): written once at
  // commit, never patched. Closed-period reports read from here.
  billingCloseEntries: defineTable({
    orgId: v.string(),
    closeId: v.id("billingCloses"),
    entryId: v.id("timeEntries"),
    taskId: v.id("tasks"),
    categoryId: v.optional(v.id("workCategories")),
    date: v.string(),                   // entry date at commit
    monthKey: v.string(),               // YYYY-MM report bucket (periods.monthBucket)
    minutes: v.number(),
    isBillable: v.boolean(),
    billableRateMinor: v.number(),
    carried: v.optional(v.union(v.literal("skipped"), v.literal("logged-late"))),
  })
    .index("by_closeId", ["closeId"])
    .index("by_entryId", ["entryId"]),

  // Append-only billing audit trail (N10).
  billingEvents: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    closeId: v.optional(v.id("billingCloses")),
    invoiceId: v.optional(v.id("invoices")),
    type: v.union(
      v.literal("close_committed"),
      v.literal("close_released"),
      v.literal("invoice_finalized"),
      v.literal("invoice_reverted"),
      v.literal("invoice_voided"),
      v.literal("invoice_paid"),
      v.literal("invoice_unpaid"),
      v.literal("draft_deleted"),
      v.literal("entries_skipped"),
      v.literal("entries_unskipped"),
    ),
    actorId: v.id("users"),
    at: v.number(),
    data: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    // Written through an external agent (MCP attribution, docs/prd-mcp.md D15).
    via: v.optional(activityViaValidator),
  })
    .index("by_orgId_projectId_at", ["orgId", "projectId", "at"])
    .index("by_invoiceId", ["invoiceId"]),

  // ─── User Rates (per-user, per-currency cost rates) ────────────────────────
  userRates: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    currency: v.string(),
    costRate: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_userId_currency", ["orgId", "userId", "currency"]),

  // ─── Category Rates (per-category, per-currency default billable rates) ───
  categoryRates: defineTable({
    orgId: v.string(),
    workCategoryId: v.id("workCategories"),
    currency: v.string(),
    defaultBillRate: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_workCategoryId_currency", ["orgId", "workCategoryId", "currency"]),

  // ─── Project Rate Overrides (per-project, per-category billable rate) ─────
  projectRateOverrides: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    workCategoryId: v.id("workCategories"),
    billableRate: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_workCategoryId", ["projectId", "workCategoryId"]),

  // ─── Work Categories (per org) ──────────────────────────────────────────────
  workCategories: defineTable({
    orgId: v.string(),
    name: v.string(),
    color: v.string(),
    sortOrder: v.number(),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_orgId", ["orgId"]),

  // ─── Activity Log (audit trail per task) ───────────────────────────────────
  // Typed (§4.5): `type` is a literal union and `metadata` is discriminated
  // by it — tasks/model.ts activityLogValidator.
  activityLog: defineTable(activityLogValidator)
    .index("by_task", ["taskId", "createdAt"])
    .index("by_org", ["orgId", "createdAt"]),

  // ─── Attachments (per task, Convex file storage) ────────────────────────────
  attachments: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId", "createdAt"])
    .index("by_fileId", ["fileId"]), // one attachment per blob (assertBlobUnattached)

  // ─── Comment read receipts (per user per task) ─────────────────────────────
  commentReadReceipts: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    lastSeenAt: v.number(),
  })
    .index("by_user_task", ["userId", "taskId"])
    .index("by_task", ["taskId"])
    .index("by_orgId", ["orgId"]),

  // ─── Comments (per task) ───────────────────────────────────────────────────
  comments: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    content: v.object({
      type: v.string(),
      content: v.optional(v.any()),
    }),
    parentCommentId: v.optional(v.id("comments")),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    // Written through an external agent (MCP attribution, D15).
    via: v.optional(activityViaValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_task", ["taskId", "createdAt"]),

  // ─── Comment reactions ────────────────────────────────────────────────────
  commentReactions: defineTable({
    commentId: v.id("comments"),
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_comment", ["commentId"])
    .index("by_comment_user_emoji", ["commentId", "userId", "emoji"])
    .index("by_orgId", ["orgId"]),

  // ─── Comment attachments ──────────────────────────────────────────────────
  commentAttachments: defineTable({
    commentId: v.id("comments"),
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_comment", ["commentId"])
    .index("by_orgId", ["orgId"])
    .index("by_fileId", ["fileId"]), // one attachment per blob (assertBlobUnattached)

  // ─── Attachment contents (docs/prd-mcp.md §10, ported from c3972ab) ─────────
  // What an agent can read inside a stored file (MCP fetch include
  // `attachment_text`): text of PDF / DOCX / TXT / MD / CSV, image width ×
  // height. ONE row per stored file per org, keyed by (orgId, storageId) —
  // no FK to the referencing row: read access comes from the task or comment
  // attachment that references this storageId, re-checked at read time.
  // Written only by `requestExtraction` (convex/attachmentContents.ts) and
  // the extraction action (convex/attachmentExtraction.ts); deleted with the
  // blob (`deleteContentForStorage`, scoped to the referencing org). Rules:
  // lib/attachments/contents.ts.
  attachmentContents: defineTable({
    orgId: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("unsupported"),
      v.literal("failed"),
    ),
    text: v.optional(v.string()), // capped at EXTRACT_TEXT_MAX (50 000 chars)
    truncated: v.optional(v.boolean()), // the cap was hit
    pageCount: v.optional(v.number()), // PDF
    width: v.optional(v.number()), // images
    height: v.optional(v.number()),
    // Readable reason for unsupported / failed (and the last transient error
    // while a retry is pending).
    error: v.optional(v.string()),
    attempts: v.number(), // current attempt number, 0 = never attempted (max EXTRACT_MAX_ATTEMPTS)
    queuedAt: v.optional(v.number()), // when the current attempt is due (stuck-row re-queue)
    extractedAt: v.optional(v.number()), // set on a final status
    createdAt: v.number(),
  })
    .index("by_orgId_storageId", ["orgId", "storageId"]) // unique: one row per file per org
    .index("by_storageId", ["storageId"]), // one attachment per blob (assertBlobUnattached)

  // ─── Notifications (inbox — mentions, assignments, comments) ─────────────
  notifications: defineTable({
    orgId: v.string(),
    recipientId: v.id("users"),
    actorId: v.id("users"),
    type: v.union(
      v.literal("mention_comment"),
      v.literal("mention_description"),
      v.literal("assigned"),
      v.literal("comment"),
      v.literal("comment_reply"),
    ),
    taskId: v.id("tasks"),
    commentId: v.optional(v.id("comments")),
    // Plain-text snapshot at fan-out time (survives comment edits/deletes)
    previewText: v.string(),
    inboxState: v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("archived"),
      v.literal("snoozed"),
    ),
    readAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_recipient_org_state", ["recipientId", "orgId", "inboxState", "createdAt"])
    .index("by_task", ["taskId"])
    .index("by_orgId", ["orgId"]),

  // ─── Link previews (OG metadata cache, global) ────────────────────────────
  linkPreviews: defineTable({
    url: v.string(),
    title: v.optional(v.string()),
    domain: v.string(),
    status: v.union(v.literal("pending"), v.literal("fetched"), v.literal("failed")),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  // ─── Daily Notes (async standup, one per user per day) ────────────────────
  dailyNotes: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    date: v.string(),            // "YYYY-MM-DD" (org timezone)
    content: v.optional(v.string()), // TipTap JSON string
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_date", ["userId", "date"])
    .index("by_orgId_userId", ["orgId", "userId"])
    // Org-scoped date ranges (MCP daily_note search): another org's notes of
    // the same user never take part of a bounded read.
    .index("by_orgId_userId_date", ["orgId", "userId", "date"]),

  // ─── Typing indicators (ephemeral presence) ──────────────────────────────
  typingIndicators: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    lastTypedAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_task_user", ["taskId", "userId"]),

  // ─── Plan segments (Planner: one bar = one person × one date range) ───────
  // A task can have many segments (split sittings) across days and people.
  // Segments reference the task; the task's assigneeIds are NOT used for row
  // placement. Invariant `endDate >= startDate` is enforced at write time.
  planSegments: defineTable({
    orgId: v.string(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    startDate: v.string(),  // "YYYY-MM-DD" inclusive (same convention as timeEntries.date)
    endDate: v.string(),    // "YYYY-MM-DD" inclusive
    // Manual vertical stacking priority within a row (lower = higher on
    // screen). Unset = createdAt; written when the owner drags a bar
    // above/below another. Float midpoints — fine at MVP scale.
    laneOrder: v.optional(v.number()),
    // Manual ordering within the My Tasks Today group (fractional string
    // key, same mechanism as tasks.sortKey). Unset = segment
    // createdAt (arrival order, new entrants append at the bottom).
    todaySortKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId_taskId", ["orgId", "taskId"])
    .index("by_orgId_startDate", ["orgId", "startDate"])
    // Covering-today lookup for the derived My Tasks Today group. Queries
    // bound startDate below by today − SEGMENT_SCAN_WINDOW_DAYS as a scan
    // guard (see convex/lib/todayPlan.ts).
    .index("by_orgId_userId_startDate", ["orgId", "userId", "startDate"]),

  // ─── MCP idempotency keys (docs/prd-mcp.md D23) ───────────────────────────
  // One row per (org, user, key): the first result of a write tool call,
  // checked and written in the same mutation as the write. Kept 24 h; the
  // hourly cron in crons.ts deletes older rows (by_createdAt).
  mcpIdempotency: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    key: v.string(),
    tool: v.string(),
    // The request the key was first used for (tool + canonical arguments).
    fingerprint: v.string(),
    result: mcpWriteResultValidator,
    createdAt: v.number(),
  })
    .index("by_orgId_userId_key", ["orgId", "userId", "key"])
    .index("by_createdAt", ["createdAt"]),

  // ─── MCP file uploads (docs/prd-mcp.md D18, §10) ────────────────────────────
  // One row per `create_upload`: the file the caller announced (name, type,
  // size) under an unguessable `uploadId`. The upload endpoint
  // (convex/mcpFileUploads.ts, POST /mcp-upload?u=<uploadId>) stores exactly
  // those bytes once, within the hour, and writes `storageId`; `attach_file`
  // takes the uploadId and attaches that blob once (`attachedAt`). The client
  // never handles a storageId, so no other storage object can be attached
  // (I3). Rows are kept 25 h; the cleanup cron also deletes the blob of an
  // upload that was stored but never attached.
  mcpFileUploads: defineTable({
    uploadId: v.string(),
    orgId: v.string(),
    userId: v.id("users"),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    createdAt: v.number(),
    storageId: v.optional(v.id("_storage")),
    storedAt: v.optional(v.number()),
    attachedAt: v.optional(v.number()),
  })
    .index("by_uploadId", ["uploadId"])
    .index("by_createdAt", ["createdAt"]),

  // ─── MCP billing previews (docs/prd-mcp.md D5, §9) ────────────────────────
  // One row per billing_preview: its _id is the commit token. Bound to the
  // org, user and OAuth client that previewed, the action and its resolved
  // params, and the fingerprint of every value the commit would write. A
  // commit within 10 minutes (`expiresAt`) recomputes the fingerprint and
  // refuses on any change; the first result is kept so a repeated commit
  // returns it. The hourly cron deletes rows older than 24 h (by_createdAt).
  mcpBillingPreviews: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    clientId: v.string(),
    action: billingActionValidator,
    params: billingParamsValidator,
    fingerprint: v.string(),
    // The fingerprint without the invoice dates, and the issue date the preview
    // showed: a refusal caused only by midnight says so.
    datelessFingerprint: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    committedAt: v.optional(v.number()),
    result: v.optional(billingCommitResultValidator),
  })
    .index("by_createdAt", ["createdAt"])
    // Open previews per user (PREVIEW_OPEN_MAX).
    .index("by_orgId_userId_createdAt", ["orgId", "userId", "createdAt"]),

  // ─── MCP connections (docs/prd-mcp.md D17, §11 Connected apps) ──────────────
  // One row per org + user + OAuth client that has called /mcp. Clerk's
  // Backend API cannot list a user's OAuth grants (S4), so Settings →
  // Connected apps lists these rows. The /mcp route stamps them through
  // `mcp/connections:touch` (convex/lib/mcpConnections.ts), which writes at
  // most once per hour per client: `firstUsedAt` is shown as "Connected",
  // `lastUsedAt` as "Last used". `clientName` is display text only (D15).
  mcpConnections: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    clientId: v.string(),
    clientName: v.string(),
    firstUsedAt: v.number(),
    lastUsedAt: v.number(),
  }).index("by_orgId_userId_clientId", ["orgId", "userId", "clientId"]),
});
