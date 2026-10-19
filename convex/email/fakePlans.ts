import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { threadRequests } from "./requests";
import type { PlanDispositionInput, PlanSubtaskInput, PlanTaskInput, TriagePlanInput } from "./plan";
import type { ChangeToolInput } from "./changes";

/**
 * DEV-ONLY canned Triage plans for the seeded canvas conversations
 * (convex/devSeedEmail.ts), the B6a twin of email/fakeClassifier.ts:
 *
 *   npx convex run devSeedEmail:process '{"fakeModel":true}'
 *
 * `email/prepare.runFakePlan` uses these ONLY for an item of a `devSeed`
 * mailbox; the plan then goes through the real `submitTriagePlanCore` —
 * the same id checks, I12 / verbatim checks, due dates in code, proposals,
 * ledger and item writes as a model's `submitTriagePlan`. So the ids here are
 * looked up in the org (ledger rows by the request text the fake classifier
 * wrote, the client's project, its routing per work category, the designated
 * actor as the fallback owner) and no date is written — only the deadline
 * PHRASE the email states.
 *
 *   Réka  → ONE task "Black Friday kampány anyagok", 5 self-explaining
 *           subtasks (the sizes / 20% / platform verbatim in the titles), due
 *           "Jövő szerdáig", + the countdown question (which Friday, what time)
 *   Gábor → one urgent task (due today), the prices verbatim
 *   Péter → a reply instead of a task (his "mikorra lesz kész?")
 *   Judit → a new client (Zöldkert Kft.) + one task; her call request answered
 *   B6b:
 *   Péter, "Make it a task instead" → one task with the question as a subtask
 *   a change on a linked task (Réka's follow-up "és kérnénk egy story méretet
 *   is") → `cannedChangeFor`: one new subtask per new request
 */

export type CannedQuestion = {
  header: string;
  question: string;
  why: string;
  options: Array<{
    label: string;
    description?: string;
    recommended?: boolean;
    effect?: "email_client" | "answer_here";
    composerPrefix?: string;
  }>;
  requestId?: string;
};

export type CannedPlan = { input: TriagePlanInput; question?: CannedQuestion; summary: string };

type Ctx = {
  ctx: MutationCtx;
  auth: AuthContext;
  rows: Doc<"clientRequests">[];
  project: Doc<"projects"> | null;
  categories: Doc<"workCategories">[];
};

/** The ledger row whose text contains `snippet` (the fake classifier's wording). */
function rowFor(c: Ctx, snippet: string): Doc<"clientRequests"> | null {
  return c.rows.find((r) => r.text.includes(snippet) && r.disposition !== "superseded" && r.disposition !== "dismissed") ?? null;
}

/** A work category by name hints (EN / HU), or null. */
function categoryFor(c: Ctx, hints: readonly string[]): Doc<"workCategories"> | null {
  return c.categories.find((cat) => hints.some((h) => cat.name.toLowerCase().includes(h))) ?? null;
}

/** Routing first (the project's default assignee for the category), else the designated actor. */
async function ownerFor(c: Ctx, category: Doc<"workCategories"> | null): Promise<{ id: string; reason: string }> {
  const routed = category && c.project?.defaultAssignees?.find((d) => d.workCategoryId === category._id);
  if (routed) {
    const user = await c.ctx.db.get(routed.userId);
    if (user && !user.deletedAt) {
      return { id: user._id, reason: `Project routing: ${category.name} → ${user.name}` };
    }
  }
  return {
    id: c.auth.userId,
    reason: category ? `No routing for ${category.name} — assigned to ${c.auth.user.name}` : `Assigned to ${c.auth.user.name}`,
  };
}

async function clientProject(ctx: MutationCtx, orgId: string, clientId: Id<"clients"> | undefined): Promise<Doc<"projects"> | null> {
  if (!clientId) return null;
  const client = await ctx.db.get(clientId);
  if (!client || client.orgId !== orgId) return null;
  if (client.defaultProjectId) {
    const preferred = await ctx.db.get(client.defaultProjectId);
    if (preferred && preferred.orgId === orgId && !preferred.archivedAt) return preferred;
  }
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
    .take(50);
  return projects.find((p) => p.orgId === orgId && !p.archivedAt) ?? null;
}

type SubtaskSpec = {
  title: string;
  snippet: string;
  categoryHints: readonly string[];
  duePhrase?: string;
  disposition?: "covered" | "question_pending";
};

/** Subtasks + dispositions + reasons for one task from specs (rows that are missing are skipped). */
async function buildSubtasks(
  c: Ctx,
  specs: readonly SubtaskSpec[],
): Promise<{
  subtasks: PlanSubtaskInput[];
  dispositions: PlanDispositionInput[];
  reasons: NonNullable<PlanTaskInput["fieldReasons"]>;
  owners: string[];
  rowIds: Record<string, string>;
}> {
  const subtasks: PlanSubtaskInput[] = [];
  const dispositions: PlanDispositionInput[] = [];
  const reasons: NonNullable<PlanTaskInput["fieldReasons"]> = [];
  const owners: string[] = [];
  const rowIds: Record<string, string> = {};
  for (const spec of specs) {
    const row = rowFor(c, spec.snippet);
    if (!row) continue;
    const owner = await ownerFor(c, categoryFor(c, spec.categoryHints));
    const index = subtasks.length;
    subtasks.push({
      title: spec.title,
      assigneeIds: [owner.id],
      requestIds: [row._id],
      ...(spec.duePhrase ? { duePhrase: spec.duePhrase } : {}),
    });
    reasons.push({ field: `subtasks.${index}.assigneeIds`, reason: owner.reason, confidence: owner.reason.startsWith("Project routing") ? "sure" : "unsure" });
    if (!owners.includes(owner.id)) owners.push(owner.id);
    rowIds[spec.snippet] = row._id;
    if (spec.disposition !== "question_pending") {
      dispositions.push({ requestId: row._id, disposition: "covered", task: 0, subtask: index });
    }
  }
  return { subtasks, dispositions, reasons, owners, rowIds };
}

const DESIGN = ["design", "dizájn", "grafik", "kreatív"];
const DEV = ["develop", "fejleszt", "web", "dev"];
const CONTENT = ["content", "tartalom", "copy", "szöveg", "hírlevél", "email", "marketing"];

async function rekaPlan(c: Ctx, client: Id<"clients"> | undefined): Promise<CannedPlan | null> {
  const countdownSnippet = "visszaszámláló";
  const built = await buildSubtasks(c, [
    {
      title: "Bannerek 1200×628 és 1080×1920 méretben a Black Friday kampányhoz, jövő szerdáig",
      snippet: "Bannerek két méretben",
      categoryHints: DESIGN,
      duePhrase: "Jövő szerdáig",
    },
    {
      title: "A bannereken jelezni, hogy a 20% kedvezmény csak a webshopra vonatkozik, az üzletekre nem",
      snippet: "A 20% kedvezmény",
      categoryHints: DESIGN,
      duePhrase: "Jövő szerdáig",
    },
    {
      title: "Visszaszámláló a landing oldalra, ami péntek éjfélig fut",
      snippet: countdownSnippet,
      categoryHints: DEV,
      duePhrase: "Jövő szerdáig",
      disposition: "question_pending",
    },
    {
      title: "Hírlevél a meglévő feliratkozóknak a bannerek vizuáljával, kiküldésre készen",
      snippet: "Egy hírlevél",
      categoryHints: CONTENT,
      duePhrase: "Jövő szerdáig",
    },
    {
      title: "Story méret az Instagramra a Black Friday bannerek vizuáljával",
      snippet: "story méret",
      categoryHints: DESIGN,
      duePhrase: "Jövő szerdáig",
    },
  ]);
  if (built.subtasks.length === 0) return null;
  const countdownRow = built.rowIds[countdownSnippet];
  const countdownIndex = built.subtasks.findIndex((s) => s.requestIds.includes(countdownRow ?? ""));
  const dispositions = [...built.dispositions];
  if (countdownRow && countdownIndex >= 0) {
    dispositions.push({
      requestId: countdownRow,
      disposition: "question_pending",
      task: 0,
      subtask: countdownIndex,
      question: "When exactly should the countdown end?",
    });
  }
  const task: PlanTaskInput = {
    title: "Black Friday kampány anyagok",
    description: {
      summary:
        "Kovács Réka (Pragmatico) a Black Friday kampányhoz kér anyagokat jövő szerdáig: bannereket két méretben, " +
        "egy Instagram story méretet, egy visszaszámlálót a landing oldalra és egy hírlevelet a meglévő " +
        "feliratkozóknak. A 20% kedvezmény csak a webshopra vonatkozik — ezt a bannereken is jelezni kell. A brand " +
        "színeket PDF-ben csatolta (brand-szinek.pdf).",
      doneWhen: [
        "A bannerek elkészültek 1200×628 és 1080×1920 méretben, rajtuk a „csak a webshopra” jelzés",
        "A story méret elkészült az Instagramra",
        "A visszaszámláló fut a landing oldalon a megbeszélt lejáratig",
        "A hírlevél kiküldésre kész a meglévő feliratkozóknak",
      ],
      notes: ["Anyag: brand-szinek.pdf (Réka levelének melléklete)."],
    },
    ...(c.project ? { projectId: c.project._id } : {}),
    ...(client ? { clientId: client } : {}),
    assigneeIds: built.owners.slice(0, 3),
    subtasks: built.subtasks,
    fieldReasons: [
      ...(c.project ? [{ field: "projectId", reason: `The client's project: ${c.project.name}`, confidence: "sure" as const }] : []),
      { field: "assigneeIds", reason: "Everyone who owns a subtask", confidence: "sure" },
      ...built.reasons,
    ],
  };
  return {
    input: { grouping: "one", suggestedGrouping: "one", tasks: [task], dispositions },
    ...(countdownRow
      ? {
          question: {
            header: "Countdown",
            question: "When exactly should the countdown end?",
            why: "Réka wrote “péntek éjfélig”, but not which Friday or what time",
            options: [
              { label: "Friday 23:59", description: "Runs until the end of Black Friday", recommended: true, effect: "answer_here" },
              { label: "Ask Réka", description: "The kickoff email asks her", effect: "email_client" },
              { label: "I'll give the exact time", composerPrefix: "Countdown ends: " },
            ],
            requestId: countdownRow,
          },
        }
      : {}),
    summary: "One task with 5 subtasks. One question: when the countdown ends.",
  };
}

async function gaborPlan(c: Ctx, client: Id<"clients"> | undefined): Promise<CannedPlan | null> {
  const built = await buildSubtasks(c, [
    {
      title: "Téli kabát termékoldal: 8 999 Ft helyett 89 990 Ft legyen az ár, a kosárban is",
      snippet: "Élesben hibás az ár",
      categoryHints: DEV,
    },
  ]);
  if (built.subtasks.length === 0) return null;
  return {
    input: {
      grouping: "one",
      suggestedGrouping: "one",
      tasks: [
        {
          title: "Téli kabát hibás ár javítása a webshopban",
          description: {
            summary:
              "Nagy Gábor (Pragmatico) jelezte: élesben hibás az ár a Téli kabát termékoldalon, és a kosárba is a " +
              "hibás ár kerül. Már jött két rendelés ezen az áron; a terméket addig kivették a kampányból.",
            doneWhen: [
              "A termékoldalon és a kosárban is 89 990 Ft az ár",
              "Kiderült, miért jelent meg 8 999 Ft, és ez nem fordul elő más termékeknél",
            ],
            notes: ["Oldal: https://pragmatico.hu/termek/teli-kabat"],
          },
          ...(c.project ? { projectId: c.project._id } : {}),
          ...(client ? { clientId: client } : {}),
          assigneeIds: built.owners,
          priority: 1,
          subtasks: built.subtasks,
          fieldReasons: [
            { field: "priority", reason: "Live price bug — orders already came in at the wrong price", confidence: "sure" },
            ...built.reasons,
          ],
        },
      ],
      dispositions: built.dispositions,
    },
    summary: "One urgent task, due today.",
  };
}

function peterPlan(c: Ctx, forbidReply: boolean): CannedPlan | null {
  const row = rowFor(c, "Mikorra lesz kész");
  if (!row) return null;
  if (forbidReply) {
    return {
      input: {
        grouping: "one",
        suggestedGrouping: "one",
        tasks: [
          {
            title: "Őszi kampány aloldal – átadási időpont a kampányindításhoz",
            description: {
              summary:
                "Szabó Péter (Arlo) azt kérdezi, mikorra lesz kész az aloldal: a jövő heti kampányindításhoz kell tudniuk.",
              doneWhen: ["Péter megkapta a pontos átadási időpontot"],
            },
            assigneeIds: [c.auth.userId],
            subtasks: [
              {
                title: "Az aloldal átadási időpontjának egyeztetése a jövő heti kampányindításhoz",
                assigneeIds: [c.auth.userId],
                requestIds: [row._id],
              },
            ],
          },
        ],
        dispositions: [{ requestId: row._id, disposition: "covered", task: 0, subtask: 0 }],
      },
      summary: "One task, as you asked — the reply comes after Create.",
    };
  }
  return {
    input: {
      grouping: "one",
      suggestedGrouping: "one",
      tasks: [],
      dispositions: [{ requestId: row._id, disposition: "answered" }],
      replyInsteadOfTask: {
        reply: true,
        intent: "Tell Péter when the first version of the page is ready (the linked task's due date) and that we still wait for the texts.",
      },
    },
    summary: "No new work — a reply answers Péter's question.",
  };
}

async function juditPlan(c: Ctx): Promise<CannedPlan | null> {
  const built = await buildSubtasks(c, [
    {
      title: "Ajánlat előkészítése a Zöldkert Kft.-nek: kisebb webshop arculatfrissítés és havi hírlevél",
      snippet: "webshop arculatfrissítést",
      categoryHints: CONTENT,
    },
  ]);
  const call = rowFor(c, "rövid egyeztetést");
  const dispositions = [...built.dispositions];
  if (call) dispositions.push({ requestId: call._id, disposition: "answered" });
  if (built.subtasks.length === 0) return null;
  return {
    input: {
      grouping: "one",
      suggestedGrouping: "one",
      tasks: [
        {
          title: "Zöldkert Kft. – webshop arculatfrissítés és havi hírlevél (ajánlatkérés)",
          description: {
            summary:
              "Új érdeklődő: Molnár Judit (Zöldkert Kft.) a Pragmatico ajánlására keresett. Egy kisebb webshop " +
              "arculatfrissítést és havi hírlevelet szeretnének kiszervezni, és jövő hétre egy rövid egyeztetést kér.",
            doneWhen: ["Az egyeztetés időpontja egyeztetve", "Az ajánlat váza kész a hívásra"],
          },
          assigneeIds: built.owners,
          subtasks: built.subtasks,
          fieldReasons: built.reasons,
        },
      ],
      dispositions,
      newClient: { name: "Zöldkert Kft.", domain: "zoldkert.hu", contact: { name: "Molnár Judit", email: "judit@zoldkert.hu" } },
    },
    summary: "A new client (Zöldkert Kft.) and one task; the kickoff reply proposes the call.",
  };
}

/** The canned plan of a seeded conversation, or null for any other. */
export async function cannedPlanFor(
  ctx: MutationCtx,
  args: { auth: AuthContext; emailThread: Doc<"emailThreads">; item: Doc<"agentItems"> },
): Promise<CannedPlan | null> {
  const { auth, emailThread } = args;
  const c: Ctx = {
    ctx,
    auth,
    rows: await threadRequests(ctx, auth.orgId, emailThread._id),
    project: await clientProject(ctx, auth.orgId, emailThread.clientId),
    categories: (
      await ctx.db
        .query("workCategories")
        .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
        .take(100)
    ).filter((cat) => !cat.archivedAt),
  };
  switch (emailThread.gmailThreadId) {
    case "seed-reka-black-friday":
      return await rekaPlan(c, emailThread.clientId);
    case "seed-gabor-price-bug":
      return await gaborPlan(c, emailThread.clientId);
    case "seed-peter-question":
      return peterPlan(c, args.item.forbidReply === true);
    case "seed-judit-new-sender":
      return await juditPlan(c);
    default:
      return null;
  }
}

// ─── B6b: the canned change on a linked task ─────────────────────────────────

/**
 * The canned `proposeTaskUpdate` of a change item on a SEED mailbox: one new
 * subtask per new request (the client's words as the title — its
 * constraints verbatim), assigned to whoever owns the closest subtask; asks
 * become `answered`. Réka's follow-up gets the canvas title.
 */
export async function cannedChangeFor(
  ctx: MutationCtx,
  args: { auth: AuthContext; task: Doc<"tasks">; rows: readonly Doc<"clientRequests">[] },
): Promise<{ input: ChangeToolInput; summary: string } | null> {
  const { task } = args;
  const subs = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .take(100);
  const storyOwner = subs.find((s) => /story/i.test(s.title))?.assigneeIds[0];
  const owner = storyOwner ?? task.assigneeIds[0] ?? args.auth.userId;
  const addSubtasks: NonNullable<ChangeToolInput["addSubtasks"]> = [];
  const dispositions: NonNullable<ChangeToolInput["dispositions"]> = [];
  for (const row of args.rows) {
    if (row.disposition === "question_pending") {
      // Still waiting on the owner's question (its subtask exists, blocked) — not new work.
      dispositions.push({ requestId: row._id, disposition: "question_pending", question: row.planned?.question ?? "Waiting on the owner's answer" });
      continue;
    }
    if (row.intent === "ask") {
      dispositions.push({ requestId: row._id, disposition: "answered" });
      continue;
    }
    const title = /story méretet/i.test(row.text)
      ? "Story méret a Facebookra is, a Black Friday bannerek vizuáljával"
      : row.text.replace(/\s+/g, " ").trim();
    addSubtasks.push({ title, assigneeIds: [owner], requestIds: [row._id] });
  }
  if (addSubtasks.length === 0) return null;
  return {
    input: { task: task.identifier ?? task._id, addSubtasks, ...(dispositions.length > 0 ? { dispositions } : {}) },
    summary: `${addSubtasks.length === 1 ? "One new subtask" : `${addSubtasks.length} new subtasks`} on ${task.identifier ?? task.title}.`,
  };
}
