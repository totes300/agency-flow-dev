/**
 * The client prefix format (docs/prd-mcp.md §7, owner 2026-10-24): letters
 * A–Z and digits, at most 10 characters. Saved uppercase; matched
 * case-insensitively. Pure and dependency-free: the client save mutations
 * and the MCP reference parser (lib/mcp/refs.ts, `client:KONV`) share it.
 */

export const CLIENT_PREFIX_MAX_LENGTH = 10;

/** A usable prefix in any case (legacy rows may be lowercase). */
export const CLIENT_PREFIX_PATTERN = /^[A-Za-z0-9]{1,10}$/;

export function isValidClientPrefix(prefix: string): boolean {
  return CLIENT_PREFIX_PATTERN.test(prefix);
}
