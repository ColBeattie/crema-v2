import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secret generation, hashing and PKCE verification for the MCP OAuth server.
 *
 * SERVER ONLY. Nothing here is secret in itself (there is no signing key — MCP
 * tokens are opaque random strings, not JWTs), but the module imports
 * `node:crypto` and must never be pulled into a client bundle.
 *
 * WHY OPAQUE TOKENS RATHER THAN JWTs
 * A JWT cannot be revoked before it expires without a lookup, and this
 * integration's whole revocation story is "the laptop was lost, cut it off
 * now". Since every request already hits the database to load the user, a
 * random token plus an indexed hash lookup costs nothing extra and buys
 * instant revocation. It also means there is no signing key to leak.
 *
 * Tokens are stored as SHA-256 hex, never in plaintext. SHA-256 without a salt
 * or a work factor is the right choice here specifically because these are
 * 256-bit random strings, not passwords: there is no dictionary to attack and
 * nothing for a slow KDF to protect against. Do NOT copy this approach for
 * anything a human chooses.
 */

/** Prefixes make a leaked string identifiable at a glance (in a log, a paste). */
const PREFIXES = {
  code: "mcp_ac_",
  access: "mcp_at_",
  refresh: "mcp_rt_",
  request: "mcp_rq_",
} as const;

export type SecretKind = keyof typeof PREFIXES;

/**
 * A cryptographically random secret with a recognisable prefix.
 *
 * 32 bytes of entropy, base64url-encoded. `randomBytes` is the CSPRNG —
 * `Math.random()` here would be a total break, so it is worth the reminder.
 */
export function generateSecret(kind: SecretKind): string {
  return `${PREFIXES[kind]}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex. The only form in which a secret is ever persisted. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Constant-time string comparison.
 *
 * `===` on a secret leaks its prefix through timing. Length is compared first
 * because `timingSafeEqual` throws on a length mismatch — that leaks length
 * only, which is not sensitive for fixed-format tokens.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a PKCE code_verifier against the stored S256 challenge.
 *
 * Only S256 is accepted. The `plain` method is permitted by RFC 7636 but
 * offers no protection against an attacker who can read the authorization
 * request, so it is refused at both ends: the authorize endpoint rejects any
 * other method, and this function returns false rather than falling back.
 *
 * The verifier's own format is checked too (43-128 chars from the unreserved
 * set) — an over-short verifier would otherwise be brute-forceable.
 */
export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string
): boolean {
  if (method !== "S256") return false;
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;

  const computed = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return safeEqual(computed, codeChallenge);
}

/** An ISO timestamp `seconds` from now — the form Postgres columns take. */
export function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
