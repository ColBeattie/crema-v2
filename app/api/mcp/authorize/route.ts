import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { rateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import {
  MCP_SCOPE_READ,
  MCP_SETUP_REQUIRED_MESSAGE,
  MCP_SUPPORTED_SCOPES,
} from "@/lib/mcp/config";
import {
  createAuthorizationRequest,
  getClient,
  isRegisteredRedirectUri,
  McpNotProvisionedError,
} from "@/lib/mcp/store";

/**
 * OAuth authorization endpoint.
 *
 * The AI client sends the user's browser here with the OAuth parameters. This
 * route does not render anything: it validates, parks the request, and hands
 * off to the consent page.
 *
 * ── WHY THE PARAMETERS ARE PARKED IN THE DATABASE ────────────────────────────
 * The visitor is usually not signed in yet. The routing middleware sends them
 * to `/auth/login?redirectTo=<path>` — and it passes the PATH ONLY, dropping
 * the query string. So the OAuth parameters cannot survive the login + MFA
 * round trip in the URL. They are stored under an unguessable id which travels
 * as a path segment (`/ai-integration/authorize/<id>`) and comes back intact.
 *
 * ── ERROR HANDLING FOLLOWS THE SPEC, WHICH IS NOT INTUITIVE ──────────────────
 * Once `client_id` and `redirect_uri` are known-good, errors are reported by
 * redirecting BACK to the client with `?error=...` — that is how the waiting
 * CLI learns what went wrong instead of hanging. Before they are validated,
 * errors must be rendered here: redirecting to an unverified `redirect_uri`
 * would make this endpoint an open redirect, and would hand the authorization
 * code to whoever supplied the URL.
 */

export const dynamic = "force-dynamic";

/** An error the user must see, because we cannot trust anywhere to send them. */
function renderError(message: string, status = 400): Response {
  return applySecurityHeaders(
    NextResponse.json(
      { error: "invalid_request", error_description: message },
      { status }
    ),
    getEnvironmentSecurityConfig()
  );
}

/** An error the waiting client must see, delivered to its registered callback. */
function redirectError(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);

  return applySecurityHeaders(
    NextResponse.redirect(url.toString()),
    getEnvironmentSecurityConfig()
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Unauthenticated endpoint that writes a row, so it is rate limited per IP.
    const rl = rateLimit(
      "mcp-authorize",
      RATE_LIMIT_CONFIGS.API_CALLS
    )(request);
    if (!rl.allowed) {
      return renderError("Too many requests. Please try again later.", 429);
    }

    const params = request.nextUrl.searchParams;
    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    const responseType = params.get("response_type");
    const codeChallenge = params.get("code_challenge");
    const codeChallengeMethod = params.get("code_challenge_method");
    const state = params.get("state");
    const scope = params.get("scope");
    const resource = params.get("resource");

    // ── Phase 1: establish where we may safely redirect ─────────────────────
    // Nothing below may redirect to `redirect_uri` until it has been matched
    // against the client's registered list.

    if (!clientId) return renderError("Missing client_id.");
    if (!redirectUri) return renderError("Missing redirect_uri.");

    const client = await getClient(clientId);
    if (!client) {
      return renderError(
        "This AI client is not registered with this application."
      );
    }
    if (!isRegisteredRedirectUri(client, redirectUri)) {
      // Deliberately NOT redirected: an unregistered redirect_uri is exactly
      // the attack this check exists to stop.
      return renderError(
        "The redirect URI is not registered for this client. Check the --callback-port in your setup command."
      );
    }

    // ── Phase 2: the redirect target is trusted; report errors to the client ─

    if (responseType !== "code") {
      return redirectError(
        redirectUri,
        "unsupported_response_type",
        "Only the authorization code flow is supported.",
        state
      );
    }

    // PKCE is mandatory. A public client without it has nothing binding the
    // code to the process that asked for it.
    if (!codeChallenge) {
      return redirectError(
        redirectUri,
        "invalid_request",
        "PKCE is required: missing code_challenge.",
        state
      );
    }
    if (codeChallengeMethod !== "S256") {
      return redirectError(
        redirectUri,
        "invalid_request",
        "PKCE code_challenge_method must be S256.",
        state
      );
    }

    // Unknown scopes are refused rather than silently narrowed, so a client
    // never believes it holds access it was not granted.
    const requestedScopes = scope ? scope.split(/\s+/).filter(Boolean) : [];
    const unsupported = requestedScopes.filter(
      (s) => !MCP_SUPPORTED_SCOPES.includes(s)
    );
    if (unsupported.length > 0) {
      return redirectError(
        redirectUri,
        "invalid_scope",
        `Unsupported scope: ${unsupported.join(", ")}`,
        state
      );
    }
    const grantedScope =
      requestedScopes.length > 0 ? requestedScopes.join(" ") : MCP_SCOPE_READ;

    const requestId = await createAuthorizationRequest({
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state,
      scope: grantedScope,
      resource,
    });

    // Hand off to the consent page. It is a normal protected route, so the
    // middleware takes care of sign-in and the TOTP challenge before it ever
    // renders — this integration does not reimplement any of that.
    return applySecurityHeaders(
      NextResponse.redirect(
        new URL(`/ai-integration/authorize/${requestId}`, request.url)
      ),
      getEnvironmentSecurityConfig()
    );
  } catch (error) {
    if (error instanceof McpNotProvisionedError) {
      // Rendered in the user's browser mid-flow, so it names who enables it
      // rather than telling the reader to run a migration they have no access to.
      return renderError(MCP_SETUP_REQUIRED_MESSAGE, 503);
    }
    console.error("[mcp:authorize]", error);
    Sentry.captureException(error, { tags: { route: "mcp-authorize" } });
    return renderError("Could not start the authorization flow.", 500);
  }
}
