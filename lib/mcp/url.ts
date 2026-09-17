/**
 * Working out this deployment's public origin.
 *
 * The OAuth metadata documents must advertise absolute URLs, and they have to
 * be the URLs the AI client actually reached — a mismatch between the issuer it
 * discovered and the issuer we advertise fails the client's own validation.
 * The AI Integration page needs the same value for the command it prints.
 *
 * Order of preference:
 *   1. `NEXT_PUBLIC_SITE_URL`, when a deployment pins its canonical origin.
 *   2. The forwarded headers, which is what the request really came in on
 *      (covers preview deployments, ngrok tunnels and custom domains without
 *      any configuration).
 *   3. The request URL itself.
 *
 * The forwarded headers are attacker-controllable in principle. That is
 * acceptable here and nowhere else in this codebase: these values are only
 * echoed into public discovery documents and rendered on a page, never used to
 * make an authorization decision or to build a redirect target. Redirect
 * targets come from the client's registered `redirect_uris` (exact match, see
 * `lib/mcp/store.ts`) — do not start deriving them from here.
 */

/** Origin from a plain `Headers` bag — for server components via `headers()`. */
export function getBaseUrlFromHeaders(headers: Headers): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const host = headers.get("x-forwarded-host") || headers.get("host");
  if (!host) return null;

  const proto =
    headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${proto}://${host}`;
}

/** Origin from a request — for route handlers. */
export function getBaseUrl(request: Request): string {
  return getBaseUrlFromHeaders(request.headers) ?? new URL(request.url).origin;
}
