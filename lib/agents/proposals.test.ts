import { describe, expect, it } from "vitest";
import {
  AGENT_PROPOSALS_MARKER,
  commentTextToTiptapDoc,
  isProposalRefsOutput,
  mergeEditedPayload,
  plainTextToTiptapDoc,
  PROPOSAL_KIND_META,
  validateProposalPayload,
  type ArchiveTaskPayload,
  type CreateTaskPayload,
} from "./proposals";

describe("validateProposalPayload — createTask", () => {
  it("accepts a full valid payload and trims strings", () => {
    const result = validateProposalPayload({
      kind: "createTask",
      title: "  Fix the header  ",
      description: "Details here",
      projectId: "p1",
      assigneeIds: ["u1", "u2"],
      workCategoryId: "wc1",
      dueDate: "2026-07-20",
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "createTask",
        title: "Fix the header",
        description: "Details here",
        projectId: "p1",
        assigneeIds: ["u1", "u2"],
        workCategoryId: "wc1",
        dueDate: "2026-07-20",
      },
    });
  });

  it("dedupes assignees, drops empties, and folds the legacy assigneeId field", () => {
    expect(
      validateProposalPayload({
        kind: "createTask",
        title: "T",
        assigneeIds: ["u1", "u1", " ", "u2"],
        assigneeId: "u3",
      }),
    ).toEqual({
      ok: true,
      payload: { kind: "createTask", title: "T", assigneeIds: ["u1", "u2", "u3"] },
    });
    // Legacy-only rows (pre-multi-assignee) keep their assignee.
    expect(
      validateProposalPayload({ kind: "createTask", title: "T", assigneeId: "u1" }),
    ).toEqual({
      ok: true,
      payload: { kind: "createTask", title: "T", assigneeIds: ["u1"] },
    });
  });

  it("rejects non-array / non-string assignee shapes", () => {
    expect(
      validateProposalPayload({ kind: "createTask", title: "T", assigneeIds: "u1" }),
    ).toMatchObject({ ok: false, reason: "assigneeIds must be an array" });
    expect(
      validateProposalPayload({ kind: "createTask", title: "T", assigneeIds: [1] }),
    ).toMatchObject({ ok: false, reason: "assigneeIds must contain strings" });
  });

  it("accepts a minimal payload (title only) and drops empty optionals", () => {
    const result = validateProposalPayload({
      kind: "createTask",
      title: "Do the thing",
      description: "   ",
      projectId: "",
      dueDate: undefined,
    });
    expect(result).toEqual({
      ok: true,
      payload: { kind: "createTask", title: "Do the thing" },
    });
  });

  it("rejects a missing/blank title", () => {
    expect(validateProposalPayload({ kind: "createTask" })).toMatchObject({
      ok: false,
      reason: "Task title is required",
    });
    expect(
      validateProposalPayload({ kind: "createTask", title: "   " }),
    ).toMatchObject({ ok: false });
  });

  it("rejects an overlong title", () => {
    expect(
      validateProposalPayload({ kind: "createTask", title: "x".repeat(501) }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("500") });
  });

  it("rejects a malformed due date", () => {
    expect(
      validateProposalPayload({
        kind: "createTask",
        title: "T",
        dueDate: "July 20",
      }),
    ).toMatchObject({ ok: false, reason: "Due date must be YYYY-MM-DD" });
    expect(
      validateProposalPayload({
        kind: "createTask",
        title: "T",
        dueDate: "2026-7-2",
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects non-string field types instead of coercing", () => {
    expect(
      validateProposalPayload({ kind: "createTask", title: "T", dueDate: 20260720 }),
    ).toMatchObject({ ok: false, reason: "dueDate must be a string" });
  });
});

describe("validateProposalPayload — archiveTask", () => {
  it("accepts a task reference and defaults the title snapshot", () => {
    expect(
      validateProposalPayload({ kind: "archiveTask", taskId: "t1" }),
    ).toEqual({
      ok: true,
      payload: { kind: "archiveTask", taskId: "t1", taskTitle: "" },
    });
  });

  it("rejects a missing taskId", () => {
    expect(validateProposalPayload({ kind: "archiveTask" })).toMatchObject({
      ok: false,
      reason: "taskId is required",
    });
  });
});

describe("validateProposalPayload — kind gate", () => {
  it("rejects unknown kinds and non-objects", () => {
    expect(validateProposalPayload({ kind: "closePeriod" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("closePeriod"),
    });
    expect(validateProposalPayload(null)).toMatchObject({ ok: false });
    expect(validateProposalPayload("createTask")).toMatchObject({ ok: false });
  });
});

describe("mergeEditedPayload", () => {
  const original: CreateTaskPayload = {
    kind: "createTask",
    title: "Original",
    description: "Keep me",
    assigneeIds: ["u1"],
  };

  it("returns the original when there are no edits", () => {
    expect(mergeEditedPayload(original, undefined)).toBe(original);
  });

  it("applies whitelisted edits only", () => {
    const merged = mergeEditedPayload(original, {
      title: "Edited",
      dueDate: "2026-08-01",
      workCategoryId: "wc1",
      // Not whitelisted — must be ignored, never smuggled into the payload.
      kind: "archiveTask",
      status: "approved",
      orgId: "evil",
    });
    expect(merged).toEqual({
      kind: "createTask",
      title: "Edited",
      description: "Keep me",
      assigneeIds: ["u1"],
      workCategoryId: "wc1",
      dueDate: "2026-08-01",
    });
  });

  it("clears a field when the edit sets it empty (unassign = empty array)", () => {
    const merged = mergeEditedPayload(original, { assigneeIds: [] });
    expect(merged).toEqual({
      kind: "createTask",
      title: "Original",
      description: "Keep me",
    });
  });

  it("ignores every edit on a kind with no editable fields", () => {
    const archive: ArchiveTaskPayload = {
      kind: "archiveTask",
      taskId: "t1",
      taskTitle: "Old task",
    };
    expect(
      mergeEditedPayload(archive, { taskId: "t2", taskTitle: "Hacked" }),
    ).toEqual(archive);
  });

  it("merged output still passes validation (title edit)", () => {
    const merged = mergeEditedPayload(original, { title: "Still valid" });
    expect(validateProposalPayload(merged)).toMatchObject({ ok: true });
  });

  it("clearing the title yields a payload that fails validation", () => {
    const merged = mergeEditedPayload(original, { title: "" });
    expect(validateProposalPayload(merged)).toMatchObject({
      ok: false,
      reason: "Task title is required",
    });
  });
});

describe("PROPOSAL_KIND_META (kind → behavior mapping)", () => {
  it("createTask commits as a member-approvable, non-destructive kind", () => {
    expect(PROPOSAL_KIND_META.createTask).toMatchObject({
      destructive: false,
      approveScope: "member",
    });
  });

  it("archiveTask is destructive and admin-only at approve time", () => {
    expect(PROPOSAL_KIND_META.archiveTask).toMatchObject({
      destructive: true,
      approveScope: "admin",
    });
  });

  it("destructive kinds expose no inline-editable fields", () => {
    for (const meta of Object.values(PROPOSAL_KIND_META)) {
      if (meta.destructive) expect(meta.editableFields).toHaveLength(0);
    }
  });
});

describe("isProposalRefsOutput", () => {
  it("accepts the marker envelope with string ids", () => {
    expect(
      isProposalRefsOutput({
        block: AGENT_PROPOSALS_MARKER,
        proposalIds: ["a", "b"],
      }),
    ).toBe(true);
  });

  it("rejects wrong markers, empty batches and non-string ids", () => {
    expect(isProposalRefsOutput({ block: "x", proposalIds: ["a"] })).toBe(false);
    expect(
      isProposalRefsOutput({ block: AGENT_PROPOSALS_MARKER, proposalIds: [] }),
    ).toBe(false);
    expect(
      isProposalRefsOutput({ block: AGENT_PROPOSALS_MARKER, proposalIds: [1] }),
    ).toBe(false);
    expect(isProposalRefsOutput(null)).toBe(false);
    expect(isProposalRefsOutput("proposals")).toBe(false);
  });
});

describe("plainTextToTiptapDoc", () => {
  it("wraps a single line into one paragraph", () => {
    expect(JSON.parse(plainTextToTiptapDoc("Hello"))).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });
  });

  it("splits lines into paragraphs; blank lines become empty paragraphs", () => {
    expect(JSON.parse(plainTextToTiptapDoc("A\r\n\nB"))).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    });
  });
});

// ─── A4 kinds (S2) ──────────────────────────────────────────────────────────

describe("validateProposalPayload — createTask extensions", () => {
  it("normalizes sub-tasks, priority, labels, source, reasons and grouping", () => {
    const result = validateProposalPayload({
      kind: "createTask",
      title: "Landing page",
      descriptionJson: JSON.stringify({ type: "doc", content: [] }),
      priority: 2,
      labelIds: ["l1", "l1", " "],
      statusId: "s1",
      subtasks: [
        { title: " Hero ", assigneeIds: ["u1", "u1"], dueDate: "2026-10-24", requestIds: [] },
        { title: "Footer", assigneeIds: [] },
      ],
      source: { kind: "email", threadId: "th", messageId: "m", requestIds: ["r1"] },
      fieldReasons: { dueDate: { reason: "Friday", confidence: "unsure" }, title: { reason: "  " } },
      grouping: { planId: "p", index: 1, count: 2 },
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "createTask",
        title: "Landing page",
        descriptionJson: JSON.stringify({ type: "doc", content: [] }),
        statusId: "s1",
        priority: 2,
        labelIds: ["l1"],
        subtasks: [
          { title: "Hero", assigneeIds: ["u1"], dueDate: "2026-10-24" },
          { title: "Footer", assigneeIds: [] },
        ],
        source: { kind: "email", threadId: "th", messageId: "m", requestIds: ["r1"] },
        fieldReasons: { dueDate: { reason: "Friday", confidence: "unsure" } },
        grouping: { planId: "p", index: 1, count: 2 },
      },
    });
  });

  it("rejects bad sub-tasks, priorities, descriptionJson and grouping", () => {
    const bad = (extra: Record<string, unknown>) =>
      validateProposalPayload({ kind: "createTask", title: "T", ...extra });
    expect(bad({ subtasks: [{ title: " ", assigneeIds: [] }] })).toMatchObject({ ok: false, reason: "Subtask title is required" });
    expect(bad({ subtasks: [{ title: "x", assigneeIds: [], dueDate: "soon" }] })).toMatchObject({ ok: false });
    expect(bad({ priority: 7 })).toMatchObject({ ok: false });
    expect(bad({ descriptionJson: "not json" })).toMatchObject({ ok: false });
    expect(bad({ descriptionJson: JSON.stringify({ type: "paragraph" }) })).toMatchObject({ ok: false });
    expect(bad({ grouping: { planId: "p", index: 3, count: 2 } })).toMatchObject({ ok: false });
    expect(bad({ source: { kind: "email", threadId: "t" } })).toMatchObject({ ok: false });
  });
});

describe("validateProposalPayload — updateTask", () => {
  it("keeps only real changes; null clears a due date / category", () => {
    expect(
      validateProposalPayload({
        kind: "updateTask",
        taskId: " t1 ",
        changes: { dueDate: null, workCategoryId: "", assigneeIds: ["u1"], priority: 0 },
        subtasks: {
          add: [{ title: "New", assigneeIds: [] }],
          amend: [{ subtaskId: "s1", title: "Renamed" }],
          cancel: [{ subtaskId: "s2", reason: "Dropped" }],
          tick: [{ subtaskId: "s3" }],
        },
      }),
    ).toEqual({
      ok: true,
      payload: {
        kind: "updateTask",
        taskId: "t1",
        changes: { dueDate: null, workCategoryId: null, assigneeIds: ["u1"], priority: 0 },
        subtasks: {
          add: [{ title: "New", assigneeIds: [] }],
          amend: [{ subtaskId: "s1", title: "Renamed" }],
          cancel: [{ subtaskId: "s2", reason: "Dropped" }],
          tick: [{ subtaskId: "s3" }],
        },
      },
    });
  });

  it("rejects an empty change, a sub-task in two ops, and statusId + reopen together", () => {
    expect(validateProposalPayload({ kind: "updateTask", taskId: "t", changes: {} })).toMatchObject({
      ok: false, reason: "The proposal changes nothing",
    });
    expect(
      validateProposalPayload({
        kind: "updateTask", taskId: "t", subtasks: { tick: [{ subtaskId: "s" }], cancel: [{ subtaskId: "s" }] },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateProposalPayload({ kind: "updateTask", taskId: "t", changes: { statusId: "a" }, reopen: { statusId: "b" } }),
    ).toMatchObject({ ok: false });
    expect(validateProposalPayload({ kind: "updateTask", changes: { title: "x" } })).toMatchObject({
      ok: false, reason: "taskId is required",
    });
  });
});

describe("validateProposalPayload — postComment / proposeSkill", () => {
  it("requires a comment body and trims it", () => {
    expect(validateProposalPayload({ kind: "postComment", taskId: "t", body: "  Hi  " })).toEqual({
      ok: true, payload: { kind: "postComment", taskId: "t", body: "Hi" },
    });
    expect(validateProposalPayload({ kind: "postComment", taskId: "t", body: " " })).toMatchObject({ ok: false });
  });

  it("pairs scope and client and keeps non-empty evidence", () => {
    expect(
      validateProposalPayload({
        kind: "proposeSkill", name: "N", instruction: "I", scope: "global", clientId: "c", evidence: ["a", " "],
      }),
    ).toEqual({ ok: true, payload: { kind: "proposeSkill", name: "N", instruction: "I", scope: "global", evidence: ["a"] } });
    expect(
      validateProposalPayload({ kind: "proposeSkill", name: "N", instruction: "I", scope: "client", evidence: [] }),
    ).toMatchObject({ ok: false, reason: "A client skill needs a client" });
  });
});

describe("A4 kind metadata + merge", () => {
  it("proposeSkill is admin-approved; the change kinds are member-approvable", () => {
    expect(PROPOSAL_KIND_META.proposeSkill.approveScope).toBe("admin");
    expect(PROPOSAL_KIND_META.updateTask.approveScope).toBe("member");
    expect(PROPOSAL_KIND_META.postComment.approveScope).toBe("member");
  });

  it("replaces sub-tasks as a whole and removes them when emptied", () => {
    const original: CreateTaskPayload = {
      kind: "createTask",
      title: "T",
      subtasks: [
        { title: "A", assigneeIds: [] },
        { title: "B", assigneeIds: [] },
      ],
      source: { kind: "agentThread", agentThreadId: "x" },
    };
    expect(mergeEditedPayload(original, { subtasks: [{ title: "B", assigneeIds: [] }] })).toEqual({
      ...original,
      subtasks: [{ title: "B", assigneeIds: [] }],
    });
    // source is agent-owned — not editable.
    expect(mergeEditedPayload(original, { subtasks: [], source: null })).toEqual({
      kind: "createTask", title: "T", source: { kind: "agentThread", agentThreadId: "x" },
    });
  });
});

describe("description edits vs descriptionJson (L2)", () => {
  const rich: CreateTaskPayload = {
    kind: "createTask",
    title: "T",
    description: "Agent text",
    descriptionJson: JSON.stringify({ type: "doc", content: [] }),
  };

  it("a typed description drops the agent's TipTap JSON so the typed text wins", () => {
    expect(mergeEditedPayload(rich, { description: "Typed by me" })).toEqual({
      kind: "createTask", title: "T", description: "Typed by me",
    });
    // Clearing the description clears both.
    expect(mergeEditedPayload(rich, { description: "" })).toEqual({ kind: "createTask", title: "T" });
  });

  it("an unchanged description (the card re-sends it with every edit) keeps the JSON", () => {
    expect(mergeEditedPayload(rich, { description: "Agent text", title: "T2" })).toEqual({ ...rich, title: "T2" });
  });
});

describe("commentTextToTiptapDoc", () => {
  it("turns @[Name](user:id) tokens into mention nodes and leaves other text literal", () => {
    expect(commentTextToTiptapDoc("Hi @[Bob](user:u1), see @[ARLO-2](task:t1)\n\nThanks")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "mention", attrs: { id: "u1", label: "Bob" } },
            { type: "text", text: ", see @[ARLO-2](task:t1)" },
          ],
        },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "Thanks" }] },
      ],
    });
  });
});
