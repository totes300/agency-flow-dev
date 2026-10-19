/**
 * Model slug parsing for per-agent / per-job model overrides
 * (docs/prd-email-triage-implementation-plan.md §3 P2; `agents.model`, F11).
 *
 * Pure — shared by the agent builder's save validation (convex/agents.ts)
 * and `resolveModel` (convex/lib/worksheetAi.ts), so a slug the builder
 * accepts is exactly a slug a run can resolve.
 *
 * ONLY Anthropic Claude models, on every path (gateway and the org's own
 * Anthropic key), and only versions listed in `CLAUDE_MODEL_FAMILIES` — a
 * slug we can't map confidently to BOTH transports is rejected, never
 * guessed. Two naming conventions (see worksheetAi.ts):
 *   - AI Gateway:     `anthropic/claude-sonnet-4.6`, `anthropic/claude-3.5-sonnet`
 *   - Anthropic API:  `claude-sonnet-4-6`, `claude-3-5-sonnet-20241022`
 *
 * Accepted input (case-insensitive, `anthropic/` prefix optional):
 *   - current generation: `claude-<family>-<major>[.-<minor>][-<YYYYMMDD>]`
 *     e.g. `claude-sonnet-4.6`, `claude-sonnet-4-6`, `claude-opus-4-1-20250805`
 *   - Claude 3.x: `claude-<major>[.-<minor>]-<family>[-<YYYYMMDD>|-latest]`
 *     e.g. `claude-3.5-sonnet`, `claude-3-5-sonnet-20241022`
 * A dated id keeps its snapshot on the Anthropic API; the gateway gets the
 * version slug. Everything else throws `InvalidModelSlugError` with the hint.
 */

export const DEFAULT_MODEL_EXAMPLE = "anthropic/claude-sonnet-4.6";
const MODEL_SLUG_MAX_LEN = 100;

/**
 * The known Claude families and versions — extend here when Anthropic ships
 * a model. `current`: versions named `claude-<family>-<version>` (a version
 * without a minor maps to the API alias `…-<major>-0`). `legacy`: Claude 3.x,
 * named `claude-<version>-<family>`, with the API snapshot an undated slug
 * resolves to.
 */
export const CLAUDE_MODEL_FAMILIES: Readonly<
  Record<
    "opus" | "sonnet" | "haiku",
    { current: readonly string[]; legacy: Readonly<Record<string, string>> }
  >
> = {
  opus: {
    current: ["4", "4.1", "4.5"],
    legacy: { "3": "claude-3-opus-20240229" },
  },
  sonnet: {
    current: ["4", "4.5", "4.6"],
    legacy: {
      "3.5": "claude-3-5-sonnet-20241022",
      "3.7": "claude-3-7-sonnet-20250219",
    },
  },
  haiku: {
    current: ["4.5"],
    legacy: {
      "3": "claude-3-haiku-20240307",
      "3.5": "claude-3-5-haiku-20241022",
    },
  },
};

type Family = keyof typeof CLAUDE_MODEL_FAMILIES;
const FAMILY_RE = "(opus|sonnet|haiku)";
/** claude-<family>-<major>[.-<minor>][-<date>] (minor is 1–2 digits; a date is 8). */
const CURRENT_RE = new RegExp(`^${FAMILY_RE}-(\\d)(?:[.-](\\d{1,2}))?(?:-(\\d{8}))?$`);
/** claude-<major>[.-<minor>]-<family>[-<date>|-latest] (Claude 3.x). */
const LEGACY_RE = new RegExp(`^(\\d)(?:[.-](\\d))?-${FAMILY_RE}(?:-(\\d{8}|latest))?$`);

/** A configured model slug that cannot be resolved (clear, user-fixable). */
export class InvalidModelSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelSlugError";
  }
}

export type ParsedModelSlug = {
  /** What the AI Gateway accepts (`anthropic/claude-sonnet-4.6`). */
  gatewaySlug: string;
  /** The Anthropic API model id (`claude-sonnet-4-6`). */
  anthropicModelId: string;
};

/**
 * Parse + normalize a model slug. Throws `InvalidModelSlugError` for an
 * empty, oversized or malformed value, a non-Anthropic or non-Claude model,
 * or a Claude version not in `CLAUDE_MODEL_FAMILIES`.
 */
export function parseModelSlug(raw: string): ParsedModelSlug {
  const shown = raw.trim();
  const slug = shown.toLowerCase();
  const fix = `Use an Anthropic Claude model such as ${DEFAULT_MODEL_EXAMPLE}, or leave it empty for the platform default.`;
  const reject = (why: string): never => {
    throw new InvalidModelSlugError(`${why} ${fix}`);
  };
  if (!slug) reject("The model is empty.");
  if (slug.length > MODEL_SLUG_MAX_LEN) reject(`The model "${shown.slice(0, 40)}…" is too long.`);

  const slash = slug.indexOf("/");
  if (slash !== -1 && slug.slice(0, slash) !== "anthropic") {
    reject(`"${shown}" is not supported — only Anthropic Claude models are.`);
  }
  const model = slash === -1 ? slug : slug.slice(slash + 1);
  if (!model.startsWith("claude-")) reject(`"${shown}" is not a Claude model.`);
  const rest = model.slice("claude-".length);

  const current = CURRENT_RE.exec(rest);
  if (current) {
    const [, family, major, minor, date] = current as unknown as [
      string, Family, string, string | undefined, string | undefined,
    ];
    const version = minor && minor !== "0" ? `${major}.${minor}` : major;
    if (!CLAUDE_MODEL_FAMILIES[family].current.includes(version)) {
      reject(`"${shown}" is not a known Claude model.`);
    }
    return {
      gatewaySlug: `anthropic/claude-${family}-${version}`,
      anthropicModelId: date
        ? `claude-${family}-${major}${minor ? `-${minor}` : ""}-${date}`
        : `claude-${family}-${major}-${minor ?? "0"}`,
    };
  }

  const legacy = LEGACY_RE.exec(rest);
  if (legacy) {
    const [, major, minor, family, suffix] = legacy as unknown as [
      string, string, string | undefined, Family, string | undefined,
    ];
    const version = minor ? `${major}.${minor}` : major;
    const snapshot = CLAUDE_MODEL_FAMILIES[family].legacy[version];
    if (!snapshot) reject(`"${shown}" is not a known Claude model.`);
    const dated = suffix && suffix !== "latest";
    return {
      gatewaySlug: `anthropic/claude-${version}-${family}`,
      anthropicModelId: dated
        ? `claude-${major}${minor ? `-${minor}` : ""}-${family}-${suffix}`
        : snapshot,
    };
  }

  return reject(`"${shown}" is not a known Claude model.`);
}
