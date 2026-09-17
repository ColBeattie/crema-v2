interface AmrEntry {
  method?: string;
  timestamp?: number;
}

interface JwtPayload {
  amr?: AmrEntry[];
  [key: string]: unknown;
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes the JWT payload WITHOUT verifying its signature, expiry, or audience.
 *
 * SECURITY: a forged token can produce any payload here. This is only safe
 * because every caller uses the result to RESTRICT access (force a recovery/
 * invite session into the password-reset flow), never to GRANT it — and the
 * session itself is independently validated by supabase.auth.getUser(). Do NOT
 * use this for an allow/authorization decision. If you ever need a verified
 * claim, use supabase.auth.getClaims() (which verifies) instead.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

export function isRecoverySession(token: string | undefined | null): boolean {
  return hasAmrMethod(token, "recovery");
}

export function isInviteSession(token: string | undefined | null): boolean {
  return hasAmrMethod(token, "invite");
}

function hasAmrMethod(
  token: string | undefined | null,
  method: string
): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  return (
    Array.isArray(payload?.amr) &&
    payload.amr.some((entry) => entry?.method === method)
  );
}
