/**
 * AES-GCM envelope encryption for customer-provided secrets (BYOK).
 *
 * # Threat model
 *
 *   - **At-rest**: Convex encrypts row data at the storage layer. We add a
 *     second layer (envelope encryption with a deployment-scoped KEK) so
 *     an operator with raw DB read access still cannot read customer keys
 *     without ALSO compromising the Convex env var.
 *   - **In-flight**: plaintext never crosses the client boundary; it only
 *     exists inside a Convex action's runtime during validate-and-save and
 *     during the worksheet AI call.
 *   - **Compromise containment**: rotating the KEK invalidates all v1
 *     ciphertexts. The version prefix below makes future schemes (v2 with
 *     a new KEK ID, AEAD with AAD, etc.) coexist with v1 during a phased
 *     migration — write v2, read both. We don't ship rotation today, but
 *     the format is forward-compatible.
 *
 * # Ciphertext format
 *
 * Stored value: `"v1:<base64>"` where `<base64>` is `iv (12B) || ct_with_tag`.
 * AES-GCM's auth tag (16B) is concatenated to the ciphertext by the Web
 * Crypto API itself, so `ct_with_tag.length == plaintext.length + 16`.
 *
 * # KEK
 *
 * Format: base64-encoded 32-byte raw key. Generate with:
 *
 *   openssl rand -base64 32
 *
 * Set on Convex (both deployments — same value):
 *
 *   npx convex env set AI_KEY_ENCRYPTION_KEK <generated>
 *   npx convex env set AI_KEY_ENCRYPTION_KEK <generated> --prod
 *
 * The imported CryptoKey is memoized at module scope. Env vars are
 * deployment-scoped and immutable for the lifetime of a runtime instance,
 * so memoizing is safe and saves ~1-2ms per encrypt/decrypt call.
 */

/** Thrown when the encryption scheme can't function — missing/invalid KEK. */
export class SecretCryptoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretCryptoUnavailableError";
  }
}

/** Thrown when stored ciphertext fails to decrypt (wrong KEK, tampered, corrupt). */
export class SecretDecryptionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionFailedError";
  }
}

const KEK_ENV = "AI_KEY_ENCRYPTION_KEK";
const IV_BYTES = 12;
const VERSION_PREFIX_V1 = "v1:";

// ─── Base64 helpers ─────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // String.fromCharCode is the standard one-liner in V8 runtimes that don't
  // expose Node's `Buffer`. Convex actions run in V8.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ─── KEK loader (memoized) ──────────────────────────────────────────────────

let memoizedKek: CryptoKey | null = null;
let memoizedKekError: SecretCryptoUnavailableError | null = null;

async function getKek(): Promise<CryptoKey> {
  if (memoizedKek) return memoizedKek;
  if (memoizedKekError) throw memoizedKekError;

  const raw = process.env[KEK_ENV];
  if (!raw) {
    memoizedKekError = new SecretCryptoUnavailableError(
      `${KEK_ENV} env var is not set on this Convex deployment. ` +
        `Generate one with \`openssl rand -base64 32\` and set it via ` +
        `\`npx convex env set ${KEK_ENV} <value>\`.`,
    );
    throw memoizedKekError;
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(raw.trim());
  } catch {
    memoizedKekError = new SecretCryptoUnavailableError(
      `${KEK_ENV} is not valid base64. Regenerate with \`openssl rand -base64 32\`.`,
    );
    throw memoizedKekError;
  }

  if (keyBytes.length !== 32) {
    memoizedKekError = new SecretCryptoUnavailableError(
      `${KEK_ENV} must decode to exactly 32 bytes (got ${keyBytes.length}). ` +
        `Regenerate with \`openssl rand -base64 32\`.`,
    );
    throw memoizedKekError;
  }

  // Copy into a fresh ArrayBuffer so the type lines up with the strict-mode
  // BufferSource signature (Uint8Array.buffer can be SharedArrayBuffer).
  const fresh = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(fresh).set(keyBytes);
  memoizedKek = await crypto.subtle.importKey(
    "raw",
    fresh,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return memoizedKek;
}

/**
 * Reset memoized state. Test-only — exported under an `__` prefix so the
 * intent is unmistakable.
 */
export function __resetSecretCryptoCacheForTests(): void {
  memoizedKek = null;
  memoizedKekError = null;
}

// ─── Encrypt / decrypt ──────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 secret. Returns `"v1:<base64>"`.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (plaintext.length === 0) {
    throw new Error("encryptSecret: refusing to encrypt empty string");
  }
  const kek = await getKek();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);

  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return `${VERSION_PREFIX_V1}${bytesToBase64(combined)}`;
}

/**
 * Decrypt a value produced by `encryptSecret`. Throws
 * `SecretDecryptionFailedError` for any tampering / wrong-KEK condition.
 * Callers should map this to a generic user-facing message and NEVER echo
 * the underlying error to the client.
 */
export async function decryptSecret(stored: string): Promise<string> {
  if (!stored.startsWith(VERSION_PREFIX_V1)) {
    throw new SecretDecryptionFailedError(
      `Unsupported ciphertext format (expected ${VERSION_PREFIX_V1} prefix). ` +
        "This row may have been written by a future version of the encryption scheme.",
    );
  }
  const b64 = stored.slice(VERSION_PREFIX_V1.length);

  let combined: Uint8Array;
  try {
    combined = base64ToBytes(b64);
  } catch {
    throw new SecretDecryptionFailedError("Stored secret is not valid base64");
  }
  if (combined.length <= IV_BYTES) {
    throw new SecretDecryptionFailedError("Stored secret is too short");
  }

  const iv = combined.slice(0, IV_BYTES);
  const ct = combined.slice(IV_BYTES);

  const kek = await getKek();
  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      kek,
      ct,
    );
  } catch {
    // SubtleCrypto throws an opaque DOMException for any failure (wrong key,
    // tampered tag, wrong IV). Don't surface the underlying error — it can
    // leak structural detail to a length-extension probe.
    throw new SecretDecryptionFailedError(
      "Stored secret could not be decrypted (wrong KEK or tampered ciphertext)",
    );
  }
  return new TextDecoder().decode(plaintextBuf);
}

// ─── Display mask ───────────────────────────────────────────────────────────

/**
 * Mask for the Settings UI. Format: first 8 chars + `…` + last 4 chars.
 * Anthropic keys begin `sk-ant-…<random>`; the head confirms provider,
 * the tail helps an admin recognize "yes, that's the key I pasted."
 *
 * Pathologically short input collapses to a fixed-shape dot pattern so the
 * mask itself doesn't leak the input's length. Real Anthropic keys are
 * ~108 chars, so this branch is only hit on malformed test data.
 */
export function buildKeyMask(plaintext: string): string {
  const MIN_LEN_FOR_REAL_MASK = 12;
  if (plaintext.length <= MIN_LEN_FOR_REAL_MASK) {
    return "•".repeat(8) + "…" + "•".repeat(4);
  }
  return `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
}
