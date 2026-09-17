"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Mail,
  Lock,
  LogIn,
  Loader2,
  Send,
  CheckCircle2,
  Fingerprint,
} from "lucide-react";
import {
  ValidationSchemas,
  validateInput,
  sanitizeString,
} from "@/lib/input-validation";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import {
  isWebAuthnSupported,
  signInWithPasskey,
  PasskeyOperationError,
} from "@/lib/webauthn";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Validate and sanitize redirect URL to prevent open redirects
  const redirectTo = sanitizeNextPath(searchParams.get("redirectTo") || "/");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [companyName] = useState("Company name");

  // Magic link states
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // MFA challenge takeover. When set, the MfaChallenge component owns the UI
  // and the user cannot proceed past AAL1 until verification succeeds.
  const [mfaUserId, setMfaUserId] = useState<string | null>(null);

  // First-factor passkey sign-in (passwordless)
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Gate on WebAuthn support only — NOT on a platform authenticator being
  // present. A USB security key, or signing in cross-device by scanning a QR
  // code with a phone, works on machines with no Face ID / Touch ID / Windows
  // Hello, and gating on the platform check would hide the button from them.
  // Set in an effect rather than initial state so SSR and hydration agree.
  useEffect(() => {
    setPasskeySupported(isWebAuthnSupported());
  }, []);

  useEffect(() => {
    if (showForgotPassword) {
      document.title = "Reset Password";
    } else if (showMagicLink) {
      document.title = "Magic Link Sign In";
    } else {
      document.title = "Welcome Back";
    }
  }, [showForgotPassword, showMagicLink]);

  // Show a message when the middleware redirected a deactivated user here.
  useEffect(() => {
    if (searchParams.get("deactivated") !== "1") return;
    setError(
      "Your account has been deactivated. Please contact an administrator."
    );
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

  // Handle errors from /auth/confirm (query-string based)
  useEffect(() => {
    const errorParam = searchParams.get("error");
    const reason = searchParams.get("reason");
    if (errorParam !== "auth_callback_error") return;

    const messageByReason: Record<string, string> = {
      missing_token:
        "This link is missing required information. Please request a new email.",
      invalid_token: "This link is not valid. Please request a new email.",
      expired_token:
        "This link has expired. Please request a new email and click it within an hour.",
      used_token:
        "This link has already been used. Please request a new email.",
      wrong_browser:
        "This link has to be opened in the same browser you requested it from. Please request a new email and open it there.",
      server_unreachable:
        "Couldn't reach the authentication server. Please try again in a moment.",
    };

    setError(
      (reason && messageByReason[reason]) ||
        "We couldn't verify that link. Please request a new email."
    );

    // Strip the error params so a refresh doesn't re-render the message.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

  // Handle recovery token or error from Supabase email link
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const type = hashParams.get("type");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashError = hashParams.get("error");
      const errorDescription = hashParams.get("error_description");

      if ((type === "recovery" || type === "invite") && accessToken) {
        // Redirect to reset-password page with all the tokens
        let redirectHash = `access_token=${accessToken}&type=${type}`;
        if (refreshToken) {
          redirectHash += `&refresh_token=${refreshToken}`;
        }
        router.push(`/auth/reset-password#${redirectHash}`);
      } else if (hashError) {
        // Show error from Supabase (e.g. expired/invalid email link)
        const message = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
          : "An authentication error occurred. Please try again.";
        setError(message);

        // Clean the hash from the URL so it doesn't persist on refresh
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Validate input before attempting authentication
    try {
      // Check for empty fields first
      if (!email || email.trim().length === 0) {
        throw new Error("Email is required");
      }

      if (!password || password.length === 0) {
        throw new Error("Password is required");
      }

      const validatedEmail = validateInput(
        ValidationSchemas.email,
        email.trim()
      );
      const sanitizedPassword = sanitizeString(password);

      // Basic password validation (not as strict as creation, but still check basics)
      if (!sanitizedPassword || sanitizedPassword.length < 1) {
        throw new Error("Password is required");
      }

      if (sanitizedPassword.length > 128) {
        throw new Error("Password is too long");
      }

      // Sign in via the server route. The credential check and the
      // login-attempt recording happen server-side so the outcome can't be
      // forged by the client (see app/api/auth/login/route.ts). The password
      // goes in the POST body, never as a logged Server Action arg.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: validatedEmail,
          password: sanitizedPassword,
        }),
      });
      const result = await res.json();

      if (result.status !== "success" && result.status !== "mfa_required") {
        setError(result.message || "Invalid email or password.");
        setLoading(false);
        return;
      }

      // Hydrate the browser Supabase client with the session the server just
      // created, so the MFA challenge and post-login navigation see it (the
      // same in-memory state a client-side sign-in would have produced).
      if (result.session?.access_token && result.session?.refresh_token) {
        const supabase = createClient();
        await supabase.auth.setSession(result.session);
      }

      if (result.status === "mfa_required") {
        await triggerMfaChallenge();
        return;
      }

      // Fully authenticated.
      router.push(redirectTo);
      router.refresh();
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Please check your input and try again."
      );
      setLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError(null);
    setPasskeyLoading(true);

    try {
      await signInWithPasskey();

      // Full reload rather than router.push: the passkey ceremony just wrote
      // new auth cookies, and a soft navigation would let middleware run
      // against the pre-sign-in state.
      window.location.assign(redirectTo);
    } catch (err) {
      // A ceremony aborted in code is the only silent case — everything else
      // (including a dismissed prompt) gets a message, or the button looks
      // like it does nothing.
      if (err instanceof PasskeyOperationError && err.aborted) {
        setPasskeyLoading(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Passkey sign-in failed.");
      setPasskeyLoading(false);
    }
  };

  const triggerMfaChallenge = async () => {
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }
      setMfaUserId(user.id);
      setLoading(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to set up two-factor authentication. Please try again."
      );
      setLoading(false);
    }
  };

  const handleMfaSuccess = (redirect?: string) => {
    setMfaUserId(null);
    router.push(redirect || redirectTo);
    router.refresh();
  };

  const handleMfaCancel = async () => {
    // Sign the user out so the AAL1 session can't linger after they back out
    // of the MFA prompt (otherwise middleware would just bounce them back).
    const supabase = createClient();
    await supabase.auth.signOut();
    setMfaUserId(null);
    setPassword("");
    setError(null);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetMessage(null);

    try {
      // Validate email input
      const validatedEmail = validateInput(ValidationSchemas.email, resetEmail);

      const supabase = createClient();

      // The Reset Password template links straight to /auth/confirm with a
      // token_hash, so this redirectTo is only a fallback for a project still
      // on the default {{ .ConfirmationURL }} template.
      const { error } = await supabase.auth.resetPasswordForEmail(
        validatedEmail,
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
        }
      );

      if (error) {
        if (error.message.toLowerCase().includes("rate limit")) {
          setResetMessage(
            "Error: You've tried this too many times. Please wait a few minutes before trying again."
          );
        } else {
          setResetMessage(`Error: ${error.message}`);
        }
      } else {
        setResetMessage(
          "Password reset email sent! Check your inbox for the reset link."
        );
      }
    } catch (validationError) {
      setResetMessage(
        `Error: ${validationError instanceof Error ? validationError.message : "Please enter a valid email address."}`
      );
    }

    setResetLoading(false);
  };

  const resetForgotPasswordForm = () => {
    setShowForgotPassword(false);
    setResetEmail("");
    setResetMessage(null);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let validatedEmail: string;
    try {
      validatedEmail = validateInput(
        ValidationSchemas.email,
        magicLinkEmail.trim()
      );
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Please enter a valid email address."
      );
      return;
    }

    setMagicLinkLoading(true);

    const supabase = createClient();
    // Like the recovery one above, this emailRedirectTo is only a fallback for
    // a project still on the default {{ .ConfirmationURL }} template — the
    // Magic Link template now links straight to /auth/confirm with a
    // token_hash, so `redirectTo` is NOT preserved and the user lands on "/".
    //
    // That deep-link loss is deliberate. {{ .ConfirmationURL }} round-trips
    // through Supabase's verify endpoint and hands /auth/callback a PKCE
    // `code`, which can only be exchanged in the browser that requested the
    // link (it holds the code_verifier cookie). Mobile mail apps open links in
    // their own in-app WebView with a separate cookie jar, so every magic-link
    // login from a phone failed. verifyOtp on a token_hash needs nothing
    // stored client-side and works from any browser or device.
    // {{ .RedirectTo }} can't win back the deep link: it renders an absolute
    // URL and sanitizeNextPath rejects those.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: validatedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    // Surface rate-limit errors so the user knows to wait. All other errors
    // (including "user not found") fall through to the generic success view
    // to avoid revealing whether an account exists.
    if (otpError && /rate limit/i.test(otpError.message)) {
      setError("Too many requests. Please wait a moment before trying again.");
      setMagicLinkLoading(false);
      return;
    }

    setMagicLinkSent(true);
    setMagicLinkLoading(false);
  };

  const resetMagicLinkForm = () => {
    setShowMagicLink(false);
    setMagicLinkEmail("");
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          {/* Company Logo */}
          {!showForgotPassword && !showMagicLink && !mfaUserId && (
            <div className="flex justify-center mb-6">
              <div className="h-16 flex items-center justify-center text-muted-foreground">
                Logo here
              </div>
            </div>
          )}

          {showForgotPassword && (
            <>
              <h1 className="text-3xl font-bold text-foreground">
                Reset Password
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter your email address to receive a reset link
              </p>
            </>
          )}

          {showMagicLink && !magicLinkSent && (
            <>
              <h1 className="text-3xl font-bold text-foreground">
                Magic Link Sign In
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter your email address to receive a sign-in link
              </p>
            </>
          )}

          {!showForgotPassword && !showMagicLink && !mfaUserId && (
            <>
              <h1 className="text-3xl font-bold text-foreground">
                Welcome Back
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to your {companyName} account
              </p>
            </>
          )}
        </div>

        <Card className="p-8">
          {mfaUserId ? (
            <MfaChallenge
              userId={mfaUserId}
              onSuccess={handleMfaSuccess}
              onCancel={handleMfaCancel}
              cancelLabel="Back to login"
            />
          ) : magicLinkSent ? (
            <div className="space-y-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-foreground" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Check your email
                </h2>
                <p className="text-sm text-muted-foreground">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground">
                    {magicLinkEmail}
                  </span>
                  , we&apos;ve sent a sign-in link. The link expires shortly, so
                  open it from this device.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMagicLinkSent(false);
                  setShowMagicLink(false);
                  setMagicLinkEmail("");
                  setError(null);
                }}
                className="w-full"
              >
                Back to sign in
              </Button>
            </div>
          ) : showMagicLink ? (
            <form onSubmit={handleMagicLink} className="space-y-6">
              {error && (
                <div className="bg-red-600 rounded-md p-4">
                  <p className="text-sm text-white">{error}</p>
                </div>
              )}

              <div>
                <Label className="block text-sm font-medium mb-2">
                  Email Address
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Input
                    type="email"
                    value={magicLinkEmail}
                    onChange={(e) => setMagicLinkEmail(e.target.value)}
                    className="pl-10"
                    placeholder="you@example.com"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={magicLinkLoading}
                className="w-full"
              >
                {magicLinkLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {magicLinkLoading ? "Sending link..." : "Send magic link"}
              </Button>

              <button
                type="button"
                onClick={resetMagicLinkForm}
                className="w-full text-sm text-foreground hover:underline"
              >
                ← Back to Sign In
              </button>
            </form>
          ) : !showForgotPassword ? (
            <div className="space-y-6">
              <form onSubmit={handleLogin} className="space-y-6">
                {error && (
                  <div className="bg-red-600 rounded-md p-4">
                    <p className="text-sm text-white">{error}</p>
                  </div>
                )}

                <div>
                  <Label className="block text-sm font-medium mb-2">
                    Email Address
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label className="block text-sm font-medium mb-2">
                    Password
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      placeholder="Enter your password"
                      required
                    />
                  </div>
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  <LogIn className="w-4 h-4" />
                  {loading ? "Signing in..." : "Sign In"}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-sm text-foreground hover:underline"
                  >
                    Forgot your password?
                  </button>
                </div>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              {/* Alternative sign-in methods. New OAuth providers go in
                  this stack alongside the magic link button. */}
              <div className="space-y-3">
                {passkeySupported && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handlePasskeySignIn}
                    disabled={passkeyLoading}
                  >
                    {passkeyLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Fingerprint className="w-4 h-4" />
                    )}
                    {passkeyLoading
                      ? "Waiting for passkey..."
                      : "Sign in with a passkey"}
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setShowMagicLink(true);
                    setMagicLinkEmail(email);
                    setError(null);
                  }}
                >
                  <Send className="w-4 h-4" />
                  Email me a magic link
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-6">
              {resetMessage && (
                <div
                  className={`rounded-md p-4 ${
                    resetMessage.startsWith("Error:")
                      ? "bg-red-600"
                      : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                  }`}
                >
                  <p
                    className={`text-sm ${
                      resetMessage.startsWith("Error:")
                        ? "text-white"
                        : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    {resetMessage}
                  </p>
                </div>
              )}

              <div>
                <Label className="block text-sm font-medium mb-2">
                  Email Address
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="pl-10"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <Button type="submit" disabled={resetLoading} className="w-full">
                <Mail className="w-4 h-4" />
                {resetLoading ? "Sending..." : "Send Reset Link"}
              </Button>

              <button
                type="button"
                onClick={resetForgotPasswordForm}
                className="w-full text-sm text-primary hover:text-primary/80"
              >
                ← Back to Sign In
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
