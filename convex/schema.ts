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
    // Rate defaults
    defaultTmFlatRate: v.optional(v.number()),   // org-level default for T&M flat-rate projects
    // Branding (used in later phases, define fields now)
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
    sortOrder: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
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
    invoicePrefix: v.string(),
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
    billingType: v.union(v.literal("fixed"), v.literal("retainer"), v.literal("t_and_m")),
    currency: v.string(),
    // Retainer fields (Phase 4)
    retainerStatus: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    includedMinutesPerMonth: v.optional(v.number()), // monthly budget in minutes
    overageRate: v.optional(v.number()),            // $/h for overage
    startDate: v.optional(v.string()),              // YYYY-MM-DD
    rolloverEnabled: v.optional(v.boolean()),
    cycleLength: v.optional(v.number()),            // 1-12 months
    // Fixed fields
    fixedPrice: v.optional(v.number()),           // sold fixed fee (required for fixed projects)
    // T&M fields
    hourlyRate: v.optional(v.number()),
    tmCategoryRates: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      rate: v.number(),
    }))),
    tmRateMode: v.optional(v.union(v.literal("flat"), v.literal("per_category"))),
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
    internalCostRate: v.optional(v.number()),
    clientBillingRate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_projectId", ["projectId"]),

  // ─── Retainer Periods (lazy-created per project per month) ───────────────────
  retainerPeriods: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-DD (1st of month)
    periodEnd: v.string(),   // YYYY-MM-DD (last of month)
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_projectId", ["projectId"])
    .index("by_projectId_periodStart", ["projectId", "periodStart"]),

  // ─── Time Entries ────────────────────────────────────────────────────────────
  timeEntries: defineTable({
    orgId: v.string(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    date: v.string(),                         // YYYY-MM-DD (org timezone)
    durationMinutes: v.number(),
    note: v.optional(v.string()),
    isBillable: v.boolean(),
    method: v.union(v.literal("timer"), v.literal("manual")),
    // invoicedInReportId deferred to Reports phase (no reports table yet)
    appliedRate: v.optional(v.number()),
    appliedCostRate: v.optional(v.number()),
    appliedBillRate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_orgId", ["orgId"])
    .index("by_taskId", ["taskId"])
    .index("by_userId_date", ["userId", "date"])
    .index("by_orgId_date", ["orgId", "date"]),

  // ─── Work Categories (per org) ──────────────────────────────────────────────
  workCategories: defineTable({
    orgId: v.string(),
    name: v.string(),
    color: v.string(),
    defaultCostRate: v.optional(v.number()),
    defaultBillRate: v.optional(v.number()),
    currency: v.string(),
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
