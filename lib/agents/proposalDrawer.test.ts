import { describe, expect, it } from "vitest";
import {
  addSubtaskToChange,
  changeDiff,
  changeEditFromPayload,
  changeOperationCount,
  createEditFromDraft,
  draftDescriptionDoc,
  draftFromCreatePayload,
  dropChange,
  dropSubtaskOp,
  editAddedSubtask,
  editAmendment,
  fieldReasonLabel,
  isEmptyChange,
  isUnsure,
  reasonEntries,
  setChange,
  subtaskDiff,
  type CurrentSubtask,
  type TaskCurrentValues,
} from "./proposalDrawer";
import { mergeEditedPayload, validateProposalPayload, type CreateTaskPayload, type UpdateTaskPayload } from "./proposals";

const current: TaskCurrentValues = {
  title: "Black Friday banners",
  statusId: "s_progress",
  priority: 3,
  assigneeIds: ["u_anna"],
  dueDate: "2026-10-20",
  workCategoryId: "c_design",
};

const subs: CurrentSubtask[] = [
  { id: "sub1", title: "Hero 1920×600", assigneeIds: ["u_anna"], dueDate: "2026-10-21", done: false },
  { id: "sub2", title: "Mobile 1080×1350", assigneeIds: [], dueDate: null, done: false },
  { id: "sub3", title: "Story 1080×1920", assigneeIds: ["u_bence"], dueDate: null, done: true },
  { id: "sub4", title: "Newsletter header", assigneeIds: [], dueDate: null, done: false },
];

const change = (extra: Partial<UpdateTaskPayload> = {}): UpdateTaskPayload => ({
  kind: "updateTask",
  taskId: "t1",
  ...extra,
});

describe("changeDiff — was / now per property", () => {
  it("marks only the properties the proposal sets to a different value", () => {
    const diff = changeDiff(current, change({ changes: { statusId: "s_done", dueDate: null, priority: 3 } }));
    expect(diff.statusId).toMatchObject({ current: "s_progress", proposed: "s_done", changed: true });
    expect(diff.dueDate).toMatchObject({ current: "2026-10-20", proposed: null, changed: true });
    // Proposed equal to the current value is not a change.
    expect(diff.priority.changed).toBe(false);
    expect(diff.title).toMatchObject({ proposed: "Black Friday banners", changed: false });
  });

  it("compares assignee sets ignoring order", () => {
    const task = { ...current, assigneeIds: ["a", "b"] };
    expect(changeDiff(task, change({ changes: { assigneeIds: ["b", "a"] } })).assigneeIds.changed).toBe(false);
    expect(changeDiff(task, change({ changes: { assigneeIds: ["a"] } })).assigneeIds.changed).toBe(true);
  });

  it("shows a reopen as the proposed status", () => {
    const diff = changeDiff(current, change({ reopen: { statusId: "s_todo" } }));
    expect(diff.statusId).toMatchObject({ proposed: "s_todo", changed: true, viaReopen: true });
  });
});

describe("setChange / dropChange", () => {
  it("sets a value, and drops the change when it equals the current value", () => {
    const p = setChange(change({ changes: { title: "X" } }), current, "dueDate", "2026-10-25");
    expect(p.changes).toEqual({ title: "X", dueDate: "2026-10-25" });
    expect(setChange(p, current, "dueDate", "2026-10-20").changes).toEqual({ title: "X" });
    expect(dropChange(p, "title").changes).toEqual({ dueDate: "2026-10-25" });
  });

  it("edits the reopen target instead of adding a conflicting statusId", () => {
    const p = setChange(change({ reopen: { statusId: "s_todo" } }), current, "statusId", "s_started");
    expect(p.reopen).toEqual({ statusId: "s_started" });
    expect(p.changes?.statusId).toBeUndefined();
  });
});

describe("subtaskDiff", () => {
  const ops: UpdateTaskPayload["subtasks"] = {
    add: [{ title: "Story size 1080×1920", assigneeIds: ["u_bence"], dueDate: "2026-10-24" }],
    amend: [{ subtaskId: "sub1", title: "Hero 2400×800", dueDate: "2026-10-21" }],
    cancel: [{ subtaskId: "sub2", reason: "Client dropped mobile" }],
    tick: [{ subtaskId: "sub4" }],
  };

  it("puts every operation in place, adds last", () => {
    const rows = subtaskDiff(subs, ops);
    expect(rows.map((r) => r.kind)).toEqual(["amend", "cancel", "existing", "tick", "add"]);
    expect(rows[0]).toMatchObject({ title: "Hero 2400×800", was: { title: "Hero 1920×600" } });
    // The due date did not change: no "was" for it.
    expect(rows[0].kind === "amend" && "dueDate" in rows[0].was).toBe(false);
    expect(rows[1]).toMatchObject({ kind: "cancel", reason: "Client dropped mobile" });
    expect(rows[2]).toMatchObject({ kind: "existing", done: true });
    expect(rows[4]).toMatchObject({ kind: "add", index: 0, title: "Story size 1080×1920", dueDate: "2026-10-24" });
  });

  it("still shows an operation on a subtask that is no longer listed", () => {
    const rows = subtaskDiff([], { tick: [{ subtaskId: "gone", subtaskTitle: "Old one" }] });
    expect(rows).toEqual([{ kind: "tick", id: "gone", title: "Old one" }]);
  });

  it("unticks, edits and adds operations", () => {
    const p = change({ subtasks: ops });
    const rows = subtaskDiff(subs, ops);
    const withoutCancel = dropSubtaskOp(p, rows[1]);
    expect(withoutCancel.subtasks?.cancel).toBeUndefined();
    expect(withoutCancel.subtasks?.amend).toHaveLength(1);
    const withoutAdd = dropSubtaskOp(p, rows[4]);
    expect(withoutAdd.subtasks?.add).toBeUndefined();

    const edited = editAddedSubtask(p, 0, { title: "Story", dueDate: null });
    expect(edited.subtasks?.add?.[0]).toEqual({ title: "Story", assigneeIds: ["u_bence"] });
    expect(editAmendment(p, "sub1", { assigneeIds: ["u_cili"] }).subtasks?.amend?.[0]).toMatchObject({
      subtaskId: "sub1",
      assigneeIds: ["u_cili"],
    });
    expect(addSubtaskToChange(p, "Extra").subtasks?.add).toHaveLength(2);
  });
});

describe("empty change guard + wire edit", () => {
  it("counts operations and detects an empty change", () => {
    const p = change({ changes: { statusId: "s_done" }, subtasks: { tick: [{ subtaskId: "sub4" }] } });
    expect(changeOperationCount(p)).toBe(2);
    expect(isEmptyChange(p)).toBe(false);
    expect(isEmptyChange(change({ changes: {}, subtasks: {} }))).toBe(true);
    expect(isEmptyChange(change({ reopen: { statusId: "s" } }))).toBe(false);
  });

  it("the wire edit merges and validates on the server path", () => {
    const original = change({
      taskTitle: "Black Friday banners",
      changes: { statusId: "s_done", dueDate: "2026-10-22" },
      subtasks: { tick: [{ subtaskId: "sub4" }] },
    });
    const edited = dropChange(original, "dueDate");
    const merged = mergeEditedPayload(original, changeEditFromPayload(edited));
    const validated = validateProposalPayload(merged);
    expect(validated.ok).toBe(true);
    expect(validated.ok && validated.payload).toMatchObject({
      changes: { statusId: "s_done" },
      subtasks: { tick: [{ subtaskId: "sub4" }] },
      taskTitle: "Black Friday banners",
    });
    expect(validated.ok && validated.payload.kind === "updateTask" && validated.payload.changes?.dueDate).toBeUndefined();
  });
});

describe("draft (createTask)", () => {
  const payload: CreateTaskPayload = {
    kind: "createTask",
    title: "Black Friday campaign",
    description: "Goal line\nKész, ha: approved",
    projectId: "p1",
    assigneeIds: ["u_anna"],
    dueDate: "2026-10-24",
    subtasks: [{ title: "Hero", assigneeIds: [] }],
    fieldReasons: { dueDate: { reason: "Réka wrote Friday", confidence: "unsure" } },
  };

  it("round-trips through the wire edit without changing the payload", () => {
    const merged = mergeEditedPayload(payload, createEditFromDraft(draftFromCreatePayload(payload)));
    const validated = validateProposalPayload(merged);
    expect(validated.ok && validated.payload).toMatchObject({
      title: "Black Friday campaign",
      description: "Goal line\nKész, ha: approved",
      projectId: "p1",
      assigneeIds: ["u_anna"],
      dueDate: "2026-10-24",
      subtasks: [{ title: "Hero", assigneeIds: [] }],
    });
  });

  it("a TipTap edit keeps the plain text and lands in descriptionJson; cleared fields clear", () => {
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }] });
    const draft = { ...draftFromCreatePayload(payload), descriptionJson: doc, projectId: undefined, dueDate: "" };
    const merged = mergeEditedPayload(payload, createEditFromDraft(draft));
    expect(merged).toMatchObject({ descriptionJson: doc, description: payload.description });
    expect("projectId" in merged).toBe(false);
    expect("dueDate" in merged).toBe(false);
  });

  it("shows the TipTap JSON, else the plain text as a document", () => {
    expect(draftDescriptionDoc({ description: "a\nb", descriptionJson: undefined })).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
    expect(draftDescriptionDoc({ description: "x", descriptionJson: '{"type":"doc","content":[]}' })).toEqual({
      type: "doc",
      content: [],
    });
    expect(draftDescriptionDoc({ description: "", descriptionJson: undefined })).toBeUndefined();
  });
});

describe("why these suggestions", () => {
  it("labels fields, sorts properties before subtasks and flags guesses", () => {
    expect(fieldReasonLabel("subtasks.1.dueDate")).toBe("Subtask 2 · Due date");
    expect(fieldReasonLabel("subtasks.add.0.assigneeIds")).toBe("New subtask 1 · Assignees");
    expect(fieldReasonLabel("assigneeIds")).toBe("Assignees");
    const entries = reasonEntries({
      "subtasks.0.dueDate": { reason: "default", confidence: "unsure" },
      dueDate: { reason: "Friday", confidence: "sure" },
      projectId: { reason: "client's only project", confidence: "sure" },
    });
    expect(entries.map((e) => e.field)).toEqual(["projectId", "dueDate", "subtasks.0.dueDate"]);
    expect(entries[2].unsure).toBe(true);
    expect(isUnsure({ dueDate: { reason: "x", confidence: "unsure" } }, "statusId", "dueDate")).toBe(true);
    expect(isUnsure(undefined, "dueDate")).toBe(false);
  });
});

describe("subtask row identity", () => {
  it("remaps reasons to the current rows and drops removed ones", async () => {
    const { remapSubtaskReasons, rowOrigins, removeDraftSubtask, addDraftSubtask, draftFromCreatePayload: load } = await import("./proposalDrawer");
    const draft = load({
      kind: "createTask",
      title: "T",
      subtasks: [
        { title: "a", assigneeIds: [] },
        { title: "b", assigneeIds: [] },
      ],
    });
    expect(draft.subtaskKeys).toEqual(["r0", "r1"]);
    const next = addDraftSubtask(removeDraftSubtask(draft, 0), "c");
    expect(next.subtaskKeys).toEqual(["r1", "n1"]);
    const reasons = {
      "subtasks.0.dueDate": { reason: "a due", confidence: "unsure" as const },
      "subtasks.1.assigneeIds": { reason: "b owner", confidence: "sure" as const },
      "subtasks.add.0.dueDate": { reason: "other prefix", confidence: "sure" as const },
      dueDate: { reason: "task due", confidence: "sure" as const },
    };
    expect(remapSubtaskReasons(reasons, "subtasks", rowOrigins(next.subtaskKeys))).toEqual({
      "subtasks.0.assigneeIds": { reason: "b owner", confidence: "sure" },
      "subtasks.add.0.dueDate": { reason: "other prefix", confidence: "sure" },
      dueDate: { reason: "task due", confidence: "sure" },
    });
    expect(remapSubtaskReasons(reasons, "subtasks.add", [null, 0])).toMatchObject({
      "subtasks.add.1.dueDate": { reason: "other prefix" },
      "subtasks.0.dueDate": { reason: "a due" },
    });
  });
});
