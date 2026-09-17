import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * HS256 JWT signing for the Productivity Tools Support widget.
 *
 * SERVER ONLY — this module must be imported by `app/api/support-token/route.ts`
 * and nothing else. `SUPPORT_SIGNING_SECRET` grants the ability to impersonate
 * any user of this application inside our support system: if it ever reaches the
 * browser, anyone can read every ticket raised for this app. Two things keep it
 * server-side, and both must hold:
 *   1. The variable carries no `NEXT_PUBLIC_` prefix, so Next.js never inlines
 *      it into a client bundle (it would evaluate to `undefined` there).
 *   2. No `"use client"` module imports this file.
 * The usual third guard, `import "server-only"`, would turn a violation into a
 * build error — it is deliberately absent because that package is not a
 * dependency here and this repo requires asking before adding one. Add it if
 * you ever install it.
 *
 * We sign with Node's built-in HMAC instead of a JWT library because this repo
 * requires asking before adding dependencies (`.claude/rules/workflow.md`) and
 * we only ever *sign* here — never verify — which is about fifteen lines.
 * `support-token.test.ts` proves the implementation against the canonical
 * jwt.io vector; do not change the encoding without re-running it.
 */

/** Audience is fixed by the support platform — do not make this configurable. */
export const SUPPORT_AUDIENCE = "nexus-support";

/** Token lifetime. The SDK silently renews, so short is correct. */
export const SUPPORT_TOKEN_TTL_SECONDS = 10 * 60;

/**
 * The only two roles the support platform accepts.
 *
 * - `customer_user`  — sees all tickets raised for THIS application.
 * - `customer_admin` — sees all tickets raised by this company, across every
 *   application and environment.
 *
 * Both are broader than "their own tickets": support is a shared team inbox by
 * design. That is why the route gates on entitlement before minting.
 */
export type SupportRole = "customer_user" | "customer_admin";

export interface SupportClaims {
  /** Stable internal user id — the primary key, never the email. */
  sub: string;
  email?: string;
  name?: string;
  role: SupportRole;
}

interface SupportEnv {
  secret: string;
  issuerId: string;
  keyId: string;
}

/** Base64url: standard base64 with +/ swapped for -_ and padding stripped. */
function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Sign an HS256 JWT.
 *
 * Exported for the test that pins it to the jwt.io reference vector. Callers in
 * app code should use `mintSupportToken` instead, which fills in the required
 * claims.
 */
export function signHs256(
  claims: Record<string, unknown>,
  secret: string,
  keyId?: string
): string {
  // Key order is load-bearing for the jwt.io vector: {alg, typ} with no kid.
  const header = keyId
    ? { alg: "HS256", typ: "JWT", kid: keyId }
    : { alg: "HS256", typ: "JWT" };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims)
  )}`;

  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Read and validate the support environment.
 *
 * Returns null when the integration is not configured (the template's default
 * state) so the route can answer with a clear 503 instead of minting a token
 * signed with `undefined`.
 */
export function getSupportEnv(): SupportEnv | null {
  const secret = process.env.SUPPORT_SIGNING_SECRET;
  const issuerId = process.env.SUPPORT_ISSUER_ID;
  const keyId = process.env.SUPPORT_KEY_ID;

  if (!secret || !issuerId || !keyId) return null;
  return { secret, issuerId, keyId };
}

/**
 * Mint a fresh support token. Never cache, store or reuse the result — every
 * call gets a new `jti` and a new 10-minute window.
 */
export function mintSupportToken(claims: SupportClaims, env: SupportEnv) {
  const now = Math.floor(Date.now() / 1000);

  return signHs256(
    {
      iss: env.issuerId,
      aud: SUPPORT_AUDIENCE,
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      role: claims.role,
      iat: now,
      exp: now + SUPPORT_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
    },
    env.secret,
    env.keyId
  );
}

/**
 * Constant-time string compare, for anything that ever needs to check a support
 * secret rather than sign with it. Not used by the mint path today, but keeping
 * it here means nobody reaches for `===` later.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
