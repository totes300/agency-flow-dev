/**
 * AI integration settings (Phase 9, BYOK).
 *
 * Owns the customer-provided Anthropic API key lifecycle:
 *   - `getStatus`           — admin-only query, mask + audit metadata.
 *   - `validateAndSaveKey`  — admin-only action; pings Anthropic with the
 *                              candidate key, then writes via internal mutation.
 *   - `removeKey`           — admin-only mutation; clears the active key and
 *                              records `aiKeyRemovedAt` / `aiKeyRemovedBy`
 *                              for audit trail.
 *   - `testStoredKey`       — admin-only action; re-validates the stored key
 *                              without changing it.
 *
 * Internal helpers (never exposed publicly — server-to-server only):
 *   - `internal.aiIntegration.storeEncryptedKey`  — writes ciphertext +
 *                                                   mask + audit fields.
 *                                                   Re-runs `requireAdmin`
 *                                                   internally to close the
 *                                                   TOCTOU window with the
 *                                                   action layer.
 *   - `internal.aiIntegration.loadDecryptedKey`   — decrypts and returns
 *                                                   plaintext to the calling
 *                                                   action. Re-runs
 *                                                   `requireAdmin` so this
 *                                                   helper can't be misused
 *                                                   by a future caller that
 *                                                   forgets to gate upstream.
 *
 * Security invariants:
 *   1. Plaintext never crosses the client boundary. Mutations store
 *      ciphertext; queries return mask only.
 *   2. Auth is verified BOTH at the action entry point AND inside every
 *      internal mutation/query that handles the secret — no implicit trust
 *      of caller-supplied `orgId`.
 *   3. Anthropic API errors are scrubbed of `sk-ant-…` substrings and
 *      length-capped before surfacing to the client.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthContext, requireAdmin } from "./lib/auth";
import {
  buildKeyMask,
  decryptSecret,
  encryptSecret,
  SecretCryptoUnavailableError,
  SecretDecryptionFailedError,
} from "./lib/secretCrypto";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Validation model. Haiku 4.5 is the cheapest current-gen Anthropic model;
 * a 1-token ping costs ~$0.000003. If Anthropic deprecates this model id
 * the symptom is "Validate & save" failing with a clean 404 from the API —
 * easy to spot and one-line to fix here.
 */
const ANTHROPIC_VALIDATION_MODEL = "claude-haiku-4-5";
const ANTHROPIC_KEY_PREFIX = "sk-ant-";
const ANTHROPIC_KEY_MIN_LEN = 40;

// ─── Status query ──────────────────────────────────────────────────────────

/**
 * Returns the connection state for the Integrations tab. Admin-only —
 * members never need to know whether AI is configured (the tab is hidden
 * from them, and exposing the boolean would make the answer probe-able).
 *
 * Returns `null` for non-admins, matching the codebase's "admin-only
 * queries return null silently" convention.
 */
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    if (!auth.isAdmin) return null;

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .unique();

    if (!settings?.aiAnthropicKeyCiphertext) {
      return {
        provider: "anthropic" as const,
        configured: false as const,
      };
    }

    // Resolve configured-by user name. Admin-only path, so the extra DB
    // read is fine; the result is one row.
    let configuredByName: string | undefined;
    if (settings.aiKeyConfiguredBy) {
      const user = await ctx.db.get(settings.aiKeyConfiguredBy);
      configuredByName = user?.name;
    }

    return {
      provider: "anthropic" as const,
      configured: true as const,
      mask: settings.aiAnthropicKeyMask,
      configuredAt: settings.aiKeyConfiguredAt,
      configuredByName,
    };
  },
});

// ─── Public mutations / actions ────────────────────────────────────────────

/**
 * Wipe the stored key and record who/when. Idempotent — no-op when nothing
 * is stored. The audit fields (`aiKeyRemovedAt`/`aiKeyRemovedBy`) persist
 * across re-additions: they always reflect the most-recent removal.
 */
export const removeKey = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAdmin(ctx);
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .unique();
    if (!settings || !settings.aiAnthropicKeyCiphertext) return;

    const now = Date.now();
    await ctx.db.patch(settings._id, {
      aiAnthropicKeyCiphertext: undefined,
      aiAnthropicKeyMask: undefined,
      aiKeyConfiguredAt: undefined,
      aiKeyConfiguredBy: undefined,
      aiKeyRemovedAt: now,
      aiKeyRemovedBy: auth.userId,
      updatedAt: now,
    });
  },
});

/**
 * Validate a candidate Anthropic key with a live API ping, then encrypt +
 * store. Returns a discriminated result so the dialog can render a precise
 * error without inspecting a thrown ConvexError. The raw provider error
 * never reaches the client — it could echo back parts of the key or
 * other sensitive bytes.
 */
export const validateAndSaveKey = action({
  args: { plaintext: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; mask: string }
    | { ok: false; error: string }
  > => {
    // Bridge to QueryCtx auth — actions cannot run `requireAdmin` directly.
    // The internal mutation below ALSO re-runs `requireAdmin` to close
    // the TOCTOU gap (auth check here → 1-2s API ping → write).
    await ctx.runQuery(internal.lib.auth.requireAdminForAction, {});

    const candidate = args.plaintext.trim();

    // Format gate before we pay for an API call.
    if (!candidate.startsWith(ANTHROPIC_KEY_PREFIX)) {
      return {
        ok: false,
        error: `Anthropic keys start with "${ANTHROPIC_KEY_PREFIX}".`,
      };
    }
    if (candidate.length < ANTHROPIC_KEY_MIN_LEN) {
      // Real Anthropic keys are ~108 chars; 40 is a permissive lower bound
      // that catches truncated paste / missing-prefix mistakes without
      // breaking on future key-length changes.
      return {
        ok: false,
        error: "That doesn't look like a complete Anthropic API key.",
      };
    }

    const liveCheck = await pingAnthropic(candidate);
    if (!liveCheck.ok) return liveCheck;

    try {
      await ctx.runMutation(internal.aiIntegration.storeEncryptedKey, {
        plaintext: candidate,
      });
    } catch (err) {
      if (err instanceof SecretCryptoUnavailableError) {
        return {
          ok: false,
          error:
            "Server-side encryption isn't configured. Ask your operator to set " +
            "AI_KEY_ENCRYPTION_KEK on the Convex deployment.",
        };
      }
      throw err;
    }

    return { ok: true, mask: buildKeyMask(candidate) };
  },
});

/**
 * Re-validate the currently stored key without changing it. Powers the
 * "Test" button in the Integrations tab.
 */
export const testStoredKey = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    | { ok: true }
    | { ok: false; error: string }
  > => {
    await ctx.runQuery(internal.lib.auth.requireAdminForAction, {});
    const key = await ctx.runQuery(internal.aiIntegration.loadDecryptedKey, {});
    if (!key) {
      return {
        ok: false,
        error: "No API key is stored for this organization.",
      };
    }
    return await pingAnthropic(key);
  },
});

// ─── Internal storage / retrieval ──────────────────────────────────────────

/**
 * Encrypt + write the ciphertext, mask, and audit fields atomically.
 *
 * `requireAdmin` runs INSIDE so the orgId/userId come from the caller's
 * fresh auth context — not from args. This eliminates the TOCTOU window
 * between the action's initial auth check and this mutation: even if the
 * caller's role is revoked between those two moments, the write rejects.
 */
export const storeEncryptedKey = internalMutation({
  args: { plaintext: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx);

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .unique();
    if (!settings) {
      // Onboarding creates `orgSettings` before an admin can reach this
      // screen, so missing settings indicates a malformed org rather than
      // a normal user-facing error. Surface a clean message anyway — the
      // action remaps known errors before the toast.
      throw new SecretCryptoUnavailableError(
        "Organization settings not found.",
      );
    }

    const ciphertext = await encryptSecret(args.plaintext);
    const mask = buildKeyMask(args.plaintext);
    const now = Date.now();

    await ctx.db.patch(settings._id, {
      aiAnthropicKeyCiphertext: ciphertext,
      aiAnthropicKeyMask: mask,
      aiKeyConfiguredAt: now,
      aiKeyConfiguredBy: auth.userId,
      // Clear any prior removal timestamp — re-adding wipes the "removed"
      // marker so the audit field always reflects the current lifecycle
      // state (configured ⇒ removedAt is null; removed ⇒ removedAt is set).
      aiKeyRemovedAt: undefined,
      aiKeyRemovedBy: undefined,
      updatedAt: now,
    });
  },
});

/**
 * Decrypt and return the org's stored key. Returns `null` when nothing is
 * stored OR when decryption fails (wrong KEK, tampered ciphertext) — the
 * worksheet action then falls back to operator env-var keys, surfaces a
 * configuration error, or downgrades to deterministic fallback text per
 * its own error policy.
 *
 * `requireAdmin` runs inside so this internal helper can never be misused
 * by a future server-side caller that forgets to auth upstream. The
 * caller's auth context (which flows from the action via `ctx.runQuery`)
 * decides which org's key we look up — no `orgId` arg.
 *
 * Server-to-server only — exposing this as `query(...)` would leak the
 * plaintext to the browser. Never refactor this to a public query.
 */
export const loadDecryptedKey = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const auth = await requireAdmin(ctx);
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .unique();
    if (!settings?.aiAnthropicKeyCiphertext) return null;
    try {
      return await decryptSecret(settings.aiAnthropicKeyCiphertext);
    } catch (err) {
      if (
        err instanceof SecretDecryptionFailedError ||
        err instanceof SecretCryptoUnavailableError
      ) {
        // Treat as "not configured" — the action falls back gracefully.
        // The structural detail (wrong KEK vs missing KEK) is logged to
        // Convex's dashboard for operator debugging.
        console.warn(
          `[aiIntegration] Decryption failed for org ${auth.orgId}: ${err.message}`,
        );
        return null;
      }
      throw err;
    }
  },
});

// ─── Anthropic ping ─────────────────────────────────────────────────────────

/**
 * Single-shot validation call to Anthropic. Returns a normalized result so
 * callers never inspect provider-specific exceptions.
 *
 * Error sanitization:
 *   1. Strip `sk-ant-…` fragments (defensive — Anthropic doesn't currently
 *      echo keys, but SDK changes are out of our control).
 *   2. Length-cap so an oversized payload can't tile the toast.
 *   3. Map well-known HTTP statuses to friendly strings; otherwise show the
 *      sanitized raw so dev signal isn't fully lost.
 */
async function pingAnthropic(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const provider = createAnthropic({ apiKey });
    await generateText({
      model: provider(ANTHROPIC_VALIDATION_MODEL),
      prompt: "ping",
      maxOutputTokens: 1,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: normalizeAnthropicError(err) };
  }
}

function normalizeAnthropicError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const sanitized = raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 300);
  const lower = sanitized.toLowerCase();

  if (
    lower.includes("401") ||
    (lower.includes("invalid") && lower.includes("api key"))
  ) {
    return "Anthropic rejected this key (401). Double-check you copied the full value.";
  }
  if (lower.includes("403")) {
    return "Anthropic rejected this key (403). It may be disabled or rate-limited.";
  }
  if (lower.includes("429")) {
    return "Anthropic returned 429 (rate limited). Try again in a moment.";
  }
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("etimedout")
  ) {
    return "Couldn't reach Anthropic. Check your Convex deployment's network access.";
  }
  return `Anthropic API error: ${sanitized}`;
}
