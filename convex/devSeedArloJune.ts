import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { AuthContext } from "./lib/auth";
import { onComment, onTimeEntryChange } from "./tasks/derived";
import { createTask, deleteTaskRecord, patchTaskForSeed } from "./tasks/write";

/**
 * DEV-ONLY dummy data for testing the AI task summarizer.
 *
 * Seeds 5 realistic June-2026 tasks into the "Arlow monthly retainer"
 * project (code ARLO, formerly PRJ-002), each with a rich Tiptap description and a comment
 * thread alternating between the org's two members — so the summarizer
 * has real back-and-forth (decisions, blockers, approvals) to condense.
 *
 * Run:  npx convex run devSeedArloJune:seed
 * Undo: npx convex run devSeedArloJune:clear
 *
 * Idempotent: re-running `seed` skips tasks whose titles already exist
 * in the project. Safe to delete this whole file once done.
 */

// Recoded from the legacy "PRJ-002" by the tasks reseed (devSeedTasks).
const PROJECT_CODE = "ARLO";
const PROJECT_NAME = "Arlow monthly retainer";

// ─── Tiptap builders ────────────────────────────────────────────────────────

type TiptapNode = { type: string; [key: string]: unknown };

const text = (t: string): TiptapNode => ({ type: "text", text: t });
const p = (t: string): TiptapNode => ({ type: "paragraph", content: [text(t)] });
const bullets = (items: string[]): TiptapNode => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [p(i)] })),
});
const doc = (...content: TiptapNode[]) => ({ type: "doc", content });

const ts = (s: string) => new Date(s).getTime();

// ─── Seed content ───────────────────────────────────────────────────────────
// `author` — 0: Adam Toth (admin/PM), 1: Oslop Adam (maker).

type SeedComment = { author: 0 | 1; at: string; text: string; replyToPrev?: boolean };

/** June time entry — powers the worksheet/AI-summary flow (rows are built
 * from time entries, so tasks without them never reach the summarizer). */
type SeedEntry = { author: 0 | 1; date: string; minutes: number; note: string };

type SeedTask = {
  title: string;
  statusName: string;
  categoryName: string;
  assignee: 0 | 1;
  estimate: number; // minutes
  createdAt: string;
  dueDate: string; // YYYY-MM-DD
  description: ReturnType<typeof doc>;
  comments: SeedComment[];
  entries: SeedEntry[];
};

const TASKS: SeedTask[] = [
  {
    title: "Summer campaign landing page redesign",
    statusName: "Done",
    categoryName: "Design",
    assignee: 1,
    estimate: 720,
    createdAt: "2026-06-01T09:15:00+02:00",
    dueDate: "2026-06-12",
    description: doc(
      p("Redesign the /summer landing page for Arlow's July promo push. The current page converts at 1.4% — target is 2.5%+."),
      p("Scope:"),
      bullets([
        "New hero with seasonal key visual and a single primary CTA",
        "Social proof band (3 customer quotes, logos)",
        "Mobile-first layout — 68% of campaign traffic is mobile",
        "Reuse existing design tokens, no new component library work",
      ]),
      p("Out of scope: copy rewrite (handled in the blog/SEO task), backend form changes."),
    ),
    comments: [
      { author: 1, at: "2026-06-03T10:20:00+02:00", text: "First hero exploration is up in Figma — two directions: photo-led vs. illustration-led. The photo one feels more on-brand for the summer promo, but curious what you think." },
      { author: 0, at: "2026-06-03T14:05:00+02:00", text: "Agree, photo-led. The illustration direction drifts too far from Arlow's current brand. One ask: make the CTA sticky on mobile, their last campaign lost a lot of scroll-past conversions." },
      { author: 1, at: "2026-06-08T09:40:00+02:00", text: "Sticky mobile CTA added. Full page is now in Figma including the social proof band. Waiting on the two missing customer quotes from Arlow's side before I build.", replyToPrev: true },
      { author: 0, at: "2026-06-09T11:30:00+02:00", text: "Quotes arrived from Marta (Arlow) — dropped them in the shared drive. Note: legal asked us NOT to use the Nordfisk logo, they haven't signed the reference agreement yet. Use the other two + a neutral placeholder." },
      { author: 1, at: "2026-06-11T16:55:00+02:00", text: "Built and deployed to staging. Lighthouse mobile 94, CLS clean. Nordfisk logo left out as requested." },
      { author: 0, at: "2026-06-12T10:10:00+02:00", text: "Client approved on today's call — shipped to production. Nice work, closing this." },
    ],
    entries: [
      { author: 1, date: "2026-06-03", minutes: 90, note: "Hero explorations in Figma — photo-led vs. illustration-led directions" },
      { author: 1, date: "2026-06-11", minutes: 120, note: "Built the page from the approved design, sticky mobile CTA, deployed to staging" },
      { author: 1, date: "2026-06-12", minutes: 30, note: "Production launch + post-launch checks (Lighthouse, analytics events)" },
    ],
  },
  {
    title: "Klaviyo newsletter automation flow",
    statusName: "In progress",
    categoryName: "Development",
    assignee: 1,
    estimate: 600,
    createdAt: "2026-06-04T08:50:00+02:00",
    dueDate: "2026-06-26",
    description: doc(
      p("Set up the automated welcome + win-back email flows in Klaviyo for Arlow's shop."),
      bullets([
        "Welcome series: 3 emails (day 0 / day 3 / day 7), 10% first-order code in email 2",
        "Win-back: trigger at 60 days since last order, exclude subscribers already in welcome flow",
        "Sync coupon codes from Shopify via the existing middleware",
        "UTM tagging consistent with the June campaign scheme (utm_campaign=summer26)",
      ]),
      p("Success metric: welcome flow open rate ≥ 45%, win-back reactivation ≥ 4%."),
    ),
    comments: [
      { author: 1, at: "2026-06-06T13:15:00+02:00", text: "Welcome series is built and in test mode. Hit one snag: the Shopify coupon sync middleware rate-limits at 2 req/s, and Klaviyo's segment rebuild bursts way above that. Looking at queueing the sync." },
      { author: 0, at: "2026-06-06T15:40:00+02:00", text: "Before you build a queue — check if we can just pre-generate a coupon pool nightly instead of syncing on trigger. Simpler and we did the same for Pragmatico." },
      { author: 1, at: "2026-06-10T09:05:00+02:00", text: "Went with the nightly coupon pool, works great — 500 codes generated per night, flow just pops one from the pool. Welcome series is live since yesterday. Win-back flow is next.", replyToPrev: true },
      { author: 0, at: "2026-06-15T10:25:00+02:00", text: "Early numbers from the welcome flow: 51% open rate on email 1, 9 first orders attributed already. Client is happy. Reminder that the win-back segment must exclude wholesale customers (tag: b2b) — Marta flagged this today." },
      { author: 1, at: "2026-06-18T17:20:00+02:00", text: "Win-back flow drafted with the b2b exclusion in the trigger filter. Still todo: final copy review + the 60-day backfill decision (do we enroll existing lapsed customers or only new ones going forward?). Parking that question for the Friday call." },
    ],
    entries: [
      { author: 1, date: "2026-06-06", minutes: 90, note: "Welcome series build in Klaviyo; hit the coupon-sync rate limit" },
      { author: 1, date: "2026-06-10", minutes: 60, note: "Nightly coupon pool implemented, welcome flow live" },
      { author: 1, date: "2026-06-18", minutes: 30, note: "Win-back flow draft with b2b exclusion filter" },
    ],
  },
  {
    title: "Checkout bug: stacked coupons ignore free-shipping threshold",
    statusName: "Done",
    categoryName: "Development",
    assignee: 1,
    estimate: 240,
    createdAt: "2026-06-09T11:00:00+02:00",
    dueDate: "2026-06-16",
    description: doc(
      p("Bug report from Arlow support (ticket #4482): when a customer combines the SUMMER10 percentage coupon with a free-shipping code, the cart re-evaluates the free-shipping threshold AFTER the discount — so orders that qualified at 15,000 HUF drop below the threshold and get charged shipping."),
      bullets([
        "Reproduce on staging with SUMMER10 + FREESHIP on a 15,500 HUF cart",
        "Expected: threshold check runs on pre-discount subtotal (per Arlow's T&C)",
        "Fix in the checkout extension, add a regression test",
        "Affected orders since June 1 need a list for support to refund shipping",
      ]),
    ),
    comments: [
      { author: 1, at: "2026-06-10T10:45:00+02:00", text: "Reproduced. Root cause: the threshold check reads cart.total_price which Shopify updates after discount application. Switching it to total_line_items_price (pre-discount) fixes it. One-line fix plus tests." },
      { author: 0, at: "2026-06-10T12:00:00+02:00", text: "Good find. Please also pull the affected-orders list — support wants to proactively refund the shipping, not wait for complaints." },
      { author: 1, at: "2026-06-12T14:30:00+02:00", text: "Fix deployed to production this morning. Affected orders since June 1: 23 orders, total 34,270 HUF in wrongly charged shipping — CSV exported and sent to Arlow support. Regression test added to the checkout suite.", replyToPrev: true },
      { author: 0, at: "2026-06-13T09:20:00+02:00", text: "Support confirmed all 23 refunds processed. Verified on prod with a test order — threshold now honors the pre-discount subtotal. Closing." },
    ],
    entries: [
      { author: 1, date: "2026-06-10", minutes: 60, note: "Repro + root cause: threshold reads post-discount cart total" },
      { author: 1, date: "2026-06-12", minutes: 60, note: "Fix deployed to prod; affected-orders CSV for support (23 orders)" },
      { author: 0, date: "2026-06-13", minutes: 30, note: "Prod verification with test order, coordinated shipping refunds with support" },
    ],
  },
  {
    title: "June SEO content: 3 summer-topic blog posts",
    statusName: "Client review",
    categoryName: "Copywriting",
    assignee: 0,
    estimate: 540,
    createdAt: "2026-06-05T09:30:00+02:00",
    dueDate: "2026-06-24",
    description: doc(
      p("Three SEO articles for Arlow's blog supporting the summer campaign. Keywords agreed with the client in the May content plan:"),
      bullets([
        "\"nyári bőrápolási rutin\" (vol. 2,400/mo) — pillar piece, ~1,800 words",
        "\"fényvédő zsíros bőrre\" (vol. 1,300/mo) — product-adjacent, links to SPF collection",
        "\"utazási kozmetikum lista\" (vol. 880/mo) — listicle, internal links to travel-size bundle",
      ]),
      p("Each post: meta title/description, 2 internal links minimum, hero image brief for the design team. Publish cadence: one per week starting June 10."),
    ),
    comments: [
      { author: 0, at: "2026-06-09T15:10:00+02:00", text: "First draft of the pillar piece is done, link in the content folder. Went slightly longer (2,100 words) because the competitor gap analysis showed thin coverage on the SPF-reapplication subtopic — that's our ranking angle." },
      { author: 1, at: "2026-06-10T10:00:00+02:00", text: "Read it — strong. Two notes: the intro buries the primary keyword until paragraph 3, and we should add a product CTA block after the routine-steps section, same pattern that worked on the spring posts." },
      { author: 0, at: "2026-06-11T11:45:00+02:00", text: "Both fixed. Post 1 published on schedule today. Drafts 2 and 3 are written; sent both to Marta for brand-claim review (the SPF one makes efficacy claims their legal wants to see).", replyToPrev: true },
      { author: 1, at: "2026-06-17T13:35:00+02:00", text: "Hero images for posts 2 and 3 are ready and uploaded to the CMS. Just waiting on the client review to hit publish." },
      { author: 0, at: "2026-06-22T09:50:00+02:00", text: "Marta approved post 2 with one wording change (done, published today). Post 3 still with their legal — chasing it on the Friday call. If no answer by the 26th we slip it to the July 1 slot." },
    ],
    entries: [
      { author: 0, date: "2026-06-09", minutes: 60, note: "Pillar post draft, 2,100 words with SPF-reapplication ranking angle" },
      { author: 0, date: "2026-06-11", minutes: 30, note: "Intro rework + product CTA block; post 1 published" },
      { author: 0, date: "2026-06-22", minutes: 30, note: "Post 2 legal wording fix + publish" },
    ],
  },
  {
    title: "June monthly report + July planning call prep",
    statusName: "In progress",
    categoryName: "PM",
    assignee: 0,
    estimate: 300,
    createdAt: "2026-06-15T10:00:00+02:00",
    dueDate: "2026-06-30",
    description: doc(
      p("Prepare the June monthly retainer report for Arlow and the agenda for the July 2 planning call."),
      bullets([
        "Retainer usage: hours by category vs. the 10h monthly budget, flag any overage",
        "Campaign results: landing page conversion, welcome-flow revenue, blog rankings",
        "Open items carried into July (win-back flow launch, blog post 3)",
        "July proposal: client hinted at a loyalty-program discovery — scope a first estimate",
      ]),
      p("Report goes out as PDF by June 30 EOD, ahead of the July 2 call."),
    ),
    comments: [
      { author: 0, at: "2026-06-19T14:20:00+02:00", text: "Draft structure is in the shared doc. Heads up: we're trending toward ~12.5h against the 10h budget this month, mostly from the checkout bug — that's 2.5h overage to invoice at the contract rate. I'll call it out transparently in the report with the ticket reference." },
      { author: 1, at: "2026-06-20T09:10:00+02:00", text: "Makes sense — the bug was clearly out-of-scope reactive work. I'll get you the final dev-hours breakdown and the before/after conversion numbers for the landing page by Tuesday." },
      { author: 0, at: "2026-06-24T16:40:00+02:00", text: "Numbers are in: landing page 1.4% → 2.7% conversion, welcome flow attributed 214k HUF revenue in its first two weeks. Pillar post already ranking #6 for the main keyword. Report is 80% done — still need the July loyalty-program discovery estimate from you.", replyToPrev: true },
    ],
    entries: [
      { author: 0, date: "2026-06-19", minutes: 30, note: "Report structure + retainer usage section draft" },
      { author: 0, date: "2026-06-24", minutes: 30, note: "Campaign numbers into the report (LP conversion, flow revenue, rankings)" },
    ],
  },
];
// Entry total: 750 min = 12.5h against the 10h (600 min) retainer budget —
// intentionally 2.5h of overage, matching the narrative in the report task's
// comments and giving the month-close report something to flag.

// ─── Mutations ──────────────────────────────────────────────────────────────

async function getProject(ctx: MutationCtx): Promise<Doc<"projects">> {
  const projects = await ctx.db.query("projects").collect();
  // The reseed gives unique keys per project (a second Arlow project would be
  // ARLO2), so the name disambiguates; the code alone is the last resort.
  const project =
    projects.find((pr) => pr.code === PROJECT_CODE && pr.name === PROJECT_NAME) ??
    projects.find((pr) => pr.name === PROJECT_NAME) ??
    projects.find((pr) => pr.code === PROJECT_CODE);
  if (!project) throw new Error(`No project with code ${PROJECT_CODE} or name "${PROJECT_NAME}"`);
  return project;
}

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await getProject(ctx);
    const orgId = project.orgId;

    const users = (await ctx.db.query("users").collect()).filter((u) => !u.deletedAt);
    const adam = users.find((u) => u.email === "adam@konverted.io");
    const oslop = users.find((u) => u.email === "adam@oslop.studio");
    if (!adam || !oslop) throw new Error("Expected both org members (adam@konverted.io, adam@oslop.studio)");
    const authors: [Id<"users">, Id<"users">] = [adam._id, oslop._id];
    // Tasks are created through the write path as the admin (no notifications).
    const seedActor: AuthContext = { userId: adam._id, orgId, orgRole: "admin", isAdmin: true, user: adam };

    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const categories = (await ctx.db.query("workCategories").collect()).filter(
      (c) => c.orgId === orgId,
    );

    const client = await ctx.db.get(project.clientId);
    const rateCurrency = client?.currency ?? "USD";

    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", project._id))
      .collect();
    const existingByTitle = new Map(existing.map((t) => [t.title, t]));

    let tasksInserted = 0;
    let commentsInserted = 0;
    let entriesInserted = 0;

    for (const st of TASKS) {
      const status = statuses.find((s) => s.name === st.statusName);
      if (!status) throw new Error(`No status named "${st.statusName}" in org ${orgId}`);
      const category = categories.find((c) => c.name === st.categoryName);
      if (!category) throw new Error(`No work category named "${st.categoryName}" in org ${orgId}`);

      const createdAt = ts(st.createdAt);
      const lastCommentAt = ts(st.comments[st.comments.length - 1].at);

      // Task + comments — skipped when the task already exists (re-run).
      let taskId = existingByTitle.get(st.title)?._id;
      if (!taskId) {
        taskId = await createTask(
          ctx,
          seedActor,
          {
            title: st.title,
            description: JSON.stringify(st.description),
            statusId: status._id,
            projectId: project._id,
            assigneeIds: [authors[st.assignee]],
            workCategoryId: category._id,
            estimateMinutes: st.estimate,
            billable: true,
            dueDate: st.dueDate,
          },
          { now: createdAt, notify: false },
        );
        await patchTaskForSeed(ctx, taskId, { updatedAt: lastCommentAt });
        tasksInserted++;

        let prevCommentId: Id<"comments"> | undefined;
        for (const c of st.comments) {
          const at = ts(c.at);
          const commentId = await ctx.db.insert("comments", {
            taskId,
            orgId,
            userId: authors[c.author],
            content: doc(p(c.text)),
            parentCommentId: c.replyToPrev ? prevCommentId : undefined,
            createdAt: at,
            updatedAt: at,
          });
          prevCommentId = commentId;
          commentsInserted++;
          await onComment(ctx, taskId, { kind: "created", at, actorId: authors[c.author] });
        }
      }

      // June time entries — the worksheet/AI-summary flow only surfaces
      // tasks that have entries in the exported month. Idempotent: only
      // seeded when the task has no entries at all yet.
      const hasEntries =
        (await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
          .first()) !== null;
      if (!hasEntries) {
        for (const e of st.entries) {
          const startedAt = ts(`${e.date}T09:30:00+02:00`);
          await ctx.db.insert("timeEntries", {
            orgId,
            projectId: project._id,
            taskId,
            userId: authors[e.author],
            date: e.date,
            startedAt,
            durationMinutes: e.minutes,
            note: e.note,
            isBillable: true,
            method: "manual",
            costRate: 40,
            billableRate: 0,
            rateCurrency,
            snapshotCategoryId: category._id,
            createdAt: startedAt + e.minutes * 60_000,
            updatedAt: startedAt + e.minutes * 60_000,
            createdBy: authors[e.author],
          });
          await onTimeEntryChange(ctx, taskId, e.minutes);
          entriesInserted++;
        }
      }
    }

    return {
      project: project.name,
      tasksInserted,
      commentsInserted,
      entriesInserted,
      skippedExisting: TASKS.length - tasksInserted,
    };
  },
});

/** Inspect the seeded tasks — dev debugging aid. */
export const verify = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await getProject(ctx);
    const titles = new Set(TASKS.map((t) => t.title));
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", project.orgId).eq("projectId", project._id),
      )
      .collect();
    return tasks
      .filter((t) => titles.has(t.title))
      .map((t) => ({
        title: t.title,
        orgId: t.orgId,
        projectId: t.projectId,
        statusCategory: t.statusCategory,
        statusId: t.statusId,
        archivedAt: t.archivedAt ?? null,
        parentTaskId: t.parentTaskId ?? null,
        dueDate: t.dueDate,
      }));
  },
});

/** Ground-truth snapshot for June 2026 across ALL retainer projects —
 * used to hand-compute the expected month-close report output. */
export const juneSnapshot = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = (await ctx.db.query("projects").collect()).filter(
      (pr) => pr.billingType === "retainer" && !pr.archivedAt,
    );
    const out = [];
    for (const pr of projects) {
      const client = await ctx.db.get(pr.clientId);
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", pr.orgId).eq("projectId", pr._id),
        )
        .collect();
      let juneMinutes = 0;
      const entryDetails = [];
      for (const t of tasks) {
        const entries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
          .collect();
        for (const e of entries) {
          if (e.date >= "2026-06-01" && e.date <= "2026-06-30") {
            juneMinutes += e.durationMinutes;
            entryDetails.push({ task: t.title, date: e.date, min: e.durationMinutes, closeId: e.closeId ?? null });
          }
        }
      }
      const closes = await ctx.db
        .query("billingCloses")
        .withIndex("by_orgId_projectId_periodStart", (q) =>
          q.eq("orgId", pr.orgId).eq("projectId", pr._id),
        )
        .collect();
      out.push({
        project: pr.name,
        code: pr.code,
        client: client?.name,
        currency: client?.currency,
        budgetMin: pr.includedMinutesPerMonth,
        rollover: pr.rolloverEnabled,
        cycleLength: pr.cycleLength,
        overageRate: pr.overageRate,
        retainerStatus: pr.retainerStatus,
        startDate: pr.startDate,
        juneMinutes,
        entryDetails,
        closes: closes.map((c) => ({ start: c.periodStart, status: c.status })),
      });
    }
    const invoices = await ctx.db.query("invoices").collect();
    return {
      retainers: out,
      invoices: invoices.map((inv) => ({
        id: inv._id,
        clientId: inv.clientId,
        status: inv.status,
        totalMinor: inv.totalMinor,
        closeId: inv.closeId ?? null,
      })),
    };
  },
});

/** Delete the seeded tasks (matched by title) and their comments. */
export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await getProject(ctx);
    const titles = new Set(TASKS.map((t) => t.title));

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", project.orgId).eq("projectId", project._id),
      )
      .collect();

    let tasksDeleted = 0;
    let commentsDeleted = 0;
    let entriesDeleted = 0;
    for (const task of tasks) {
      if (!titles.has(task.title)) continue;
      commentsDeleted += (
        await ctx.db.query("comments").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect()
      ).length;
      entriesDeleted += (
        await ctx.db.query("timeEntries").withIndex("by_taskId", (q) => q.eq("taskId", task._id)).collect()
      ).length;
      // Entries, comments, activity, edges, aliases and the task row (write path).
      await deleteTaskRecord(ctx, task);
      tasksDeleted++;
    }
    return { tasksDeleted, commentsDeleted, entriesDeleted };
  },
});
