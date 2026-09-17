import { createClient } from "@/lib/supabase/server";
import { ValidationSchemas, validateInput } from "@/lib/input-validation";
import { recordLoginAttempt } from "@/lib/login-security";
import { withApiSecurity, secureJson } from "@/lib/api-security";
import { RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import type { NextRequest } from "next/server";

/**
 * Server-side password login.
 *
 * SECURITY: the login outcome (success/failure + user id) is determined by the
 * real `signInWithPassword` result here on the server, never reported by the
 * client. That is what makes the audit trail trustworthy — a caller cannot
 * forge a success or a failure, nor attribute attempts to an arbitrary user id.
 *
 * Credentials arrive in the POST body (not as Server Action arguments, which
 * Next.js prints to the dev console). The body is never logged.
 */

// Derive client context from platform-trusted headers. Prefer x-real-ip /
// cf-connecting-ip (set by the proxy) over the leftmost x-forwarded-for entry,
// which a client can spoof.
function clientContext(request: NextRequest) {
  const h = request.headers;
  const ipAddress =
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";

  return {
    ipAddress,
    userAgent: h.get("user-agent"),
    country: h.get("x-vercel-ip-country") || h.get("cf-ipcountry"),
    city: h.get("x-vercel-ip-city"),
  };
}

export const POST = withApiSecurity(
  {
    rateLimitKey: "auth-login",
    rateLimitConfig: RATE_LIMIT_CONFIGS.API_CALLS,
    requireAuth: false,
  },
  async ({ request }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return secureJson({ status: "error", message: "Invalid request." }, 400);
    }

    const { email: rawEmail, password: rawPassword } =
      (body as { email?: unknown; password?: unknown }) ?? {};

    // Generic message so we never reveal which field was wrong or whether the
    // account exists.
    let email: string;
    try {
      email = validateInput(
        ValidationSchemas.email,
        typeof rawEmail === "string" ? rawEmail.trim() : ""
      );
    } catch {
      return secureJson(
        { status: "error", message: "Invalid email or password." },
        401
      );
    }

    const password = typeof rawPassword === "string" ? rawPassword : "";
    if (password.length === 0 || password.length > 128) {
      return secureJson(
        { status: "error", message: "Invalid email or password." },
        401
      );
    }

    const ctx = clientContext(request);
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Record the REAL failure (server-observed) — this drives the security alert.
      await recordLoginAttempt({
        email,
        userId: null,
        ...ctx,
        success: false,
        failureReason: error.message,
      });
      return secureJson(
        { status: "error", message: "Invalid email or password." },
        401
      );
    }

    // Credentials are valid — but refuse deactivated accounts. The check runs
    // as the just-authenticated user, so RLS lets it read only their own row.
    const { data: deactivation } = await supabase
      .from("profiles")
      .select("deactivated_at")
      .eq("id", data.user?.id ?? "")
      .maybeSingle();

    if (deactivation?.deactivated_at) {
      // Discard the session we just established so no cookie/token leaks out.
      await supabase.auth.signOut({ scope: "local" });
      await recordLoginAttempt({
        email,
        userId: data.user?.id ?? null,
        ...ctx,
        success: false,
        failureReason: "account_deactivated",
      });
      return secureJson(
        {
          status: "error",
          message:
            "This account has been deactivated. Please contact an administrator.",
        },
        403
      );
    }

    // Record the REAL success, attributing it to the authenticated user id.
    await recordLoginAttempt({
      email,
      userId: data.user?.id ?? null,
      ...ctx,
      success: true,
    });

    // Return the session so the browser client can hydrate (setSession). These
    // are the user's own tokens — the same ones a client-side sign-in would
    // have received.
    const session = data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      : null;

    // A verified TOTP factor leaves the new session at AAL1; the client must
    // complete the MFA challenge before reaching protected routes.
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel !== aal.nextLevel) {
      return secureJson({ status: "mfa_required", session }, 200);
    }

    return secureJson({ status: "success", session }, 200);
  }
);
