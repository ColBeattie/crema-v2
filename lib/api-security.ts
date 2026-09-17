import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  rateLimit,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "@/lib/rate-limiting";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { sanitizeErrorMessage } from "@/lib/error-handling";

/**
 * Shared security wrapper for API route handlers.
 *
 * API routes are excluded from the proxy/middleware matcher, so each route is
 * responsible for its own rate limiting, auth, security headers, and error
 * sanitization. Forgetting any of these ships an unprotected endpoint — an easy
 * mistake in a template that gets copied. Wrap handlers with this so the
 * defaults are secure-by-construction:
 *
 *   export const GET = withApiSecurity(
 *     { rateLimitKey: "admin-thing", requireAdmin: true },
 *     async ({ request, user }) => {
 *       // user is guaranteed non-null and an admin here
 *       return secureJson({ ... });
 *     }
 *   );
 */

/** JSON response with security headers applied. */
export function secureJson(data: unknown, status = 200): Response {
  return applySecurityHeaders(
    NextResponse.json(data, { status }),
    getEnvironmentSecurityConfig()
  );
}

/** Error response (`{ error }`) with security headers applied. */
export function secureError(error: string, status = 400): Response {
  return secureJson({ error }, status);
}

export interface ApiSecurityOptions {
  /** Unique key for the per-IP rate limiter. */
  rateLimitKey: string;
  /** Rate limit config (defaults to API_CALLS). */
  rateLimitConfig?: RateLimitConfig;
  /** Require an authenticated user (default true). Set false for public routes. */
  requireAuth?: boolean;
  /** Require the user to be an admin (implies requireAuth). Default false. */
  requireAdmin?: boolean;
}

export interface ApiContext {
  request: NextRequest;
  /** The authenticated user, or null when requireAuth is false and nobody is logged in. */
  user: User | null;
}

type ApiHandler = (ctx: ApiContext) => Promise<Response> | Response;

export function withApiSecurity(
  options: ApiSecurityOptions,
  handler: ApiHandler
): (request: NextRequest) => Promise<Response> {
  const {
    rateLimitKey,
    rateLimitConfig = RATE_LIMIT_CONFIGS.API_CALLS,
    requireAuth = true,
    requireAdmin = false,
  } = options;

  return async (request: NextRequest): Promise<Response> => {
    try {
      // 1. Rate limit (per IP).
      const rl = rateLimit(rateLimitKey, rateLimitConfig)(request);
      if (!rl.allowed) {
        return secureError("Too many requests. Please try again later.", 429);
      }

      // 2. Auth / role.
      let user: User | null = null;
      if (requireAuth || requireAdmin) {
        const supabase = await createClient();
        const {
          data: { user: authedUser },
          error,
        } = await supabase.auth.getUser();

        if (error || !authedUser) {
          return secureError("Unauthorized", 401);
        }
        if (requireAdmin && authedUser.app_metadata?.role !== "admin") {
          return secureError("Admin access required", 403);
        }
        user = authedUser;
      }

      // 3. Run the handler, then guarantee security headers on the response.
      const response = await handler({ request, user });
      return applySecurityHeaders(response, getEnvironmentSecurityConfig());
    } catch (error: unknown) {
      console.error(`[api:${rateLimitKey}]`, error);
      // This catch returns the error as a 500 value, so it never reaches
      // Sentry's auto-instrumentation — report it explicitly. No-ops without a
      // DSN / outside production.
      Sentry.captureException(error, { tags: { route: rateLimitKey } });
      return secureError(sanitizeErrorMessage(error), 500);
    }
  };
}
