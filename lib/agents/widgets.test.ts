import { describe, expect, it } from "vitest";
import { classifyParts, deliverableBlocks, latestDraftBlocks, type MessagePartLike } from "./blocks";
import { AGENT_EMAIL_DRAFT_MARKER } from "./emailDrafts";
import { AGENT_PROPOSALS_MARKER } from "./proposals";
import {
  AGENT_EVENT_MARKER,
  AGENT_REQUEST_CHECKLIST_MARKER,
  AGENT_TASK_CARD_MARKER,
  EVENT_LINE_MAX,
  eventLineText,
  isRequestChecklistRefOutput,
  isTaskCardRefOutput,
  requestChecklistRef,
} from "./widgets";
import { eventLineMessages } from "../../convex/agentEvents";

const tool = (name: string, output: unknown): MessagePartLike => ({
  type: `tool-${name}`,
  state: "output-available",
  input: {},
  output,
});
const step: MessagePartLike = { type: "step-start" };
const card = (taskId: string) => tool("getTaskBundle", { found: true, block: AGENT_TASK_CARD_MARKER, taskId });

describe("widget markers", () => {
  it("task card: the marker with a task id", () => {
    expect(isTaskCardRefOutput({ block: AGENT_TASK_CARD_MARKER, taskId: "t1" })).toBe(true);
    expect(isTaskCardRefOutput({ block: AGENT_TASK_CARD_MARKER })).toBe(false);
  });
  it("request checklist: exactly one conversation reference", () => {
    const ok = { block: AGENT_REQUEST_CHECKLIST_MARKER, ref: { threadId: "e1" } };
    expect(isRequestChecklistRefOutput(ok)).toBe(true);
    expect(isRequestChecklistRefOutput({ ...ok, ref: { threadId: "e1", agentThreadId: "a1" } })).toBe(false);
    expect(isRequestChecklistRefOutput({ ...ok, ref: {} })).toBe(false);
    expect(requestChecklistRef({ agentThreadId: "a1" })).toEqual({ agentThreadId: "a1" });
    expect(requestChecklistRef({})).toBeNull();
    expect(requestChecklistRef({ threadId: "e", agentThreadId: "a" })).toBeNull();
  });
  it("event text is one trimmed, capped line", () => {
    expect(eventLineText("  Created PRG-132\n · Frances notified ")).toBe("Created PRG-132 · Frances notified");
    expect(eventLineText("x".repeat(400))).toHaveLength(EVENT_LINE_MAX);
  });
});

describe("classifyParts — the B8a block kinds", () => {
  it("the email draft marker expands into the email component after its ghost row", () => {
    const blocks = classifyParts([tool("submitDraft", { block: AGENT_EMAIL_DRAFT_MARKER, draftId: "d1", version: 2 })]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "emailDraft"]);
    expect(blocks[1]).toEqual({ kind: "emailDraft", draftId: "d1" });
  });

  it("an event line replaces its tool row", () => {
    const blocks = classifyParts([tool("recordEvent", { block: AGENT_EVENT_MARKER, text: "Created PRG-132 · Frances notified" })]);
    expect(blocks).toEqual([{ kind: "event", text: "Created PRG-132 · Frances notified" }]);
  });

  it("the event-line messages the server posts carry that marker", () => {
    const [call, result] = eventLineMessages("Created PRG-132", "call_1");
    expect(call).toMatchObject({ role: "assistant", content: [{ type: "tool-call", toolName: "recordEvent" }] });
    expect(result).toMatchObject({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call_1", output: { type: "json", value: { block: AGENT_EVENT_MARKER, text: "Created PRG-132" } } }],
    });
  });

  it("widgets render only from the LAST step that read them, each reference once", () => {
    const blocks = classifyParts([
      step,
      card("t1"), // working material — an earlier step
      step,
      card("t2"),
      card("t3"),
      card("t2"),
      tool("getThreadRequests", { found: true, block: AGENT_REQUEST_CHECKLIST_MARKER, ref: { threadId: "e1" } }),
      step,
      { type: "text", text: "Both are on track.", state: "done" },
    ]);
    const widgets = blocks.filter((b) => b.kind === "taskCard" || b.kind === "requestChecklist");
    expect(widgets).toEqual([
      { kind: "taskCard", taskId: "t2" },
      { kind: "taskCard", taskId: "t3" },
      { kind: "requestChecklist", ref: { threadId: "e1" } },
    ]);
    // Every call keeps its quiet ghost row.
    expect(blocks.filter((b) => b.kind === "tool")).toHaveLength(5);
  });

  it("a marker counts only on the tool that owns it (hardening)", () => {
    const blocks = classifyParts([
      tool("someConnectorTool", { block: AGENT_EVENT_MARKER, text: "Created PRG-1" }),
      tool("listClients", { block: AGENT_TASK_CARD_MARKER, taskId: "t1" }),
      tool("findTasks", { block: AGENT_REQUEST_CHECKLIST_MARKER, ref: { threadId: "e1" } }),
      tool("getTaskComments", { block: AGENT_EMAIL_DRAFT_MARKER, draftId: "d1" }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "tool", "tool", "tool"]);
  });

  it("deliverableBlocks keeps the job's deliverable, drops tool rows, reasoning and read widgets", () => {
    const blocks = classifyParts([
      { type: "reasoning", text: "hmm", state: "done" },
      card("t1"),
      tool("submitTriagePlan", { block: AGENT_PROPOSALS_MARKER, proposalIds: ["p1"] }),
      tool("submitDraft", { block: AGENT_EMAIL_DRAFT_MARKER, draftId: "d1" }),
      { type: "text", text: "Ready.", state: "done" },
    ]);
    expect(deliverableBlocks(blocks).map((b) => b.kind)).toEqual(["proposal", "emailDraft", "text"]);
  });
});

describe("latestDraftBlocks", () => {
  it("a revised draft renders once, at its latest marker; the drafts' order follows", () => {
    const { groups, draftOrder } = latestDraftBlocks([
      [{ kind: "emailDraft", draftId: "kickoff" }, { kind: "text", text: "v1", streaming: false }],
      [{ kind: "emailDraft", draftId: "reply" }],
      [{ kind: "emailDraft", draftId: "kickoff" }],
    ]);
    expect(groups).toEqual([[{ kind: "text", text: "v1", streaming: false }], [{ kind: "emailDraft", draftId: "reply" }], [{ kind: "emailDraft", draftId: "kickoff" }]]);
    expect(draftOrder).toEqual(["reply", "kickoff"]);
  });
});
