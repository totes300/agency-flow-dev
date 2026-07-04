/**
 * Tests for the BYOK envelope encryption helpers.
 *
 * We exercise:
 *   1. Round-trip fidelity (encrypt → decrypt = identity).
 *   2. Output non-determinism (same input encrypts to a different ciphertext
 *      every time — confirms random IV).
 *   3. Version prefix presence + rejection of unprefixed/wrong-prefixed input.
 *   4. Tamper detection (mutating one byte of ciphertext fails decryption).
 *   5. Wrong-KEK rejection (decrypt with a different KEK = clean failure).
 *   6. KEK validation paths (missing, malformed, wrong length).
 *   7. Mask format (head/tail visibility, no middle leakage).
 *
 * These tests run in Node via vitest, which provides Web Crypto under
 * `globalThis.crypto` from Node 20+. Convex's V8 runtime exposes the same
 * API, so behavior parity holds.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  __resetSecretCryptoCacheForTests,
  buildKeyMask,
  decryptSecret,
  encryptSecret,
  SecretCryptoUnavailableError,
  SecretDecryptionFailedError,
} from "./secretCrypto"

// Two distinct 32-byte KEKs, base64-encoded. Computed at module load so we
// guarantee proper padding/length — eyeballing hand-typed base64 risks
// 33-byte slips that masquerade as crypto failures during debugging.
function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
const KEK_A = toBase64(Uint8Array.from({ length: 32 }, (_, i) => i))
const KEK_B = toBase64(Uint8Array.from({ length: 32 }, (_, i) => 255 - i))

const SAMPLE_KEY = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN"

function setKek(value: string | undefined) {
  if (value === undefined) delete process.env.AI_KEY_ENCRYPTION_KEK
  else process.env.AI_KEY_ENCRYPTION_KEK = value
  __resetSecretCryptoCacheForTests()
}

describe("secretCrypto", () => {
  const originalKek = process.env.AI_KEY_ENCRYPTION_KEK

  beforeEach(() => {
    setKek(KEK_A)
  })

  afterEach(() => {
    setKek(originalKek)
  })

  // ─── Round-trip ───────────────────────────────────────────────────────────

  it("round-trips a typical Anthropic-shaped key", async () => {
    const ct = await encryptSecret(SAMPLE_KEY)
    expect(await decryptSecret(ct)).toBe(SAMPLE_KEY)
  })

  it("round-trips arbitrary unicode", async () => {
    const plaintext = "héllo wörld 🌍 — accents + emoji"
    const ct = await encryptSecret(plaintext)
    expect(await decryptSecret(ct)).toBe(plaintext)
  })

  it("refuses to encrypt an empty string", async () => {
    await expect(encryptSecret("")).rejects.toThrow(
      /refusing to encrypt empty string/,
    )
  })

  // ─── IV randomness ────────────────────────────────────────────────────────

  it("produces a different ciphertext each call for the same plaintext", async () => {
    const a = await encryptSecret(SAMPLE_KEY)
    const b = await encryptSecret(SAMPLE_KEY)
    expect(a).not.toBe(b)
    // Both still decrypt to the same plaintext.
    expect(await decryptSecret(a)).toBe(SAMPLE_KEY)
    expect(await decryptSecret(b)).toBe(SAMPLE_KEY)
  })

  // ─── Version prefix ───────────────────────────────────────────────────────

  it("emits a v1: prefix on every ciphertext", async () => {
    const ct = await encryptSecret(SAMPLE_KEY)
    expect(ct.startsWith("v1:")).toBe(true)
  })

  it("rejects ciphertext without a recognized prefix", async () => {
    const ct = await encryptSecret(SAMPLE_KEY)
    const stripped = ct.slice("v1:".length)
    await expect(decryptSecret(stripped)).rejects.toBeInstanceOf(
      SecretDecryptionFailedError,
    )
  })

  it("rejects a future-version prefix it doesn't understand", async () => {
    await expect(decryptSecret("v99:abcd")).rejects.toBeInstanceOf(
      SecretDecryptionFailedError,
    )
  })

  // ─── Tamper detection ────────────────────────────────────────────────────

  it("rejects ciphertext with a flipped tag byte (GCM auth catches it)", async () => {
    const ct = await encryptSecret(SAMPLE_KEY)
    // Decode the base64 payload, flip the last byte (part of GCM tag), re-encode.
    const b64 = ct.slice("v1:".length)
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    bytes[bytes.length - 1] ^= 0x01
    let mutated = ""
    for (let i = 0; i < bytes.length; i++) mutated += String.fromCharCode(bytes[i])
    const tampered = `v1:${btoa(mutated)}`

    await expect(decryptSecret(tampered)).rejects.toBeInstanceOf(
      SecretDecryptionFailedError,
    )
  })

  it("rejects too-short ciphertext", async () => {
    await expect(decryptSecret("v1:AAA=")).rejects.toBeInstanceOf(
      SecretDecryptionFailedError,
    )
  })

  // ─── Wrong-KEK rejection ─────────────────────────────────────────────────

  it("fails decryption when the KEK changes between encrypt and decrypt", async () => {
    const ct = await encryptSecret(SAMPLE_KEY)
    setKek(KEK_B) // simulate KEK rotation without re-encryption
    await expect(decryptSecret(ct)).rejects.toBeInstanceOf(
      SecretDecryptionFailedError,
    )
  })

  // ─── KEK validation ──────────────────────────────────────────────────────

  it("surfaces a clear error when the KEK is missing", async () => {
    setKek(undefined)
    await expect(encryptSecret(SAMPLE_KEY)).rejects.toBeInstanceOf(
      SecretCryptoUnavailableError,
    )
  })

  it("rejects a non-base64 KEK", async () => {
    setKek("this is not valid base64 !!!")
    await expect(encryptSecret(SAMPLE_KEY)).rejects.toBeInstanceOf(
      SecretCryptoUnavailableError,
    )
  })

  it("rejects a KEK that decodes to the wrong length", async () => {
    // 16 bytes — too short for AES-256.
    setKek("AAECAwQFBgcICQoLDA0ODw==")
    await expect(encryptSecret(SAMPLE_KEY)).rejects.toBeInstanceOf(
      SecretCryptoUnavailableError,
    )
  })
})

describe("buildKeyMask", () => {
  it("shows the first 8 and last 4 chars of a normal key", () => {
    expect(buildKeyMask("sk-ant-abcdefghijklmnopqrstuvwxyz1234")).toBe(
      "sk-ant-a…1234",
    )
  })

  it("never includes the middle of the key", () => {
    const mask = buildKeyMask("sk-ant-SECRETMIDDLEPARTwxyz")
    expect(mask).not.toContain("SECRETMIDDLE")
  })

  it("collapses to a fixed-shape pattern for pathologically short input", () => {
    // The format gate in validateAndSaveKey rejects keys this short, but
    // the helper must still not leak length-comparable structure.
    expect(buildKeyMask("short")).toBe("••••••••…••••")
    expect(buildKeyMask("12345678")).toBe("••••••••…••••")
  })

  it("works on exactly the boundary length", () => {
    // 13 chars — just above the short cutoff (12).
    expect(buildKeyMask("0123456789abc")).toBe("01234567…9abc")
  })
})
