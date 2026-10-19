// Email triage B6a — the pure Triage plan logic (docs/prd-email-triage.md
// §6.1, D13, D25, I12): plan checks, due dates in code, the D13 description,
// the payload builder and the re-plan merge of owner edits.

import { describe, expect, it } from "vitest";
import {
  buildDescriptionDoc,
  buildPlanPayloads,
  checkPlan,
  checkPlanScope,
  containsVerbatim,
  defaultDueReason,
  phraseNotFoundReason,
  resolveDue,
  resolvePlanDues,
  type PlanLedgerRow,
  type PlanRefs,
  type TriagePlanInput,
} from "../plan";
import { zonedDateTimeToInstant } from "../../lib/workingDays";
import { mergeAgentRevision, type CreateTaskPayload } from "../../../lib/agents/proposals";

const TZ = "Europe/Budapest";
// Friday 2026-10-16 15:12 Budapest — Réka's email.
const FRIDAY_1512 = zonedDateTimeToInstant("2026-10-16", 15, 12, TZ);

const ROWS: PlanLedgerRow[] = [
  {
    id: "r_banner",
    text: "Bannerek két méretben: 1200×628 és 1080×1920.",
    disposition: "open",
    constraints: [
      { kind: "size", value: "1200×628" },
      { kind: "size", value: "1080×1920" },
    ],
    messageId: "m1",
  },
  {
    id: "r_story",
    text: "És még egy story méret is kellene az Instagramra.",
    disposition: "open",
    constraints: [{ kind: "platform", value: "Instagramra" }],
    messageId: "m1",
  },
  { id: "r_old", text: "Már lefedett kérés", disposition: "covered", constraints: [], messageId: "m0" },
];

const REFS: PlanRefs = {
  projects: new Map([["p1", "c1"]]),
  clients: new Set(["c1"]),
  users: new Set(["u_design", "u_dev"]),
  workCategories: new Set(["wc1"]),
  labels: new Set(),
  tasks: new Set(["t_old"]),
};

function plan(overrides: Partial<TriagePlanInput> = {}): TriagePlanInput {
  return {
    grouping: "one",
    suggestedGrouping: "one",
    tasks: [
      {
        title: "Black Friday kampány anyagok",
        description: { summary: "Réka kér anyagokat.", doneWhen: ["Minden méret kész"] },
        projectId: "p1",
        clientId: "c1",
        subtasks: [
          { title: "Bannerek 1200×628 és 1080×1920 méretben", assigneeIds: ["u_design"], requestIds: ["r_banner"], duePhrase: "jövő szerdáig" },
          { title: "Story méret az Instagramra", assigneeIds: ["u_design"], requestIds: ["r_story"] },
        ],
      },
    ],
    dispositions: [
      { requestId: "r_banner", disposition: "covered", subtask: 0 },
      { requestId: "r_story", disposition: "covered", subtask: 1 },
    ],
    ...overrides,
  };
}

describe("checkPlan", () => {
  it("accepts a complete plan", () => {
    expect(checkPlan(plan(), ROWS, REFS)).toEqual({ errors: [], gaps: [] });
  });

  it("a missing disposition is a gap (I12) — already resolved rows need none", () => {
    const input = plan({ dispositions: [{ requestId: "r_banner", disposition: "covered", subtask: 0 }] });
    const { errors, gaps } = checkPlan(input, ROWS, REFS);
    expect(errors).toEqual([]);
    expect(gaps).toEqual([expect.objectContaining({ kind: "missing_disposition", requestId: "r_story" })]);
  });

  it("a constraint not verbatim in the covering subtask title is a gap", () => {
    const input = plan();
    input.tasks[0].subtasks[0].title = "Bannerek 1200x628 és 1080 × 1920 méretben"; // x for ×, extra spaces
    const { gaps } = checkPlan(input, ROWS, REFS);
    expect(gaps.map((g) => [g.kind, g.requestId, g.detail.slice(0, 18)])).toEqual([
      ["constraint_not_in_title", "r_banner", 'size "1200×628" is'],
      ["constraint_not_in_title", "r_banner", 'size "1080×1920" i'],
    ]);
  });

  it("verbatim means normalised whitespace and case only", () => {
    expect(containsVerbatim("Story az  INSTAGRAMRA most", "instagramra most")).toBe(true);
    expect(containsVerbatim("1200 × 628", "1200×628")).toBe(false);
    expect(containsVerbatim("20 %", "20%")).toBe(false);
  });

  it("a link may sit in the description instead of the title", () => {
    const rows: PlanLedgerRow[] = [
      { id: "r_bug", text: "Hibás ár", disposition: "open", constraints: [{ kind: "link", value: "https://x.hu/a" }, { kind: "price", value: "8 999 Ft" }] },
    ];
    const input = plan({
      tasks: [
        {
          title: "Ár javítása",
          description: { summary: "Az oldal: https://x.hu/a", doneWhen: ["Jó az ár"] },
          subtasks: [{ title: "8 999 Ft helyett jó ár", assigneeIds: [], requestIds: ["r_bug"] }],
        },
      ],
      dispositions: [{ requestId: "r_bug", disposition: "covered", subtask: 0 }],
    });
    expect(checkPlan(input, rows, REFS)).toEqual({ errors: [], gaps: [] });
  });

  it("a bad id is an error, never a gap", () => {
    const input = plan();
    input.tasks[0].projectId = "p_foreign";
    input.tasks[0].subtasks[1].assigneeIds = ["u_ghost"];
    input.similarTaskIds = ["t_nope"];
    input.dispositions.push({ requestId: "r_other_thread", disposition: "dismissed", reason: "x" });
    const { errors, gaps } = checkPlan(input, ROWS, REFS);
    expect(gaps).toEqual([]);
    expect(errors.join("\n")).toMatch(/Unknown project "p_foreign"/);
    expect(errors.join("\n")).toMatch(/Unknown team member "u_ghost"/);
    expect(errors.join("\n")).toMatch(/Unknown task "t_nope"/);
    expect(errors.join("\n")).toMatch(/Unknown request "r_other_thread"/);
  });

  it("broken references and missing reasons are errors", () => {
    const input = plan({
      dispositions: [
        { requestId: "r_banner", disposition: "covered" },
        { requestId: "r_story", disposition: "dismissed" },
      ],
    });
    const { errors } = checkPlan(input, ROWS, REFS);
    expect(errors).toEqual([
      expect.stringMatching(/"covered" needs the covering subtask/),
      expect.stringMatching(/"dismissed" needs a reason/),
    ]);
    expect(checkPlan(plan({ dispositions: [{ requestId: "r_banner", disposition: "question_pending" }, { requestId: "r_story", disposition: "covered", subtask: 9 }] }), ROWS, REFS).errors).toEqual([
      expect.stringMatching(/needs the question/),
      expect.stringMatching(/no subtask 9/),
    ]);
  });

  it("grouping and reply shapes", () => {
    const two = plan();
    two.tasks.push({ ...two.tasks[0] });
    expect(checkPlan(two, ROWS, REFS).errors).toEqual([expect.stringMatching(/grouping "one" means exactly one task/)]);
    const reply = plan({
      tasks: [],
      dispositions: [
        { requestId: "r_banner", disposition: "answered" },
        { requestId: "r_story", disposition: "answered" },
      ],
      replyInsteadOfTask: { reply: true, intent: "Answer" },
    });
    expect(checkPlan(reply, ROWS, REFS)).toEqual({ errors: [], gaps: [] });
    expect(checkPlan(plan({ tasks: [], dispositions: [] }), ROWS, REFS).errors).toEqual([expect.stringMatching(/at least one task/)]);
  });
});

describe("due dates (§6.1)", () => {
  const messages = [{ id: "m1", text: "Jövő szerdáig kellene a Black Friday kampányhoz pár dolog", sentAt: FRIDAY_1512 }];
  const base = { messages, arrivalMs: FRIDAY_1512, nowMs: FRIDAY_1512 + 60_000, tz: TZ };

  it("a date stated in the email wins, resolved by code against the message's arrival", () => {
    expect(resolveDue({ ...base, phrase: "jövő szerdáig", urgent: true })).toEqual({
      date: "2026-10-21",
      source: "email",
      phrase: "jövő szerdáig",
      reason: 'From the email: "jövő szerdáig"',
    });
  });

  it("a phrase that is not in the email does not count", () => {
    expect(resolveDue({ ...base, phrase: "holnap", urgent: false }).source).toBe("default");
  });

  it("urgent → today", () => {
    expect(resolveDue({ ...base, urgent: true, nowMs: zonedDateTimeToInstant("2026-10-19", 9, 0, TZ) })).toMatchObject({
      date: "2026-10-19",
      source: "urgent",
    });
  });

  it("default: 2 working days from a Friday afternoon → Tuesday, with the reason line", () => {
    expect(resolveDue({ ...base, urgent: false })).toEqual({
      date: "2026-10-20",
      source: "default",
      reason: "No deadline in the email — default 2 working days",
    });
    expect(resolveDue({ ...base, urgent: false, defaultWorkingDays: 3 }).date).toBe("2026-10-21");
    expect(defaultDueReason(1)).toBe("No deadline in the email — default 1 working day");
  });

  it("the task's due is its latest subtask's due", () => {
    const dues = resolvePlanDues({ tasks: plan().tasks, messages, rows: ROWS, urgent: false, nowMs: FRIDAY_1512, tz: TZ });
    expect(dues[0].subtasks.map((s) => [s.date, s.source])).toEqual([
      ["2026-10-21", "email"],
      ["2026-10-20", "default"],
    ]);
    expect(dues[0].dueDate).toBe("2026-10-21");
  });
});

describe("payloads + description (D13)", () => {
  it("builds the createTask payload with code dues, requests, reasons and grouping", () => {
    const input = plan();
    const messages = [{ id: "m1", text: "Jövő szerdáig kellene", sentAt: FRIDAY_1512 }];
    const dues = resolvePlanDues({ tasks: input.tasks, messages, rows: ROWS, urgent: false, nowMs: FRIDAY_1512, tz: TZ });
    const [payload] = buildPlanPayloads({ input, dues, source: { threadId: "th1", messageId: "m1" }, planId: "plan_x" });
    expect(payload).toMatchObject({
      kind: "createTask",
      title: "Black Friday kampány anyagok",
      projectId: "p1",
      clientId: "c1",
      dueDate: "2026-10-21",
      subtasks: [
        { title: "Bannerek 1200×628 és 1080×1920 méretben", dueDate: "2026-10-21", requestIds: ["r_banner"] },
        { title: "Story méret az Instagramra", dueDate: "2026-10-20", requestIds: ["r_story"] },
      ],
      source: { kind: "email", threadId: "th1", messageId: "m1", requestIds: ["r_banner", "r_story"] },
      grouping: { planId: "plan_x", index: 1, count: 1, mode: "one", suggested: "one" },
    });
    expect(payload.fieldReasons?.["subtasks.1.dueDate"]).toEqual({
      reason: "No deadline in the email — default 2 working days",
      confidence: "unsure",
    });
    expect(payload.fieldReasons?.dueDate?.reason).toBe("The latest subtask due date");
  });

  it("a short paragraph, a bold 'Kész, ha:' line and the bullet list", () => {
    const doc = JSON.parse(buildDescriptionDoc({ summary: "Cél.\n\nKontextus.", doneWhen: ["A", " ", "B"], notes: ["Anyag: x.pdf"] }));
    expect(doc.content.map((n: { type: string }) => n.type)).toEqual(["paragraph", "paragraph", "paragraph", "bulletList", "paragraph"]);
    expect(doc.content[2].content[0]).toEqual({ type: "text", text: "Kész, ha:", marks: [{ type: "bold" }] });
    expect(doc.content[3].content).toHaveLength(2);
    expect(JSON.parse(buildDescriptionDoc({ summary: "x", doneWhen: ["y"] }, "English")).content[1].content[0].text).toBe("Done when:");
  });
});

describe("mergeAgentRevision (D25)", () => {
  const previous: CreateTaskPayload = {
    kind: "createTask",
    title: "Black Friday",
    assigneeIds: ["u1"],
    dueDate: "2026-10-21",
    subtasks: [
      { title: "Bannerek", assigneeIds: ["u1"], requestIds: ["r1"] },
      { title: "Hírlevél", assigneeIds: ["u1"], requestIds: ["r2"] },
    ],
  };

  it("keeps owner edits unless the field is in changedByNewEmail", () => {
    const edited: CreateTaskPayload = { ...previous, title: "BF anyagok (owner)", assigneeIds: ["u2"] };
    const next: CreateTaskPayload = { ...previous, title: "Black Friday v2", assigneeIds: ["u3"], dueDate: "2026-10-22" };
    expect(mergeAgentRevision({ previous, edited, next, changedFields: [] })).toMatchObject({
      title: "BF anyagok (owner)",
      assigneeIds: ["u2"],
      dueDate: "2026-10-22", // not edited by the owner → the agent's new value
    });
    expect(mergeAgentRevision({ previous, edited, next, changedFields: ["title"] })).toMatchObject({
      title: "Black Friday v2",
      assigneeIds: ["u2"],
    });
    // Every owner edit overridden → nothing survives → no editedPayload.
    expect(mergeAgentRevision({ previous, edited, next, changedFields: ["title", "assigneeIds"] })).toBeUndefined();
    expect(mergeAgentRevision({ previous, edited: undefined, next, changedFields: [] })).toBeUndefined();
  });

  it("merges subtasks one by one: owner-edited, owner-deleted, owner-added and new ones", () => {
    const edited: CreateTaskPayload = {
      ...previous,
      subtasks: [
        { title: "Bannerek (owner wording)", assigneeIds: ["u9"], requestIds: ["r1"] },
        // r2 deleted by the owner
        { title: "Owner's own subtask", assigneeIds: [] },
      ],
    };
    const next: CreateTaskPayload = {
      ...previous,
      subtasks: [
        { title: "Bannerek 1200×628", assigneeIds: ["u1"], requestIds: ["r1"] },
        { title: "Hírlevél v2", assigneeIds: ["u1"], requestIds: ["r2"] },
        { title: "Story méret (new email)", assigneeIds: ["u1"], requestIds: ["r3"] },
      ],
    };
    const merged = mergeAgentRevision({ previous, edited, next, changedFields: [] });
    expect(merged && merged.kind === "createTask" ? merged.subtasks?.map((s) => s.title) : null).toEqual([
      "Bannerek (owner wording)",
      "Story méret (new email)",
      "Owner's own subtask",
    ]);
    // `subtasks.0` (index in the new list): the new email changed that one.
    const forced = mergeAgentRevision({ previous, edited, next, changedFields: ["subtasks.0"] });
    expect(forced && forced.kind === "createTask" ? forced.subtasks?.[0].title : null).toBe("Bannerek 1200×628");
    // `subtasks`: the agent's whole list.
    expect(mergeAgentRevision({ previous, edited, next, changedFields: ["subtasks"] })).toBeUndefined();
  });
});

describe("gate review (B6a)", () => {
  it("numeric constraint values need token boundaries", () => {
    expect(containsVerbatim("a 120% kedvezmény", "20%")).toBe(false);
    expect(containsVerbatim("a 20% kedvezmény", "20%")).toBe(true);
    expect(containsVerbatim("(20%)", "20%")).toBe(true);
    expect(containsVerbatim("11200×628", "1200×628")).toBe(false);
    expect(containsVerbatim("1200×6280", "1200×628")).toBe(false);
    expect(containsVerbatim("méret: 1200×628, jövő szerdáig", "1200×628")).toBe(true);
    // A later boundary-respecting occurrence still counts.
    expect(containsVerbatim("120% és 20%", "20%")).toBe(true);
    // Words without digits keep plain containment.
    expect(containsVerbatim("az Instagramra", "Instagram")).toBe(true);
    const rows: PlanLedgerRow[] = [{ id: "r", text: "20%", disposition: "open", constraints: [{ kind: "discount", value: "20%" }] }];
    const input = plan({
      tasks: [{ title: "T", description: { summary: "s", doneWhen: ["d"] }, subtasks: [{ title: "A 120% jelzés a bannereken", assigneeIds: [], requestIds: ["r"] }] }],
      dispositions: [{ requestId: "r", disposition: "covered", subtask: 0 }],
    });
    expect(checkPlan(input, rows, REFS).gaps.map((g) => g.kind)).toEqual(["constraint_not_in_title"]);
  });

  it("a phrase not in the email says so; a task without subtasks dates from its own rows", () => {
    const messages = [
      { id: "m_old", text: "Régi levél", sentAt: FRIDAY_1512 - 7 * 86_400_000 },
      { id: "m1", text: "Új levél", sentAt: FRIDAY_1512 },
    ];
    expect(resolveDue({ phrase: "holnapután", messages, arrivalMs: FRIDAY_1512, urgent: false, nowMs: FRIDAY_1512, tz: TZ }).reason).toBe(
      phraseNotFoundReason(2),
    );
    expect(phraseNotFoundReason(2)).toBe("The deadline phrase wasn't found in the email — default 2 working days");
    const rows: PlanLedgerRow[] = [
      { id: "r_old", text: "x", disposition: "open", constraints: [], messageId: "m_old" },
      { id: "r_new", text: "y", disposition: "open", constraints: [], messageId: "m1" },
    ];
    const tasks = [{ title: "T", description: { summary: "s", doneWhen: ["d"] }, subtasks: [] }];
    const dues = resolvePlanDues({
      tasks,
      dispositions: [{ requestId: "r_old", disposition: "covered" }],
      messages,
      rows,
      urgent: false,
      nowMs: FRIDAY_1512,
      tz: TZ,
    });
    // From r_old's message (a week earlier, Friday) + 2 working days → that Tuesday.
    expect(dues[0].dueDate).toBe("2026-10-13");
  });

  it("subtasks pair on overlapping requests: the owner's assignee stays, the new request is added", () => {
    const previous: CreateTaskPayload = {
      kind: "createTask",
      title: "T",
      subtasks: [
        { title: "Bannerek 1200×628", assigneeIds: ["u1"], requestIds: ["r1"] },
        { title: "Visszaszámláló", assigneeIds: ["u1"], requestIds: ["r3"] },
      ],
    };
    const edited: CreateTaskPayload = {
      ...previous,
      subtasks: [{ ...previous.subtasks![0], assigneeIds: ["u9"] }, previous.subtasks![1]],
    };
    const next: CreateTaskPayload = {
      ...previous,
      subtasks: [
        { title: "Bannerek 1200×628 és 1080×1920", assigneeIds: ["u1"], requestIds: ["r1", "r2"] },
        // The countdown question was answered: same subtask, its request now covered.
        { title: "Visszaszámláló péntek 23:59-ig", assigneeIds: ["u1"], requestIds: ["r3"] },
      ],
    };
    const merged = mergeAgentRevision({ previous, edited, next, changedFields: [] });
    if (merged?.kind !== "createTask") throw new Error("owner edits should survive");
    expect(merged.subtasks).toEqual([
      { title: "Bannerek 1200×628 és 1080×1920", assigneeIds: ["u9"], requestIds: ["r1", "r2"] },
      { title: "Visszaszámláló péntek 23:59-ig", assigneeIds: ["u1"], requestIds: ["r3"] },
    ]);
  });

  it("checkPlanScope: client scope and the newClient rules", () => {
    const scope = {
      threadClientId: "c1",
      newClientAllowed: false,
      senderEmails: ["reka@pragmatico.hu"],
      blockedDomain: (d: string) => d === "gmail.com",
    };
    const p = plan();
    expect(checkPlanScope(p, scope, REFS)).toEqual([]);
    expect(checkPlanScope(plan({ tasks: [{ ...p.tasks[0], clientId: "c2" }] }), scope, REFS)).toEqual([expect.stringMatching(/clientId must be/)]);
    const unknown = { ...scope, threadClientId: undefined, newClientAllowed: true, senderEmails: ["judit@zoldkert.hu"] };
    const nc = (domain: string, email: string) => plan({ newClient: { name: "Z", domain, contact: { name: "J", email } } });
    expect(checkPlanScope(nc("zoldkert.hu", "Judit@zoldkert.hu"), unknown, REFS)).toEqual([]);
    expect(checkPlanScope(nc("other.hu", "judit@zoldkert.hu"), unknown, REFS)).toEqual([expect.stringMatching(/not the domain of a sender/)]);
    expect(checkPlanScope(nc("gmail.com", "judit@gmail.com"), { ...unknown, senderEmails: ["judit@gmail.com"] }, REFS)).toEqual([
      expect.stringMatching(/free-mail or ignored/),
    ]);
    expect(checkPlanScope(nc("zoldkert.hu", "judit@zoldkert.hu"), scope, REFS)).toEqual([expect.stringMatching(/only for an unknown sender/)]);
  });
});
