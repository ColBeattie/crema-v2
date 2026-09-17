import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { withApiSecurity } from "@/lib/api-security";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import {
  getSupportEnv,
  mintSupportToken,
  type SupportRole,
} from "@/lib/support-token";

/**
 * Mints a short-lived HS256 token identifying the logged-in user to the
 * Productivity Tools Support widget.
 *
 * The token is minted fresh on every call and never cached — `withApiSecurity`
 * re-verifies the session with `getUser()`, so the user id always comes from
 * the server-side session and never from a request parameter.
 */

// Node runtime: the signer uses node:crypto HMAC.
export const runtime = "nodejs";
// Never prerender or cache a route that mints per-user credentials.
export const dynamic = "force-dynamic";

/**
 * ENTITLEMENT GATE — decided per project. `/start` asks the question on a fresh
 * template and rewrites this comment with the answer; if it still reads like
 * this, the decision has not been made yet.
 *
 * A support token is read access to the WHOLE support inbox for this
 * application, not just the holder's own tickets. Colleagues seeing each
 * other's reports is intended (it prevents duplicates), but it means anyone who
 * can call this endpoint can read every bug report and its operational detail.
 *
 * In the bare template every login is company staff, so this returns true for
 * any authenticated user. THAT IS ONLY CORRECT WHILE THAT REMAINS TRUE. The
 * moment a project built on this template gains users who are not the
 * customer's own staff — clients, contractors, partners, end customers — this
 * function must be narrowed, e.g.:
 *
 *   return user.app_metadata?.role === "admin" ||
 *          user.app_metadata?.is_staff === true;
 *
 * Gate on a server-controlled flag in `app_metadata` (never `user_metadata`,
 * which the row owner can edit, and never the email domain — contractors have
 * company addresses and staff have personal ones).
 *
 * ⚠️ WHENEVER A NEW ROLE IS ADDED to this application, ASK the user whether
 * that role may submit support tickets, before writing the code that creates
 * it. Do not infer it from the role's name. A new role inherits whatever this
 * function returns today, so under the default `return true` it silently gains
 * read access to every ticket — nothing errors and no test fails. Roles are
 * added in the `z.enum(["user", "admin"])` schemas in
 * `app/admin/users/actions.ts`; when one appears there, the answer belongs
 * here, and the decision belongs in this comment.
 *
 * Hiding the sidebar button is NOT a boundary: any logged-in user can call this
 * endpoint directly. The check has to live here.
 */
function isEntitledToSupport(user: User): boolean {
  void user;
  return true;
}

/** Owners/administrators see tickets company-wide; everyone else app-wide. */
function supportRoleFor(user: User): SupportRole {
  return user.app_metadata?.role === "admin"
    ? "customer_admin"
    : "customer_user";
}

/** Display name from the profile fields this template already stores. */
function displayNameFor(user: User): string | undefined {
  const name = [user.user_metadata?.first_name, user.user_metadata?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || undefined;
}

function json(body: unknown, status: number): Response {
  return applySecurityHeaders(
    NextResponse.json(body, {
      status,
      // Per-user credential — must never be stored by a browser or CDN.
      headers: { "Cache-Control": "no-store" },
    }),
    getEnvironmentSecurityConfig()
  );
}

export const GET = withApiSecurity(
  {
    rateLimitKey: "support-token",
    rateLimitConfig: RATE_LIMIT_CONFIGS.API_CALLS,
    // 401 for anonymous callers is enforced here, before the handler runs.
    requireAuth: true,
  },
  async ({ user }) => {
    // `requireAuth: true` guarantees this, but assert rather than assume —
    // a token minted for nobody is the one bug that must never ship.
    if (!user) return json({ error: "Unauthorized" }, 401);

    if (!isEntitledToSupport(user)) {
      return json({ error: "Forbidden" }, 403);
    }

    const env = getSupportEnv();
    if (!env) {
      // The template's default state: no installation provisioned yet. Say so
      // plainly rather than signing with `undefined` and sending the client
      // chasing a bad_signature.
      console.error(
        "[support-token] Support is not configured — set SUPPORT_SIGNING_SECRET, SUPPORT_ISSUER_ID and SUPPORT_KEY_ID."
      );
      return json({ error: "Support is not configured." }, 503);
    }

    const token = mintSupportToken(
      {
        sub: user.id, // Supabase UUID — stable across email changes.
        email: user.email,
        name: displayNameFor(user),
        role: supportRoleFor(user),
      },
      env
    );

    // Never log the token or the secret.
    return json({ token }, 200);
  }
);
