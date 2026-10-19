import { saveMessages } from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { AGENT_EVENT_MARKER, EVENT_LINE_TOOL_NAME, eventLineText } from "../lib/agents/widgets";

/**
 * The event line of the conversation kit (email-triage B8a, PRD §7.1): "✓
 * Created PRG-132 · Frances notified". Written by SERVER CODE only — after a
 * Create, a Merge, an applied change, a send — as one synthetic tool result
 * carrying the event marker, so it sorts into the thread's timeline like any
 * message and the shared classifier renders it in every assistant surface. It
 * is never a model tool (no registry entry): the sentence is a record of what
 * code did, composed by that code.
 */

/** The messages of one event line (pure — unit-tested). */
export function eventLineMessages(text: string, toolCallId: string): ModelMessage[] {
  const output = { block: AGENT_EVENT_MARKER, text: eventLineText(text) };
  return [
    { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName: EVENT_LINE_TOOL_NAME, input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: EVENT_LINE_TOOL_NAME,
          output: { type: "json", value: output },
        },
      ],
    },
  ];
}

/** Post an event line into an agent thread (call inside the mutation that did the thing). */
export async function postEventLine(
  ctx: MutationCtx,
  args: { componentThreadId: string; userId: Id<"users">; text: string },
): Promise<void> {
  const text = eventLineText(args.text);
  if (!text) return;
  await saveMessages(ctx, components.agent, {
    threadId: args.componentThreadId,
    userId: args.userId,
    messages: eventLineMessages(text, `event_${crypto.randomUUID()}`),
  });
}
