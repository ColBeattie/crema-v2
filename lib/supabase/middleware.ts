import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { isRecoverySession } from "@/lib/supabase/jwt";
import { AUTH_FLOW_COOKIE } from "@/lib/supabase/auth-flow";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { signedInWithPasskey } from "@/lib/auth-methods";

const RECOVERY_ALLOWED_PATHS = new Set([
  "/auth/reset-password",
  "/auth/callback",
  "/auth/confirm",
]);

// Per-instance cache for the MFA-requirement setting. Middleware must not make
// unbounded outbound calls (.claude/rules/middleware.md), so we cache the value
// with a short TTL and time-bound the read, failing closed to "all_users".
let mfaRequirementCache: { value: string; expiresAt: number } | null = null;
const MFA_REQUIREMENT_TTL_MS = 60_000;
const MFA_REQUIREMENT_READ_TIMEOUT_MS = 2_000;

async function getMfaRequirementCached(supabase: any): Promise<string> {
  const now = Date.now();
  if (mfaRequirementCache && mfaRequirementCache.expiresAt > now) {
    return mfaRequirementCache.value;
  }

  // Fail closed: a missing row, a query error, or a timeout all default to
  // "all_users" so MFA still gets enforced.
  let value = "all_users";
  try {
    const { data, error } = await supabase
      .from("setting")
      .select("value")
      .eq("key", "mfa_requirement")
      .abortSignal(AbortSignal.timeout(MFA_REQUIREMENT_READ_TIMEOUT_MS))
      .single();
    value = error || !data ? "all_users" : (data.value as string);
  } catch {
    value = "all_users";
  }

  mfaRequirementCache = { value, expiresAt: now + MFA_REQUIREMENT_TTL_MS };
  return value;
}

// Deactivation must take effect immediately — a deactivated user must be locked
// out on their very next request, including a refresh of the page they're on —
// so unlike the (global, slow-changing) MFA-requirement setting, this is NOT
// cached. It is a single indexed primary-key lookup, time-bounded so it can
// never hang the request, and fails OPEN (treats the user as active) on a
// transient read error so a DB blip can't lock everyone out — the login-route
// check is the backstop.
const DEACTIVATION_READ_TIMEOUT_MS = 2_000;

async function isUserDeactivated(
  supabase: any,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("deactivated_at")
      .eq("id", userId)
      .abortSignal(AbortSignal.timeout(DEACTIVATION_READ_TIMEOUT_MS))
      .maybeSingle();
    // Fail open: only treat as deactivated on a definite deactivated_at value.
    return !error && !!data?.deactivated_at;
  } catch {
    return false;
  }
}

const INVITE_ALLOWED_PATHS = new Set([
  "/auth/set-password",
  "/auth/callback",
  "/auth/confirm",
]);

interface SessionValidationResult {
  isValid: boolean;
  user: any;
  needsRedirect: boolean;
  redirectUrl?: string;
  deactivated?: boolean;
  error?: string;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Enhanced session validation
  const sessionResult = await validateSession(supabase, request);

  // Handle redirect if needed
  if (sessionResult.needsRedirect && sessionResult.redirectUrl) {
    const redirectResponse = NextResponse.redirect(
      new URL(sessionResult.redirectUrl, request.url)
    );
    // A deactivated user must be fully signed out, not just redirected — clear
    // the Supabase auth cookies on the redirect so they can't keep their stale
    // (still-unexpired) access token and bounce straight back in.
    if (sessionResult.deactivated) {
      for (const cookie of request.cookies.getAll()) {
        if (
          cookie.name.startsWith("sb-") &&
          cookie.name.includes("auth-token")
        ) {
          redirectResponse.cookies.set(cookie.name, "", {
            maxAge: 0,
            path: "/",
          });
        }
      }
    }
    return applySecurityHeaders(
      redirectResponse,
      getEnvironmentSecurityConfig()
    );
  }

  // Apply security headers to all responses
  return applySecurityHeaders(supabaseResponse, getEnvironmentSecurityConfig());
}

/**
 * Enhanced session validation with security checks
 */
async function validateSession(
  supabase: any,
  request: NextRequest
): Promise<SessionValidationResult> {
  try {
    // Get user with enhanced error handling
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      // AuthSessionMissingError is expected when no user is logged in — not a
      // real error, and signing out here would clear the PKCE code-verifier
      // cookie that magic-link / OAuth callbacks need to complete the exchange.
      // Match on the error name/code, not a substring of the message, so a
      // wording change in supabase-js can't flip every logged-out visitor into
      // the signOut branch.
      const isMissingSession =
        error.name === "AuthSessionMissingError" ||
        error.code === "session_not_found" ||
        (error.status === 400 && error.message?.includes("session"));

      if (!isMissingSession) {
        console.error("Session validation error:", error);
        // Only clear cookies when the session is genuinely corrupt. Use a
        // local sign-out: global scope POSTs to /auth/v1/logout and would
        // block (up to the function timeout) inside middleware — forbidden by
        // .claude/rules/middleware.md.
        await supabase.auth.signOut({ scope: "local" });
      }
    }

    // Recovery/invite session gate: a Supabase recovery link mints a real
    // session before the user has set a password. Block every route except
    // the reset flow and callback until they complete the reset (or sign out).
    // Current Supabase Auth encodes recovery as amr=otp in the JWT, so the
    // primary signal is the cookie set by /auth/confirm; isRecoverySession
    // remains as a legacy fallback for older Supabase versions.
    if (user) {
      const flowCookie = request.cookies.get(AUTH_FLOW_COOKIE)?.value;
      const inRecoveryFlow = flowCookie === "recovery";
      const inInviteFlow = flowCookie === "invite";
      if (inRecoveryFlow) {
        if (!RECOVERY_ALLOWED_PATHS.has(request.nextUrl.pathname)) {
          return {
            isValid: false,
            user,
            needsRedirect: true,
            redirectUrl: "/auth/reset-password",
          };
        }
      } else if (inInviteFlow) {
        if (!INVITE_ALLOWED_PATHS.has(request.nextUrl.pathname)) {
          return {
            isValid: false,
            user,
            needsRedirect: true,
            redirectUrl: "/auth/set-password",
          };
        }
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (isRecoverySession(session?.access_token)) {
          if (!RECOVERY_ALLOWED_PATHS.has(request.nextUrl.pathname)) {
            return {
              isValid: false,
              user,
              needsRedirect: true,
              redirectUrl: "/auth/reset-password",
            };
          }
        }
      }
    }

    // Deactivation gate: an admin can deactivate a user while that user still
    // holds a valid (not-yet-expired) access token. Banning blocks new logins
    // but does not invalidate the existing token, so we check the app-level
    // deactivation record on each request and end the session immediately.
    if (user) {
      const deactivated = await isUserDeactivated(supabase, user.id);
      if (deactivated) {
        await supabase.auth.signOut({ scope: "local" });
        return {
          isValid: false,
          user,
          needsRedirect: true,
          redirectUrl: "/auth/login?deactivated=1",
          deactivated: true,
        };
      }
    }

    // Enhanced route classification
    const routeInfo = classifyRoute(
      request.nextUrl.pathname,
      request.nextUrl.searchParams
    );

    // Validate based on route type and user status
    return validateRouteAccess(supabase, user, routeInfo, request);
  } catch (error) {
    console.error("Session middleware error:", error);
    return {
      isValid: false,
      user: null,
      needsRedirect: true,
      redirectUrl: "/auth/login",
      error: "Session validation failed",
    };
  }
}

interface RouteInfo {
  type: "public" | "auth" | "protected" | "admin";
  path: string;
  isPasswordReset: boolean;
  isEmailVerification: boolean;
  isSetPassword: boolean;
  isMfaSetup: boolean;
  isMfaVerify: boolean;
  isProfileSetup: boolean;
  requiresAdmin: boolean;
}

/**
 * Classify routes with enhanced security considerations
 */
function classifyRoute(
  pathname: string,
  searchParams: URLSearchParams
): RouteInfo {
  // Password reset flow detection - the reset-password page itself should always be public
  // The actual token validation happens client-side
  const isPasswordReset = pathname === "/auth/reset-password";

  // Email verification flow
  const isEmailVerification =
    pathname === "/auth/verify-email" &&
    (searchParams.has("token") || searchParams.has("type"));

  // Set password flow (admin-created users)
  const isSetPassword = pathname === "/auth/set-password";

  // MFA setup flow
  const isMfaSetup = pathname === "/auth/mfa-setup";

  // MFA verify flow (post-login AAL2 challenge)
  const isMfaVerify = pathname === "/auth/mfa-verify";

  // Profile setup flow
  const isProfileSetup = pathname === "/auth/profile-setup";

  // Admin routes
  // /ai-integration is admin-only because connecting an AI client hands it a
  // long-lived read token for administrative data — see lib/mcp/entitlement.ts,
  // which is the authoritative gate. This is the outer layer; the page and
  // every MCP route re-check independently.
  const adminRoutes = ["/admin", "/settings", "/ai-integration"];
  const requiresAdmin = adminRoutes.some((route) => pathname.startsWith(route));

  // Public routes (no auth required)
  // Include reset-password as a public route
  const publicRoutes = [
    "/auth/login",
    "/auth/signup",
    "/auth/reset-password",
    "/auth/callback",
    "/auth/confirm",
    "/setup-required",
  ];
  const isPublic = publicRoutes.includes(pathname);

  // Auth routes (auth-related pages)
  const isAuthRoute = pathname.startsWith("/auth/");

  let type: RouteInfo["type"] = "protected";
  if (isPublic || isPasswordReset || isEmailVerification) {
    type = "public";
  } else if (isAuthRoute) {
    type = "auth";
  } else if (requiresAdmin) {
    type = "admin";
  }

  return {
    type,
    path: pathname,
    isPasswordReset,
    isEmailVerification,
    isSetPassword,
    isMfaSetup,
    isMfaVerify,
    isProfileSetup,
    requiresAdmin,
  };
}

/**
 * Validate route access with enhanced security
 */
async function validateRouteAccess(
  supabase: any,
  user: any,
  routeInfo: RouteInfo,
  request: NextRequest
): Promise<SessionValidationResult> {
  const baseResult = {
    isValid: false,
    user,
    needsRedirect: false,
  };

  // Handle unauthenticated users
  if (!user) {
    if (routeInfo.type === "public") {
      return { ...baseResult, isValid: true };
    }

    // Redirect to login with original destination
    const loginUrl = new URL("/auth/login", request.url);
    if (routeInfo.path !== "/") {
      loginUrl.searchParams.set("redirectTo", routeInfo.path);
    }

    return {
      ...baseResult,
      needsRedirect: true,
      redirectUrl: loginUrl.toString(),
    };
  }

  // Handle authenticated users

  // Validate session freshness for admin routes
  if (routeInfo.requiresAdmin) {
    if (user.app_metadata?.role !== "admin") {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: "/",
        error: "Admin access required",
      };
    }

    // Additional admin session validation could be added here
    // e.g., check for recent authentication, elevated privileges, etc.
  }

  // Prevent authenticated users from accessing auth pages
  // Exception: allow password reset, email verification, and MFA flows
  if (
    routeInfo.type === "auth" &&
    !routeInfo.isPasswordReset &&
    !routeInfo.isEmailVerification &&
    !routeInfo.isSetPassword &&
    !routeInfo.isMfaSetup &&
    !routeInfo.isMfaVerify &&
    !routeInfo.isProfileSetup
  ) {
    return {
      ...baseResult,
      user,
      isValid: true,
      needsRedirect: true,
      redirectUrl: "/",
    };
  }

  // Validate email verification status for protected routes
  if (routeInfo.type === "protected" || routeInfo.type === "admin") {
    if (!user.email_confirmed_at && !routeInfo.isEmailVerification) {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: "/auth/verify-email",
      };
    }
  }

  // Password change enforcement check for admin-created users (step 1)
  if (
    (routeInfo.type === "protected" || routeInfo.type === "admin") &&
    !routeInfo.isSetPassword
  ) {
    const passwordRedirect = checkPasswordChangeEnforcement(user);
    if (passwordRedirect) {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: passwordRedirect,
      };
    }
  }

  // AAL2 enforcement: if the user has MFA enrolled but the session is still
  // at AAL1, force them through the verify step before any protected route.
  if (
    (routeInfo.type === "protected" || routeInfo.type === "admin") &&
    !routeInfo.isMfaVerify &&
    !routeInfo.isMfaSetup &&
    !routeInfo.isSetPassword
  ) {
    const aalRedirect = await checkAal2Enforcement(supabase, routeInfo);
    if (aalRedirect) {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: aalRedirect,
      };
    }
  }

  // MFA enforcement check for protected and admin routes
  if (
    (routeInfo.type === "protected" || routeInfo.type === "admin") &&
    !routeInfo.isMfaSetup &&
    !routeInfo.isSetPassword
  ) {
    const mfaRedirect = await checkMfaEnforcement(supabase, user);
    if (mfaRedirect) {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: mfaRedirect,
      };
    }
  }

  // Profile setup enforcement check for protected and admin routes
  if (
    (routeInfo.type === "protected" || routeInfo.type === "admin") &&
    !routeInfo.isProfileSetup &&
    !routeInfo.isSetPassword
  ) {
    const profileRedirect = checkProfileSetupEnforcement(user);
    if (profileRedirect) {
      return {
        ...baseResult,
        needsRedirect: true,
        redirectUrl: profileRedirect,
      };
    }
  }

  return {
    ...baseResult,
    isValid: true,
    user,
  };
}

/**
 * Check if admin-created user must change their password (step 1 of onboarding)
 * Skips enforcement for existing users created before 2026-03-01
 */
function checkPasswordChangeEnforcement(user: any): string | null {
  try {
    const metadata = user.user_metadata || {};

    // Only enforce if must_change_password is explicitly true
    if (metadata.must_change_password !== true) return null;

    // Skip for existing users created before 2026-03-01
    const createdAt = new Date(user.created_at);
    const cutoffDate = new Date("2026-03-01T00:00:00Z");
    if (createdAt < cutoffDate) return null;

    return "/auth/set-password";
  } catch (error) {
    console.error("Password change enforcement check error:", error);
    return null;
  }
}

/**
 * Check if the user needs to complete profile setup (profile picture prompt)
 * Skips enforcement for existing users created before 2026-03-01
 */
function checkProfileSetupEnforcement(user: any): string | null {
  try {
    const metadata = user.user_metadata || {};

    // Skip if user already completed onboarding
    if (metadata.onboarding_completed === true) return null;

    // Skip if user already has an avatar
    if (metadata.avatar_url) return null;

    // Skip for existing users created before 2026-03-01
    const createdAt = new Date(user.created_at);
    const cutoffDate = new Date("2026-03-01T00:00:00Z");
    if (createdAt < cutoffDate) return null;

    return "/auth/profile-setup";
  } catch (error) {
    console.error("Profile setup enforcement check error:", error);
    return null;
  }
}

/**
 * If the user has MFA factors enrolled, require the session to be at AAL2.
 * Returns the redirect target (with `next`) when an upgrade is needed.
 */
async function checkAal2Enforcement(
  supabase: any,
  routeInfo: RouteInfo
): Promise<string | null> {
  try {
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return null;

    // A first-factor passkey already combines device possession with a
    // biometric/PIN user-verification check, and is phishing-resistant, so it
    // stands in for the second factor on its own. Supabase always issues aal1
    // for a passkey sign-in while forcing nextLevel to aal2 whenever the user
    // has any verified factor, so without this exemption a passkey session
    // would be bounced to /auth/mfa-verify forever (the user has no way to
    // reach aal2 from there other than their TOTP app). Password sign-ins are
    // unaffected and still have to complete their TOTP challenge.
    // See `signedInWithPasskey` for why both AMR shapes have to be handled.
    if (signedInWithPasskey(data.currentAuthenticationMethods)) return null;

    if (data.currentLevel !== data.nextLevel) {
      const safePath = sanitizeNextPath(routeInfo.path);
      return `/auth/mfa-verify?next=${encodeURIComponent(safePath)}`;
    }

    return null;
  } catch (error) {
    console.error("AAL2 enforcement check error:", error);
    return null;
  }
}

/**
 * Check if MFA is required for the user and redirect if not set up
 */
async function checkMfaEnforcement(
  supabase: any,
  user: any
): Promise<string | null> {
  try {
    // Check if user already has MFA enabled via factors
    const hasMfa =
      user.factors?.some(
        (factor: any) =>
          factor.factor_type === "totp" && factor.status === "verified"
      ) || false;

    if (hasMfa) return null;

    // Read the MFA requirement via the cached, time-bounded getter so we never
    // make an unbounded outbound call from middleware. Fails closed.
    const mfaRequirement = await getMfaRequirementCached(supabase);
    const userRole = user.app_metadata?.role || "user";

    // Determine if MFA is required for this user
    const mfaRequired =
      mfaRequirement === "all_users" ||
      (mfaRequirement === "admins_only" && userRole === "admin");

    if (mfaRequired) {
      return "/auth/mfa-setup";
    }

    return null;
  } catch (error) {
    // Don't block access if the check fails
    console.error("MFA enforcement check error:", error);
    return null;
  }
}
