import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safe-redirect";

const ALLOWED_TYPES: ReadonlySet<EmailOtpType> = new Set([
  "recovery",
  "magiclink",
  "invite",
  "signup",
  "email_change",
  "email",
]);

const RECOVERY_ALLOWED_NEXT = new Set([
  "/auth/reset-password",
  "/auth/set-password",
]);

// Short-lived marker cookie name. Current Supabase Auth no longer encodes
// "recovery" or "invite" in the JWT amr claim (it just says "otp"), so the
// only reliable way to tell downstream pages "this session came from a
// recovery/invite email" is to set a server-controlled cookie at the moment
// we verify the OTP. See lib/supabase/auth-flow.ts for the readers.
export const AUTH_FLOW_COOKIE = "sb_auth_flow";
const AUTH_FLOW_MAX_AGE_SECONDS = 15 * 60;

function redirectWithError(
  origin: string,
  reason:
    | "missing_token"
    | "invalid_token"
    | "expired_token"
    | "used_token"
    | "server_unreachable"
) {
  const url = new URL("/auth/login", origin);
  url.searchParams.set("error", "auth_callback_error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/";

  if (!token_hash || !type || !ALLOWED_TYPES.has(type)) {
    return redirectWithError(origin, "missing_token");
  }

  // Recovery/invite sessions are short-lived and must only land on the
  // password-set screens. A tampered `next` could otherwise drop the
  // freshly-minted recovery session into the app proper.
  const safeNext =
    type === "recovery" || type === "invite"
      ? RECOVERY_ALLOWED_NEXT.has(rawNext)
        ? rawNext
        : "/auth/reset-password"
      : sanitizeNextPath(rawNext);

  const supabase = await createClient();

  // If the visitor already has a session in this browser (very common in dev
  // when you reset your own password while logged in), clear it first so
  // verifyOtp mints a clean session instead of leaving the existing one.
  if (type === "recovery" || type === "invite") {
    await supabase.auth.signOut({ scope: "local" });
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    console.error("[auth/confirm] verifyOtp failed:", {
      message: error.message,
      status: error.status,
      name: error.name,
      type,
    });

    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("expired")) {
      return redirectWithError(origin, "expired_token");
    }
    if (
      msg.includes("already used") ||
      msg.includes("already been used") ||
      msg.includes("used")
    ) {
      return redirectWithError(origin, "used_token");
    }
    return redirectWithError(origin, "invalid_token");
  }

  // For recovery, the reset-password page handles MFA inline so the user can
  // verify and set the new password in one flow. For everything else, gate
  // protected destinations through the MFA challenge.
  if (type !== "recovery") {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel !== aal.nextLevel) {
      const mfaUrl = new URL("/auth/mfa-verify", origin);
      mfaUrl.searchParams.set("next", safeNext);
      return NextResponse.redirect(mfaUrl);
    }
  }

  const response = NextResponse.redirect(new URL(safeNext, origin));

  if (type === "recovery" || type === "invite") {
    // httpOnly so client JS cannot read OR delete it. The middleware
    // forced-reset gate keys off this cookie, so a JS-writable cookie would
    // let a recovery session delete it and escape the gate. Client pages read
    // it via the getAuthFlow() server action and clear it via clearAuthFlow().
    response.cookies.set(AUTH_FLOW_COOKIE, type, {
      path: "/",
      maxAge: AUTH_FLOW_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: true,
      secure: origin.startsWith("https://"),
    });
  }

  return response;
}
