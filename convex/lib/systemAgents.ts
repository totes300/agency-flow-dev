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

import { EMAIL_ASSISTANT_INSTRUCTIONS } from "../email/prompts";

export type SystemAgentDefinition = {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  runPermission: "admins" | "everyone";
};

/** The `prepareTask` job's tools (convex/email/jobs.ts — B6a). */
export const PREPARE_TASK_TOOLS = [
  "getEmailThread",
  "getThreadRequests",
  "getAttachmentText",
  "getProjectRouting",
  "findSimilarTasksForClient",
  "getTaskBundle",
  "listTeamMembers",
  "listWorkCategories",
  "listStatuses",
  "listProjects",
  "listClients",
  "askUser",
  "submitTriagePlan",
];

/** The `draftReply` job's tools (B6b — kickoff / reply drafts). */
export const DRAFT_REPLY_TOOLS = ["getEmailThread", "getThreadRequests", "getReplyTaskBundle", "listTeamMembers", "submitDraft"];

/** The `prepareChange` job's tools (B6b — a change on a linked task). */
export const PREPARE_CHANGE_TOOLS = [
  "getEmailThread",
  "getThreadRequests",
  "getTaskBundle",
  "listTeamMembers",
  "askUser",
  "proposeTaskUpdate",
];

/**
 * The Email assistant's DEFAULT tools — a follow-up chat turn in a Triage
 * conversation (the owner asks for a change to the plan, the change or the
 * draft — D20): every job's tools.
 */
export const EMAIL_ASSISTANT_TOOLS = [...new Set([...PREPARE_TASK_TOOLS, ...DRAFT_REPLY_TOOLS, ...PREPARE_CHANGE_TOOLS])];

export const SYSTEM_AGENTS = {
  // Neutral placeholder (A2b).
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
  // The Email assistant (PRD §6, §6.8 — B6a): the agent of every email
  // `agent_run` job, in the shared admin conversation of one email thread.
  email_assistant: {
    name: "Email assistant",
    description: "Prepares Triage plans from client emails — an assistant and project manager, never a worker.",
    instructions: EMAIL_ASSISTANT_INSTRUCTIONS,
    tools: EMAIL_ASSISTANT_TOOLS,
    runPermission: "admins",
  },
} satisfies Record<string, SystemAgentDefinition>;

export type SystemAgentKey = keyof typeof SYSTEM_AGENTS;

export function getSystemAgentDefinition(key: string): SystemAgentDefinition | null {
  return (SYSTEM_AGENTS as Record<string, SystemAgentDefinition>)[key] ?? null;
}
