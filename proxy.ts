import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { validateEnvVars } from "@/lib/supabase/config";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";

export async function proxy(request: NextRequest) {
  // Check if Supabase is configured
  const { isValid } = validateEnvVars();

  // Setup / unconfigured paths still get the full security-header baseline so a
  // freshly-copied template isn't served without CSP/HSTS/XFO. updateSession
  // applies the same headers on the configured path.
  const securityConfig = getEnvironmentSecurityConfig();

  // Skip auth for setup notice page
  if (request.nextUrl.pathname === "/setup-required") {
    return applySecurityHeaders(NextResponse.next(), securityConfig);
  }

  if (!isValid) {
    // Redirect to setup notice if not on auth pages
    if (!request.nextUrl.pathname.startsWith("/auth/")) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL("/setup-required", request.url)),
        securityConfig
      );
    }
    return applySecurityHeaders(NextResponse.next(), securityConfig);
  }

  // If Supabase is configured, handle authentication
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - api routes (to avoid Edge Runtime issues)
     * - .well-known (public discovery documents — see below)
     * - public assets with file extensions
     *
     * .well-known MUST stay excluded. Those paths are rewritten to the MCP
     * OAuth metadata handlers (next.config.ts), and they are read by an AI
     * client that is not signed in and has no cookies — that is the entire
     * point of them. Middleware runs before rewrites, so without this
     * exclusion a discovery request would be answered with a redirect to
     * /auth/login and the client could never find out how to authenticate.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
