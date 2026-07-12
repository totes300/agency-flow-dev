import { describe, expect, it } from "vitest";
import {
  AGENT_PROPOSALS_MARKER,
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
