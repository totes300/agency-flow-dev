import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  proposalPayloadValidator,
  proposalStatusValidator,
} from "./lib/proposalValidators";

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
    taskDetailView: v.optional(v.union(v.literal("modal"), v.literal("drawer"))),
    // My Tasks view: which individual statuses to show (status IDs)
    // During migration: may contain old type-key strings — widen accepts both
    todayVisibleStatuses: v.optional(v.array(v.string())),
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
    defaultStatusId: v.optional(v.id("statuses")),
    // Completion defaults by role
    completionDefaultAdminStatusId: v.optional(v.id("statuses")),
    completionDefaultMemberStatusId: v.optional(v.id("statuses")),
    // My Tasks: default visible statuses for all members (admin-configurable)
    defaultMyTasksStatusIds: v.optional(v.array(v.id("statuses"))),
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
    // Base
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_orgId", ["orgId"]),

  // ─── Task Statuses (per org, 5 system types) ──────────────────────────────
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
    archivedAt: v.optional(v.number()),
    // Base
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_type", ["orgId", "type"]),

  // ─── Tasks ───────────────────────────────────────────────────────────────────
  tasks: defineTable({
    orgId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    statusId: v.id("statuses"),
    statusType: v.union(
      v.literal("backlog"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("blocked"),
      v.literal("done")
    ),
    projectId: v.optional(v.id("projects")),
    assigneeIds: v.array(v.id("users")),
    workCategoryId: v.optional(v.id("workCategories")),
    estimate: v.optional(v.number()),
    billable: v.boolean(),
    dueDate: v.optional(v.string()),
    parentTaskId: v.optional(v.id("tasks")),
    sortOrder: v.optional(v.number()),          // subtask order within parent
    manualSortKey: v.optional(v.string()),       // fractional-indexing key for top-level drag order
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_manualSortKey", ["orgId", "manualSortKey"])
    .index("by_orgId_statusType", ["orgId", "statusType"])
    .index("by_orgId_statusId", ["orgId", "statusId"])
    .index("by_orgId_projectId", ["orgId", "projectId"])
    .index("by_orgId_parentTaskId", ["orgId", "parentTaskId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["orgId"],
    }),

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
    code: v.string(), // "PRJ-042", editable, unique per org
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
  activityLog: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    type: v.string(),
    metadata: v.any(),
    createdAt: v.number(),
  })
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
    .index("by_task", ["taskId", "createdAt"]),

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
    .index("by_orgId", ["orgId"]),

  // ─── Task View Receipts (per user per task — non-comment "seen" state) ───
  taskViewReceipts: defineTable({
    taskId: v.id("tasks"),
    orgId: v.string(),
    userId: v.id("users"),
    lastViewedAt: v.number(),
  })
    .index("by_user_task", ["userId", "taskId"])
    .index("by_orgId", ["orgId"]),

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

  // ─── Task mutes (per user — silences comment/reply notifications) ────────
  taskMutes: defineTable({
    orgId: v.string(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_user_task", ["userId", "taskId"])
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
    .index("by_orgId_userId", ["orgId", "userId"]),

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
    // key, same mechanism as tasks.manualSortKey). Unset = segment
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

  // ─── Agentic Platform (PRD: docs/agentic-platform/prd-v1.md) ───────────────
  // Agents are configuration, not code: instructions + a whitelist of
  // tool-registry names + run permission. `agentProposals`,
  // `agentArtifacts`, `connectors` arrive in their own slices.
  agents: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    // Names from the code-side tool registry (convex/lib/agentToolRegistry.ts).
    // Unknown names are dropped at runtime, never executed.
    tools: v.array(v.string()),
    // Attached skills (plain-English SOPs; slice 04). Resolved per run:
    // global first, then the run's client-scoped ones (convex/lib skills).
    skillIds: v.optional(v.array(v.id("skills"))),
    runPermission: v.union(v.literal("admins"), v.literal("everyone")),
    // Clickable chips on the first-run empty state; pre-fill the composer.
    examplePrompts: v.optional(v.array(v.string())),
    // Per-agent model override (registry default when unset).
    model: v.optional(v.string()),
    // Schema-ready for Wave 4 scheduled runs — no migration needed then.
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
    archivedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_orgId", ["orgId"]),

  // Skills (PRD D2, Module 7) — plain-English SOPs, global or per-client,
  // attached to agents by id. They steer judgment (grouping, tone, when to
  // stop); they NEVER change how a total is computed. A skill may declare a
  // hard stop-condition the runner enforces (the model calls a stop tool,
  // the run halts with an explanatory block). Resolution ordering lives in
  // the pure `lib/agents/skills.ts` (global first, then client-specific).
  skills: defineTable({
    orgId: v.string(),
    name: v.string(),
    instruction: v.string(),
    scope: v.union(v.literal("global"), v.literal("client")),
    // Present only for scope "client"; the run auto-loads it when its
    // opening message names this client.
    clientId: v.optional(v.id("clients")),
    isStopCondition: v.boolean(),
    archivedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_clientId", ["orgId", "clientId"]),

  // App-side thread metadata. Message storage lives in the @convex-dev/agent
  // component; this table maps component threads to org/agent/owner for
  // tenancy, rail listing, and audit. One thread = one continuable
  // multi-turn conversation with one agent.
  agentThreads: defineTable({
    orgId: v.string(),
    componentThreadId: v.string(),
    agentId: v.id("agents"),
    // Owner — rail lists own threads only; admin audit view comes later.
    userId: v.id("users"),
    title: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("error"),
    ),
    lastActivityAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_orgId_userId", ["orgId", "userId"])
    .index("by_orgId_agentId", ["orgId", "agentId"])
    .index("by_componentThreadId", ["componentThreadId"]),

  // One row per agent response cycle — the audit unit (who ran which agent,
  // when, outcome, token usage).
  agentRuns: defineTable({
    orgId: v.string(),
    threadId: v.id("agentThreads"),
    agentId: v.id("agents"),
    userId: v.id("users"),
    status: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
      // A loaded skill's stop-condition fired (slice 04) — distinct from a
      // user Stop (cancelled) and a failure; the thread stays continuable.
      v.literal("stopped_by_skill"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    // Cooperative Stop: set by stopRun, checked by the loop between steps.
    cancelRequested: v.optional(v.boolean()),
    // Skills loaded into this run's system prompt (slice 04) — surfaced as
    // "skill loaded" system blocks at run start.
    loadedSkills: v.optional(
      v.array(
        v.object({ name: v.string(), isStopCondition: v.boolean() }),
      ),
    ),
    // Set by the flagStopCondition tool when a stop-condition fires; the loop
    // halts and settles as `stopped_by_skill` with an explanatory block.
    stoppedBySkill: v.optional(
      v.object({ skillName: v.string(), reason: v.string() }),
    ),
    // Tool names this agent references that the registry no longer knows
    // (renamed/removed in code). Dropped before the model call and surfaced as
    // a `system` block so a stale ref degrades visibly instead of crashing.
    droppedTools: v.optional(v.array(v.string())),
    // Accumulated across the run's model calls (usageHandler fires per step).
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    // Actionable next step shown under the error block (e.g. settings hint).
    errorHint: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_threadId", ["threadId"]),

  // Big code-authored outputs a run produces (PRD Module 5 · canvas). One
  // row per artifact; the chat carries a lightweight `artifact` block that
  // references it, and the docked canvas renders it as a sheet. Wave 1 is
  // CSV-only (the Timesheet agent): `sheetJson` is the AgentTable payload the
  // canvas renders, `csv` is the ready-to-download body (BOM + injection
  // guard applied at build time) — BOTH code-authored from the same row data,
  // never re-serialized through the model (D1).
  agentArtifacts: defineTable({
    orgId: v.string(),
    threadId: v.id("agentThreads"),
    // The run that produced it, when known — audit only; the canvas keys off
    // arrival, not run identity.
    runId: v.optional(v.id("agentRuns")),
    // Owner = thread owner at creation. Read access is owner OR org admin.
    userId: v.id("users"),
    // `timesheet_csv` = deterministic tool pivot (D1); `sheet_csv` = a sheet
    // the model assembled via the createSheet tool (carries a provenance note).
    kind: v.union(v.literal("timesheet_csv"), v.literal("sheet_csv")),
    name: v.string(),
    // JSON-encoded AgentTable (lib/agents/table). Parsed + guarded on read;
    // stored as a string so the wire contract stays the single source of
    // truth instead of a parallel Convex validator that could drift. The CSV
    // is derived from THIS on the client at export time (same format helpers
    // the sheet renders with → the download matches the grid cell-for-cell);
    // Convex code must not touch `lib/format` (it re-exports an `@/` alias
    // the Convex typecheck can't resolve — see worksheetsHelpers).
    sheetJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_threadId", ["threadId"]),

  // Proposal engine (PRD Module 3 · slice 08) — the ONLY path from agent
  // intent to domain writes. A propose-kind tool inserts a row here and
  // returns its id; the chat renders it as an editable card; approval
  // validates the (possibly edited) payload against CURRENT data and
  // executes the mapped domain mutation AS THE APPROVING USER (D6 — the
  // activity log shows the human, never the agent). Kind union + payload
  // shapes: convex/lib/proposalValidators.ts / lib/agents/proposals.ts.
  agentProposals: defineTable({
    orgId: v.string(),
    threadId: v.id("agentThreads"),
    // The run that proposed it, when known — audit only.
    runId: v.optional(v.id("agentRuns")),
    // Thread owner at propose time; the only user who can decide the card.
    userId: v.id("users"),
    // The agent's draft (kind-discriminated). Never mutated after insert —
    // human edits land in editedPayload so the original intent stays
    // auditable next to what was actually committed.
    payload: proposalPayloadValidator,
    editedPayload: v.optional(proposalPayloadValidator),
    // pending → approved | discarded | failed. `failed` (stale reference,
    // domain-mutation rejection) is retryable — approve may run again.
    status: proposalStatusValidator,
    failureReason: v.optional(v.string()),
    // Id of the created/affected record once approved (e.g. the task id).
    committedRef: v.optional(v.string()),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_threadId_status", ["threadId", "status"]),

  // Connector framework (PRD Module 4 · slice 10) — the extensible chassis for
  // external accounts. STRICTLY PER-USER in V1: a connector authenticates the
  // running user's own account, so a tool resolves the connection of whoever
  // is running the agent and never another user's (US 38). Wave 1 ships the
  // framework + one dev/mock connector ("echo"); Gmail is Wave 3.
  //
  // Credentials are AES-GCM-encrypted with the SAME KEK as the AI key
  // (`convex/lib/secretCrypto.ts`) — the plaintext never crosses the client
  // boundary and never reaches the model (US 42). `credentialsCiphertext` is
  // cleared when the user disconnects (status → `revoked`); the row itself
  // survives so the surface can show the disconnected/errored state and a
  // reconnect upserts in place (by_orgId_userId_type is the unique key).
  connectors: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    // Catalog type from the code-side catalog (lib/agents/connectors.ts).
    type: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("expired"),
      v.literal("error"),
      v.literal("revoked"),
    ),
    // AES-GCM(JSON.stringify(credentials)); absent once revoked. The only
    // piece safe for the client is `credentialMask`.
    credentialsCiphertext: v.optional(v.string()),
    credentialMask: v.optional(v.string()),
    scopes: v.array(v.string()),
    connectedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_userId", ["orgId", "userId"])
    .index("by_orgId_userId_type", ["orgId", "userId", "type"]),
});
