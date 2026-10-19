/**
 * System agents (docs/prd-email-triage-implementation-plan.md §3 P2, A2b) —
 * agents DEFINED IN CODE that agent jobs run as (convex/lib/agentJobs.ts).
 *
 * One row per (org, key) in `agents` with `systemKey` set, created and kept
 * in sync with this definition by `ensureSystemAgent` (convex/agentJobs.ts).
 * They never appear where users list or pick agents (rail, builder, new-chat
 * picker, skills surface) and the builder can't edit or archive them; their
 * runs still show in the audit view.
 *
 * `tools` are the agent's DEFAULT tools — used by a plain follow-up chat turn
 * in one of its threads. A job run uses the job's own tool list instead.
 */

export type SystemAgentDefinition = {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  runPermission: "admins" | "everyone";
};

export const SYSTEM_AGENTS = {
  // Neutral placeholder (A2b). B-phase email jobs add their own system agent
  // ("Email assistant") with its own instructions.
  assistant: {
    name: "Assistant",
    description: "Agency Flow's built-in assistant for background jobs.",
    instructions:
      "You are the built-in assistant inside Agency Flow, a project " +
      "management tool for digital agencies. You work on behalf of the " +
      "agency's team. Always use the provided tools for facts; never invent " +
      "clients, projects, tasks, names or numbers. Your only write path is " +
      "proposing changes for a person to approve — never claim something " +
      "was created or changed. Keep answers short and concrete.",
    tools: ["listClients", "listProjects", "listTeamMembers", "findTasks", "getTaskDetail"],
    runPermission: "everyone",
  },
} satisfies Record<string, SystemAgentDefinition>;

export type SystemAgentKey = keyof typeof SYSTEM_AGENTS;

export function getSystemAgentDefinition(key: string): SystemAgentDefinition | null {
  return (SYSTEM_AGENTS as Record<string, SystemAgentDefinition>)[key] ?? null;
}
