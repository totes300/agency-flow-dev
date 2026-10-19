/**
 * Agent builder — pure logic (slice 09). Everything here is I/O-free so it
 * runs identically in the admin builder UI, the Convex CRUD mutations, and
 * Vitest: draft validation, tool-catalog grouping, and stale-reference
 * detection. The registry itself (with its non-serializable AI-SDK tool
 * objects) lives in `convex/lib/agentToolRegistry.ts`; this module only ever
 * sees the plain catalog rows a query hands back.
 */

export type AgentRunPermission = "admins" | "everyone";
export type AgentToolScope = "member" | "admin";

/** One row of the vetted tool catalog, stripped of its runtime tool object. */
export type ToolCatalogEntry = {
  name: string;
  humanDescription: string;
  scope: AgentToolScope;
  kind: string;
};

export const AGENT_NAME_MAX = 60;
export const AGENT_DESCRIPTION_MAX = 200;
export const AGENT_INSTRUCTIONS_MAX = 8000;
export const AGENT_EXAMPLE_PROMPT_MAX = 200;
export const AGENT_MAX_EXAMPLE_PROMPTS = 6;

/** The mutable core of an agent as the builder form edits it. */
export type AgentDraftInput = {
  name: string;
  description: string;
  instructions: string;
};

/**
 * Validate the free-text fields of an agent draft. Returns the first problem
 * as a human message, or null when the draft is savable. Trims before
 * measuring so trailing whitespace can't sneak past a length cap. Tool and
 * skill validity are checked separately (they need the registry / the org's
 * skills), so they're deliberately out of scope here.
 */
export function validateAgentDraft(draft: AgentDraftInput): string | null {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const instructions = draft.instructions.trim();
  if (!name) return "Name is required.";
  if (name.length > AGENT_NAME_MAX) {
    return `Name must be ${AGENT_NAME_MAX} characters or fewer.`;
  }
  if (description.length > AGENT_DESCRIPTION_MAX) {
    return `Description must be ${AGENT_DESCRIPTION_MAX} characters or fewer.`;
  }
  if (!instructions) return "Instructions are required.";
  if (instructions.length > AGENT_INSTRUCTIONS_MAX) {
    return `Instructions must be ${AGENT_INSTRUCTIONS_MAX} characters or fewer.`;
  }
  return null;
}

/** A scope group for the checklist: human label + its tools, in catalog order. */
export type ToolCatalogGroup = {
  scope: AgentToolScope;
  label: string;
  description: string;
  tools: ToolCatalogEntry[];
};

const SCOPE_GROUPS: {
  scope: AgentToolScope;
  label: string;
  description: string;
}[] = [
  {
    scope: "member",
    label: "Available to everyone",
    description:
      "Anyone allowed to run the agent can use these — they read data or " +
      "compose deliverables, never write to the app.",
  },
  {
    scope: "admin",
    label: "Admin-only",
    description:
      "These stay absent unless the person running the agent is an admin — " +
      "the underlying functions enforce it too, so a member run can never " +
      "reach them even if you check the box.",
  },
];

/**
 * Group the catalog by scope for the checklist (member tools first, then
 * admin), preserving each tool's original catalog order within its group.
 * Empty groups are dropped so the UI never renders a labelled void.
 */
export function groupToolCatalog(
  catalog: ToolCatalogEntry[],
): ToolCatalogGroup[] {
  return SCOPE_GROUPS.map(({ scope, label, description }) => ({
    scope,
    label,
    description,
    tools: catalog.filter((entry) => entry.scope === scope),
  })).filter((group) => group.tools.length > 0);
}

/**
 * Names an agent references that the registry no longer knows about (a tool
 * renamed or removed in code after the agent was saved). These are flagged in
 * the form and dropped at runtime with a system block — never executed.
 */
export function findStaleToolRefs(
  toolNames: string[],
  catalog: ToolCatalogEntry[],
): string[] {
  const known = new Set(catalog.map((entry) => entry.name));
  // Dedupe while preserving first-seen order.
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const name of toolNames) {
    if (known.has(name) || seen.has(name)) continue;
    seen.add(name);
    stale.push(name);
  }
  return stale;
}

/**
 * Clean the example-prompt chips a builder typed: trim each, drop blanks,
 * clamp overly long ones, dedupe, and cap the count. Stored verbatim and
 * shown as clickable chips on the agent's first-run empty state.
 */
export function normalizeExamplePrompts(prompts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of prompts) {
    const trimmed = raw.trim().slice(0, AGENT_EXAMPLE_PROMPT_MAX);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= AGENT_MAX_EXAMPLE_PROMPTS) break;
  }
  return out;
}
