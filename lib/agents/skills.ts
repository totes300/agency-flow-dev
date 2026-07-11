/**
 * Pure skills layer for the agent runner (PRD: D2, Module 7). A skill is a
 * plain-English SOP — global or per-client — that steers an agent's judgment
 * (grouping, tone, when to stop). Skills change *which / how-grouped /
 * when-to-stop*, NEVER *how a total is computed* (that stays deterministic in
 * the tools).
 *
 * Everything here is deterministic and I/O-free so it unit-tests cleanly
 * (skills.test.ts). The Convex side fetches the skill records and clients,
 * then delegates ordering, client-scoping and prompt assembly to these
 * functions. Resolution order is the documented tie-breaker for conflicting
 * skills: global first, then client-specific (PRD Module 7 › Interface).
 */

export type SkillScope = "global" | "client";

/** The subset of a skill record the resolver needs — keeps this module pure. */
export type ResolvableSkill = {
  _id: string;
  name: string;
  instruction: string;
  scope: SkillScope;
  /** Set only for `scope: "client"` skills. */
  clientId?: string | null;
  isStopCondition: boolean;
  /** Authoring order — the primary sort key within a scope group. */
  createdAt: number;
};

/** A loaded stop-condition, surfaced to the runner for enforcement. */
export type StopCondition = { name: string; instruction: string };

export type ResolvedSkills = {
  /** Global skills first, then the run's client-specific skills. */
  loaded: ResolvableSkill[];
  /** The subset of `loaded` that declares a hard stop-condition. */
  stopConditions: StopCondition[];
};

/** Model-facing tool name the runner injects when stop-conditions are loaded. */
export const STOP_CONDITION_TOOL_NAME = "flagStopCondition";

/** Deterministic order within a scope group: authoring order, then name, then id. */
function bySkillOrder(a: ResolvableSkill, b: ResolvableSkill): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/**
 * Resolve an agent's attached skills for one run.
 *
 * - Global skills always load.
 * - Client-scoped skills load ONLY when the run concerns their client
 *   (`clientId` matches). When the run has no client context, no client
 *   skills load — other clients' conventions never leak.
 * - Deterministic ordering: global group first, then the client group, each
 *   sorted by authoring order. This is the documented resolution for
 *   conflicting skills (PRD Module 7).
 *
 * Caller order is irrelevant — the result is fully determined by the skill
 * set and the client context.
 */
export function resolveSkills(
  skills: ResolvableSkill[],
  clientId: string | null,
): ResolvedSkills {
  const globals = skills
    .filter((s) => s.scope === "global")
    .sort(bySkillOrder);
  const clientSkills = clientId
    ? skills
        .filter((s) => s.scope === "client" && s.clientId === clientId)
        .sort(bySkillOrder)
    : [];

  const loaded = [...globals, ...clientSkills];
  const stopConditions = loaded
    .filter((s) => s.isStopCondition)
    .map((s) => ({ name: s.name, instruction: s.instruction }));

  return { loaded, stopConditions };
}

/**
 * Build the system-prompt addendum for a run's resolved skills. Returns "" when
 * nothing loaded, so the caller can append unconditionally. Stop-conditions are
 * listed both as regular SOPs and under an explicit enforcement protocol that
 * points the model at the `flagStopCondition` tool.
 */
export function assembleSkillPrompt(resolved: ResolvedSkills): string {
  if (resolved.loaded.length === 0) return "";

  const lines: string[] = [
    "# Skills (operating procedures)",
    "",
    "The following skills steer your judgment for this run. Follow them. They " +
      "affect which items you include, how you group and phrase things, and " +
      "when to stop — they NEVER change how any number or total is computed " +
      "(those come verbatim from tools).",
    "",
  ];
  for (const skill of resolved.loaded) {
    const tag = skill.isStopCondition ? " [stop-condition]" : "";
    lines.push(`- ${skill.name}${tag}: ${skill.instruction}`);
  }

  if (resolved.stopConditions.length > 0) {
    lines.push(
      "",
      "# Stop-condition protocol",
      "",
      "One or more skills above declare a hard stop-condition. If a " +
        `stop-condition is met, immediately call the \`${STOP_CONDITION_TOOL_NAME}\` ` +
        "tool with the skill's name and a one-sentence reason. Do NOT produce " +
        "a summary, a table, or any fabricated content when a stop-condition " +
        "fires — stopping cleanly is the correct outcome.",
    );
  }

  return lines.join("\n");
}

/**
 * Determine which client (if any) a run concerns, from the user's opening
 * message, for auto-applying client-scoped skills (US 50).
 *
 * Deterministic name/prefix match over the org's clients:
 * - A client matches when its name (≥ 3 chars) appears as a substring of the
 *   message, or its prefix appears as a standalone whitespace-delimited token.
 * - On multiple matches the MOST SPECIFIC wins (longest matched client name),
 *   tie-broken by name then id — so "Pragmatico North" beats "Pragmatico".
 *
 * Tracer scope: only the opening message is inspected. A client the agent
 * discovers mid-run via a tool is not retro-injected — acceptable for V1
 * (the timesheet flow names the client up front). Documented in the backlog.
 */
export type ClientForMatch = { _id: string; name: string; prefix?: string | null };

export function matchClientForRun(
  message: string,
  clients: ClientForMatch[],
): string | null {
  const haystack = message.toLowerCase();
  const tokens = new Set(
    haystack.split(/[^a-z0-9]+/i).filter((t) => t.length > 0),
  );

  let best: { id: string; name: string; score: number } | null = null;
  for (const client of clients) {
    const name = client.name.trim().toLowerCase();
    const nameHit = name.length >= 3 && haystack.includes(name);
    const prefixHit =
      typeof client.prefix === "string" &&
      client.prefix.trim().length > 0 &&
      tokens.has(client.prefix.trim().toLowerCase());
    if (!nameHit && !prefixHit) continue;

    // Specificity = matched name length (prefix-only matches score by prefix).
    const score = nameHit ? name.length : (client.prefix ?? "").trim().length;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && client.name < best.name)
    ) {
      best = { id: client._id, name: client.name, score };
    }
  }
  return best?.id ?? null;
}
