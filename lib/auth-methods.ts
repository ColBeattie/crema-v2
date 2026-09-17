/**
 * Helpers for reading the authentication methods (AMR) on a Supabase session.
 *
 * Kept free of any Supabase import so middleware, server code and unit tests
 * can all use it.
 */

/**
 * True when the current session was established with a first-factor passkey.
 *
 * `currentAuthenticationMethods` from `getAuthenticatorAssuranceLevel()` is
 * typed `AMREntry[] | string[]`: GoTrue may return the detailed objects
 * (`{ method: "passkey", timestamp }`) or the plain RFC-8176 method strings.
 * Handling only one shape means the check silently returns false against the
 * other, which in `checkAal2Enforcement` shows up as passkey users being
 * bounced to the MFA prompt on every request. Handle both.
 */
export function signedInWithPasskey(methods: unknown): boolean {
  if (!Array.isArray(methods)) return false;

  return methods.some((entry) => {
    if (typeof entry === "string") return entry === "passkey";
    if (entry && typeof entry === "object") {
      return (entry as { method?: unknown }).method === "passkey";
    }
    return false;
  });
}
