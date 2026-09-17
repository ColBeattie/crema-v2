import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safe-redirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Recovery uses /auth/confirm (token_hash + verifyOtp), not this route.
  // This route only handles OAuth and standard PKCE login.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const safeNext = sanitizeNextPath(next);

      // If the user has MFA enrolled, the new session is at AAL1 and must be
      // upgraded to AAL2 before reaching protected routes.
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel !== aal.nextLevel) {
        const mfaUrl = new URL("/auth/mfa-verify", origin);
        mfaUrl.searchParams.set("next", safeNext);
        return NextResponse.redirect(mfaUrl);
      }

      return NextResponse.redirect(new URL(safeNext, origin));
    }

    // A PKCE code can only be redeemed in the browser that requested it — the
    // code_verifier lives in a cookie there. Opening the link somewhere else
    // (a mail app's in-app WebView, another device) leaves the verifier
    // missing, which GoTrue reports as a "code verifier" error. Call that out
    // rather than showing the generic "couldn't verify that link".
    const msg = error.message?.toLowerCase() ?? "";
    const reason =
      msg.includes("code verifier") || msg.includes("code_verifier")
        ? "wrong_browser"
        : "invalid_token";

    console.error("[auth/callback] exchangeCodeForSession failed:", {
      message: error.message,
      status: error.status,
      name: error.name,
    });

    const url = new URL("/auth/login", origin);
    url.searchParams.set("error", "auth_callback_error");
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(sanitizeNextPath(next), origin));
}
