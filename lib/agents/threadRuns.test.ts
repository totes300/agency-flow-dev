import { describe, expect, it } from "vitest";
import { backgroundJobPrompts, runAt, type RunWindow } from "./threadRuns";

const run = (over: Partial<RunWindow> & { id: string; startedAt: number }): RunWindow => ({
  status: "succeeded",
  finishedAt: null,
  job: null,
  via: "user",
  answersQuestion: false,
  started: true,
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
  const messages = [
    { key: "u1", role: "user", at: 90 }, // a typed chat turn
    { key: "a1", role: "assistant", at: 120 },
    { key: "p1", role: "user", at: 299 }, // the job's machine prompt
    { key: "a2", role: "assistant", at: 320 },
    { key: "ans", role: "user", at: 599 }, // a question answer
    { key: "p3", role: "user", at: 801 }, // a claimed queued job: stamped just after start
  ];
  const runs = [
    run({ id: "chat", startedAt: 100, finishedAt: 200 }),
    run({ id: "job", startedAt: 300, finishedAt: 500, job: "prepareTask", via: "background" }),
    run({ id: "answer", startedAt: 600, finishedAt: 700, job: "prepareTask", via: "user", answersQuestion: true }),
    run({ id: "job2", startedAt: 800, job: "draftReply", via: "background", status: "running" }),
  ];
  it("hides only a background job's prompt — never a person's turn", () => {
    expect([...backgroundJobPrompts(messages, runs)].sort()).toEqual(["p1", "p3"]);
  });
  it("an interactive job run (a typed instruction) keeps its user turn", () => {
    const typed = [run({ id: "j", startedAt: 300, job: "prepareTask", via: "user" })];
    expect(backgroundJobPrompts([{ key: "t", role: "user", at: 299 }], typed).size).toBe(0);
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
    expect(backgroundJobPrompts([{ key: "typed", role: "user", at: 99 }], runs).size).toBe(0);
  });
});
