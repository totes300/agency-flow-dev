/**
 * Pure connector-framework logic (PRD Module 4 · slice 10). The connector
 * chassis lets a user authenticate an external account once (per-user, V1);
 * connector-backed tools then resolve THAT user's live credentials at run
 * time. Wave 1 ships the framework and one dev/mock connector ("Echo"); the
 * first real provider (Gmail, email triage) is catalogued hidden until its
 * OAuth flow lands (B1).
 *
 * This module owns everything about connectors that needs no I/O: the
 * type catalog (code, like the tool registry), the status vocabulary, the
 * usable/resolution classification, and the self-explaining guidance a
 * connector-backed tool returns when the running user has no live
 * connection. Credential encryption + persistence live in `convex/connectors.ts`
 * (reusing the AES-GCM/KEK crypto in `convex/lib/secretCrypto.ts`).
 *
 * No React, no Convex — unit-tested in connectors.test.ts.
 */

// ─── Type catalog (code, not data) ──────────────────────────────────────────

/** Every connector type the platform knows (grows per wave). */
export type ConnectorType = "echo" | "gmail";

/**
 * How a connector is authenticated. `token` = the user pastes a secret we
 * store as-is (the Echo dev connector); `oauth` = a redirect flow yields
 * access/refresh tokens (Gmail, Wave 3). The lifecycle surface branches on
 * this so a new `oauth` type is additive, not surgery.
 */
export type ConnectorAuthKind = "token" | "oauth";

/**
 * Connection lifecycle status. `connected` is the only usable state; the
 * other three are terminal-until-reconnect and each renders its own message:
 *   - `expired`  — an OAuth token lapsed (Wave 3; the surface/resolution are
 *                  wired for it now so the provider work is pure addition).
 *   - `error`    — the stored credential can't be used (e.g. decryption
 *                  failed after a KEK change / corruption); flipped at
 *                  resolve time so the failure is visible, not silent.
 *   - `revoked`  — the user disconnected it themselves.
 */
export type ConnectorStatus = "connected" | "expired" | "error" | "revoked";

export type ConnectorTypeMeta = {
  type: ConnectorType;
  /** Shown on the Connectors surface and inside guidance messages. */
  displayName: string;
  /** One-line human blurb for the Connectors surface. */
  description: string;
  authKind: ConnectorAuthKind;
  /** Registry tool names this connector backs (resolve against it at run time). */
  toolNames: readonly string[];
  /** Scopes stored on the connection at connect time (audit + future OAuth). */
  defaultScopes: readonly string[];
  /**
   * Not on the Connectors surface (`getConnectorCatalog` leaves it out). For
   * a type whose connect flow does not exist yet, so the surface never shows
   * a Connect button that cannot work. Rows of the type may still exist
   * (e.g. the email-triage dev seed mailbox).
   */
  hidden?: true;
};

/**
 * The vetted connector catalog. Wave 1 ships exactly one entry — the Echo
 * dev/mock connector — so the full connect → resolve → disconnect lifecycle
 * is exercisable without any external OAuth. Gmail joins here in Wave 3.
 */
export const CONNECTOR_CATALOG: Record<ConnectorType, ConnectorTypeMeta> = {
  echo: {
    type: "echo",
    displayName: "Echo",
    description:
      "A development connector that echoes text back through a token you " +
      "store. It exercises the full connect → resolve → disconnect lifecycle " +
      "without any external sign-in.",
    authKind: "token",
    toolNames: ["echo"],
    defaultScopes: ["echo:read"],
  },
  // Email triage (docs/prd-email-triage.md §4.2, D17, D23): one mailbox per
  // user, access + refresh token encrypted with convex/lib/secretCrypto.ts.
  // Hidden until B1 ships the OAuth flow (PKCE, `oauthStates`, callback
  // routes) — TODO(B1): unhide behind `emailTriageEnabled` (I14), so other
  // tenants never see the row. No registry tools: the email jobs read
  // through convex/email/*, not through the model.
  gmail: {
    type: "gmail",
    displayName: "Gmail",
    description:
      "Your Gmail mailbox. Client emails become Triage items; replies you " +
      "approve are sent from it.",
    authKind: "oauth",
    toolNames: [],
    defaultScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    hidden: true,
  },
};

/** The surfaced catalog as an ordered array — what a Convex query hands the surface. */
export function getConnectorCatalog(): ConnectorTypeMeta[] {
  return Object.values(CONNECTOR_CATALOG).filter((meta) => !meta.hidden);
}

export function isConnectorType(value: unknown): value is ConnectorType {
  return typeof value === "string" && value in CONNECTOR_CATALOG;
}

/** Catalog lookup; null for an unknown type (a stale/renamed reference). */
export function getConnectorMeta(type: string): ConnectorTypeMeta | null {
  return isConnectorType(type) ? CONNECTOR_CATALOG[type] : null;
}

// ─── Resolution / status classification (pure) ──────────────────────────────

/**
 * The outcome of resolving a running user's connection for a type. `missing`
 * (no row at all) is distinct from the three stored non-usable statuses so
 * the guidance can read naturally ("connect it" vs "reconnect it").
 */
export type ConnectionResolution =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "error" | "revoked" };

/**
 * Classify a stored connection status (or `null` for no connection at all).
 * The ONE law: only `connected` is usable. This is the single decision the
 * run-time resolver and the surface both defer to, so tool behavior and the
 * badge can never disagree.
 */
export function classifyConnection(
  status: ConnectorStatus | null,
): ConnectionResolution {
  if (status === null) return { ok: false, reason: "missing" };
  if (status === "connected") return { ok: true };
  // expired | error | revoked map straight through.
  return { ok: false, reason: status };
}

/** True only for a live, usable connection. */
export function isConnectionUsable(status: ConnectorStatus | null): boolean {
  return classifyConnection(status).ok;
}

// ─── Self-explaining guidance (US 40) ───────────────────────────────────────

/** Where the Connectors surface lives, named the same everywhere. */
export const CONNECTORS_LOCATION = "the Connectors panel in the agent workspace";

export type ConnectionFailureReason = "missing" | "expired" | "error" | "revoked";

/**
 * The message a connector-backed tool returns to the model when it cannot
 * resolve a live connection for the running user. The agent relays it
 * verbatim, so the failure is self-explaining ("connect X in …") and the run
 * never crashes — it just can't use that tool this turn.
 */
export function connectorGuidanceMessage(
  meta: ConnectorTypeMeta,
  reason: ConnectionFailureReason,
): string {
  const connect = `Connect it in ${CONNECTORS_LOCATION}, then try again.`;
  const reconnect = `Reconnect it in ${CONNECTORS_LOCATION}, then try again.`;
  switch (reason) {
    case "missing":
      return `The ${meta.displayName} connector isn't connected for your account yet. ${connect}`;
    case "revoked":
      return `Your ${meta.displayName} connection was disconnected. ${reconnect}`;
    case "expired":
      return `Your ${meta.displayName} connection has expired. ${reconnect}`;
    case "error":
      return `Your ${meta.displayName} connection hit an error and can't be used right now. ${reconnect}`;
  }
}
