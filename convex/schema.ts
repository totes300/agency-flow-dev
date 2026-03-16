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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("byExternalId", ["externalId"]),

  // ─── Org Settings (one per org) ────────────────────────────────────────────
  orgSettings: defineTable({
    orgId: v.string(),
    defaultCurrency: v.string(),
    timezone: v.string(),
    roundingMinutes: v.number(),
    defaultStatusId: v.optional(v.id("statuses")),
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
});
