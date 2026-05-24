import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

  // ─── Retainer Periods (lazy-created per project per month) ───────────────────
  //
  // `closedAt`/`closedBy` are populated by `closePeriod`/`closeRetainerCycle`
  // (Phase 8 Slice 3/4). When set, the row's period is admin-settled — its
  // time entries should be locked from edits and excluded from "needs
  // attention" feeds. Calendar-end vs admin-settled are two distinct concepts
  // (see `periodEnded` vs `isClosed` on `getRetainerData`'s month rows).
  retainerPeriods: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-DD (1st of month)
    periodEnd: v.string(),   // YYYY-MM-DD (last of month)
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
    closedAt: v.optional(v.number()),     // Phase 8 — admin settlement timestamp (ms)
    closedBy: v.optional(v.id("users")),  // Phase 8 — admin who clicked Close
  }).index("by_projectId", ["projectId"])
    .index("by_projectId_periodStart", ["projectId", "periodStart"]),

  // ─── Invoices ──────────────────────────────────────────────────────────────
  invoices: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    clientId: v.id("clients"),
    number: v.number(),
    prefix: v.string(),
    subject: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("invoiced"),
      v.literal("paid"),
      v.literal("void")
    ),
    currency: v.string(),
    subtotal: v.number(),
    total: v.number(),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    note: v.optional(v.string()),
    // Editable per-invoice message rendered on the invoice document. Seeded
    // from `orgSettings.invoiceMessageTemplate` at creation; admin can edit.
    messageToClient: v.optional(v.string()),
    roundingMinutes: v.optional(v.number()),
    // Retainer balance snapshot (retainer invoices only)
    retainerStartBalanceMinutes: v.optional(v.number()),
    retainerIncludedMinutes: v.optional(v.number()),
    retainerUsedMinutes: v.optional(v.number()),
    retainerEndBalanceMinutes: v.optional(v.number()),
    retainerMonthlyFee: v.optional(v.number()),
    retainerOverageRate: v.optional(v.number()),
    // Snapshot of the project's retainer config at invoice creation. Reading
    // live `project.rolloverEnabled` / `project.cycleLength` would silently
    // flip a draft's balance meaning when an admin toggles settings mid-cycle.
    retainerRolloverEnabled: v.optional(v.boolean()),
    retainerCycleLength: v.optional(v.number()),
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
    quantity: v.number(),
    unitPrice: v.number(),
    amount: v.number(),
    amountOverridden: v.optional(v.boolean()),
    // Source-of-truth minutes on time rows, set at creation from the summed
    // time-entry minutes. `quantity` (hours) is the display/billing unit.
    // Retainer recalc reads `quantityMinutes` to avoid hours→minutes rounding
    // drift. Mirrors the pattern used by Harvest, Bonsai, and Toggl.
    quantityMinutes: v.optional(v.number()),
    workCategoryId: v.optional(v.id("workCategories")),
    timeEntryIds: v.optional(v.array(v.id("timeEntries"))),
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
  //   DO NOT patch rateCurrency, invoiceId's currency, or project.clientId
  //   directly. DO NOT add a mutation that allows client.currency edits.
  timeEntries: defineTable({
    orgId: v.string(),
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
    snapshotCategoryId: v.optional(v.id("workCategories")),
    invoiceId: v.optional(v.id("invoices")),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),

    // ─── Phase 8 — Settlement fields ─────────────────────────────────────
    //
    // `invoiceId` tracks the document linkage; the four fields below track
    // client-facing work closure as a separate axis. The two are NOT the
    // same concept — a Fixed-invoice entry has `invoiceId` set but its
    // revenue is the fixed line, not the time rate; a retainer-within-
    // budget entry has no invoice but is closed by the period-close flow.
    //
    // An entry is "locked" (no edits / no delete) when either field is set.
    // For "is this hour revenue-bearing?" reports, read `settledReason` —
    // only `"invoiced"` means revenue was rate-driven on a document.
    //
    // Populated by `convex/lib/settleEntries.ts` helpers (invoice-anchored
    // settlement, Slice 1) and `convex/retainerPeriods.ts:closePeriod`
    // (period-anchored settlement, Slice 3). See parent PRD § Derived
    // Status for the row-level `entryStatus()` derivation.
    settledAt: v.optional(v.number()),         // event timestamp (ms)
    settledReason: v.optional(
      v.union(
        v.literal("invoiced"),                  // billed hourly — T&M direct OR retainer overage line
        v.literal("retainer_included"),         // covered by retainer monthly fee (within-budget close)
        v.literal("fixed_included"),            // covered by fixed project price (Fixed invoice close)
      ),
    ),
    settledPeriodStart: v.optional(v.string()), // YYYY-MM-DD
    settledPeriodEnd: v.optional(v.string()),   // YYYY-MM-DD
    // No new index — settle helpers walk via `invoiceLineItems.by_invoiceId`.
    // Canonical-set rule: "entries settled by invoice X" = the union of
    // line-item `timeEntryIds` arrays, NOT every entry that happens to
    // carry `invoiceId === X`. Data drift is treated as a bug.
  })
    .index("by_orgId", ["orgId"])
    .index("by_taskId", ["taskId"])
    .index("by_userId_date", ["userId", "date"])
    .index("by_orgId_date", ["orgId", "date"]),

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
});
