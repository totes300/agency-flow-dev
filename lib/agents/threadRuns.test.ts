import { describe, expect, it } from "vitest";
import { backgroundJobPrompts, runAnchor, runAt, type RunWindow } from "./threadRuns";

const run = (over: Partial<RunWindow> & { id: string; startedAt: number }): RunWindow => ({
  status: "succeeded",
  finishedAt: null,
  job: null,
  via: "user",
  answersQuestion: false,
  started: true,
  promptMessageId: null,
  ...over,
});

describe("runAt", () => {
  const runs = [
    run({ id: "chat", startedAt: 100, finishedAt: 200 }),
    run({ id: "job", startedAt: 300, finishedAt: 500, job: "prepareTask", via: "background" }),
    run({ id: "live", startedAt: 600, status: "running" }),
    run({ id: "queued", startedAt: 700, status: "queued" }),
  ];
  it("finds the run whose window holds the message", () => {
    expect(runAt(runs, 150)?.id).toBe("chat");
    expect(runAt(runs, 300)?.id).toBe("job");
    expect(runAt(runs, 500)?.id).toBe("job");
    expect(runAt(runs, 900)?.id).toBe("live"); // a live run has no end yet; a queued one never ran
  });
  it("a message between runs belongs to none", () => {
    expect(runAt(runs, 250)).toBeNull();
    expect(runAt(runs, 50)).toBeNull();
  });
});

describe("backgroundJobPrompts", () => {
  const runs = [
    run({ id: "chat", startedAt: 100, finishedAt: 200, promptMessageId: "u1" }), // a typed chat turn
    run({ id: "job", startedAt: 300, finishedAt: 500, job: "prepareTask", via: "background", promptMessageId: "p1" }),
    // A question answer continuing the job (A5): its prompt IS the answer.
    run({ id: "answer", startedAt: 600, finishedAt: 700, job: "prepareTask", via: "background", answersQuestion: true, promptMessageId: "ans" }),
    run({ id: "job2", startedAt: 800, job: "draftReply", via: "background", status: "running", promptMessageId: "p3" }),
  ];
  it("hides exactly the background job prompts it recorded — never a person's turn", () => {
    expect([...backgroundJobPrompts(runs)].sort()).toEqual(["p1", "p3"]);
  });
  it("an interactive job run (a typed instruction) keeps its user turn", () => {
    const typed = [run({ id: "j", startedAt: 300, job: "prepareTask", via: "user", promptMessageId: "t" })];
    expect(backgroundJobPrompts(typed).size).toBe(0);
  });
  it("timestamps play no part: prompts stamped AFTER their run's start (a claimed queued job) are still hidden", () => {
    // Real ordering: each prompt's _creationTime lands after its startedAt —
    // the window heuristic hid the PREVIOUS run's prompt instead.
    const real = [
      run({ id: "plan", startedAt: 1_000, finishedAt: 1_900, job: "prepareTask", via: "background", promptMessageId: "plan-prompt" }),
      run({ id: "draft", startedAt: 2_000, finishedAt: 2_400, job: "draftReply", via: "background", promptMessageId: "draft-prompt" }),
    ];
    expect([...backgroundJobPrompts(real)].sort()).toEqual(["draft-prompt", "plan-prompt"]);
  });
  it("a row from before promptMessageId hides nothing", () => {
    expect(backgroundJobPrompts([run({ id: "old", startedAt: 1, job: "prepareTask", via: "background" })]).size).toBe(0);
  });
});

describe("runAnchor", () => {
  it("sorts a run's lines at or after its prompt", () => {
    const times = new Map([["ans", 650]]);
    expect(runAnchor({ startedAt: 600, promptMessageId: "ans" }, times)).toBe(650);
    expect(runAnchor({ startedAt: 600, promptMessageId: "gone" }, times)).toBe(600);
    expect(runAnchor({ startedAt: 700, promptMessageId: "ans" }, times)).toBe(700);
    expect(runAnchor({ startedAt: 600, promptMessageId: null }, times)).toBe(600);
  });
});

describe("runs that never started", () => {
  it("a dead queued job (cancelled while queued / refused at claim) never captures the live chat run's messages", () => {
    const runs = [
      run({ id: "chat", startedAt: 100, status: "running" }),
      run({ id: "dead", startedAt: 150, finishedAt: 160, status: "cancelled", job: "prepareTask", via: "background", started: false }),
      run({ id: "refused", startedAt: 152, finishedAt: 158, status: "failed", job: "draftReply", via: "background", started: false }),
    ];
    expect(runAt(runs, 155)?.id).toBe("chat");
    expect(backgroundJobPrompts(runs).size).toBe(0);
  });
});
