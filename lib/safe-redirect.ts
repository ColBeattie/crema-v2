/**
 * Safe relative-redirect validation.
 *
 * Only same-origin relative paths are allowed. This rejects:
 *  - absolute URLs (`https://evil.com`, `javascript:...`)
 *  - protocol-relative URLs (`//evil.com`)
 *  - backslash escapes (`/\evil.com`) — WHATWG `URL` normalizes `\` to `/`,
 *    so a naive `startsWith("//")` check misses this and resolves cross-origin
 *  - control characters and overly long values
 *
 * The authoritative check resolves the candidate against a throwaway base
 * origin and confirms the result stayed on that origin. Anything that escapes
 * the origin (or fails to parse) falls back to `fallback`.
 *
 * Works in both server and client code (no `window` dependency).
 */
const SAFE_BASE = "https://redirect.invalid";

// Backslash (0x5c), any C0 control char (<= 0x1f), or DEL (0x7f).
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function sanitizeNextPath(
  next: string | null | undefined,
  fallback = "/"
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) {
    return fallback;
  }

  // Must be a path rooted at "/", and not protocol-relative.
  if (!next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }

  // Reject backslashes (cross-origin escape) and control characters anywhere.
  if (hasUnsafeChar(next)) {
    return fallback;
  }

  // Authoritative: must resolve to the same throwaway origin.
  try {
    const resolved = new URL(next, SAFE_BASE);
    if (resolved.origin !== SAFE_BASE) {
      return fallback;
    }
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
