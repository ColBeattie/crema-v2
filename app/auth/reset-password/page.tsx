"use client";

import { Suspense } from "react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isRecoverySession } from "@/lib/supabase/jwt";
import { clearAuthFlow, getAuthFlow } from "@/app/auth/auth-flow-actions";
import { Lock, CheckCircle, Shield, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [sessionValidated, setSessionValidated] = useState(false);

  // MFA states
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaAttempts, setMfaAttempts] = useState(0);
  const [mfaVerified, setMfaVerified] = useState(false);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  /**
   * Check if the user has MFA enabled and set up the challenge if needed.
   */
  const checkMfaRequirement = async (
    supabase: ReturnType<typeof createClient>
  ) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError(
          "No valid reset session found. Please click the reset link from your email."
        );
        setSessionValidated(true);
        return;
      }

      // Check current AAL level
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.nextLevel === "aal2" && aalData?.currentLevel === "aal1") {
        // User has MFA and needs to verify
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totpFactor = factors?.totp?.[0];

        if (totpFactor?.status === "verified") {
          // Create an MFA challenge
          const { data: challenge, error: challengeError } =
            await supabase.auth.mfa.challenge({
              factorId: totpFactor.id,
            });

          if (challengeError || !challenge) {
            setError(
              "Failed to set up two-factor verification. Please try again."
            );
            setSessionValidated(true);
            return;
          }

          setMfaFactorId(totpFactor.id);
          setMfaChallengeId(challenge.id);
          setRequiresMfa(true);
          setHasValidSession(true);
          setSessionValidated(true);

          // Focus the MFA input
          setTimeout(() => mfaInputRef.current?.focus(), 100);
          return;
        }
      }

      // No MFA required or already AAL2
      setHasValidSession(true);
      setMfaVerified(true);
      setSessionValidated(true);
    } catch {
      // If MFA check fails, still allow the flow — the updateUser call
      // will return the AAL2 error if MFA is actually required
      setHasValidSession(true);
      setMfaVerified(true);
      setSessionValidated(true);
    }
  };

  useEffect(() => {
    document.title = success ? "Password Updated" : "Reset Your Password";
    const supabase = createClient();

    const validateResetSession = async () => {
      try {
        // The recovery email points at /auth/confirm, which calls verifyOtp
        // server-side and sets the recovery session cookies before redirecting
        // here. We only need to confirm that session exists and carries the
        // recovery amr claim — no hash/PKCE fallback.
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error || !session || !session.user) {
          setError(
            "No valid reset session found. Please request a new password reset email."
          );
          setSessionValidated(true);
          return;
        }

        // Current Supabase Auth encodes recovery sessions with amr=otp, so the
        // JWT no longer distinguishes them. The /auth/confirm route sets a
        // short-lived `sb_auth_flow=recovery` cookie at verifyOtp time — trust
        // that as the primary signal, fall back to the JWT amr for older
        // Supabase versions.
        const flow = await getAuthFlow();
        const looksLikeRecovery =
          flow === "recovery" || isRecoverySession(session.access_token);

        if (!looksLikeRecovery) {
          setError(
            "This page can only be reached through a password reset email."
          );
          setSessionValidated(true);
          return;
        }

        await checkMfaRequirement(supabase);
      } catch {
        setError("Unable to validate reset session. Please try again.");
        setSessionValidated(true);
      }
    };

    validateResetSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setHasValidSession(false);
        setError("Session expired. Please request a new password reset.");
      }
    });

    return () => subscription.unsubscribe();
  }, [success]);

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mfaAttempts >= 5) {
      setError(
        "Too many failed attempts. Please request a new password reset link."
      );
      setLoading(false);
      return;
    }

    if (!mfaFactorId || !mfaChallengeId) {
      setError(
        "MFA session invalid. Please request a new password reset link."
      );
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode,
      });

      if (error) {
        const newAttempts = mfaAttempts + 1;
        setMfaAttempts(newAttempts);

        const remainingAttempts = 5 - newAttempts;
        if (remainingAttempts > 0) {
          setError(
            `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`
          );
        } else {
          setError(
            "Too many failed attempts. Please request a new password reset link."
          );
        }
        setMfaCode("");
        setLoading(false);
        return;
      }

      // MFA verified — session is now AAL2
      setRequiresMfa(false);
      setMfaVerified(true);
      setMfaCode("");
      setLoading(false);
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const validatePassword = (pwd: string): string | null => {
      if (pwd.length < 12) {
        return "Password must be at least 12 characters long";
      }
      if (!/[A-Z]/.test(pwd)) {
        return "Password must contain at least one uppercase letter";
      }
      if (!/[a-z]/.test(pwd)) {
        return "Password must contain at least one lowercase letter";
      }
      if (!/[0-9]/.test(pwd)) {
        return "Password must contain at least one number";
      }
      if (!/[^A-Za-z0-9]/.test(pwd)) {
        return "Password must contain at least one special character";
      }

      const commonPatterns = [
        /(.)\1{3,}/,
        /123456|abcdef|qwerty|password|admin|user/i,
        /^.{1,11}$/,
      ];

      if (commonPatterns.some((pattern) => pattern.test(pwd))) {
        return "Password is too common or contains repeated patterns";
      }

      return null;
    };

    if (!hasValidSession) {
      setError("Invalid session. Please request a new password reset link.");
      setLoading(false);
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError("Session expired. Please request a new password reset link.");
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: password,
        // Recovery counts as "setting a password" — admin-invited users who
        // arrive here via a reset link shouldn't be funnelled through
        // /auth/set-password afterwards as if they'd never picked one.
        data: { must_change_password: false },
      });

      if (error) {
        const msg = error.message.toLowerCase();

        if (
          msg.includes("session_not_found") ||
          msg.includes("session expired")
        ) {
          setError(
            "Session expired. Please request a new password reset link."
          );
        } else if (
          msg.includes("same_password") ||
          msg.includes("different from the old") ||
          msg.includes("previously used")
        ) {
          setError("Please choose a different password than your current one.");
        } else if (
          msg.includes("leaked") ||
          msg.includes("compromised") ||
          msg.includes("pwned") ||
          msg.includes("breached") ||
          msg.includes("data breach")
        ) {
          setError(
            "This password has been found in a data breach and cannot be used. Please choose a different password."
          );
        } else if (
          msg.includes("weak") ||
          msg.includes("too simple") ||
          msg.includes("too common")
        ) {
          setError(
            "This password is too weak. Please choose a stronger password that includes uppercase and lowercase letters, numbers, and special characters."
          );
        } else if (msg.includes("at least") && msg.includes("character")) {
          setError(
            "Password does not meet the minimum requirements. It must include uppercase and lowercase letters, numbers, and special characters."
          );
        } else if (
          msg.includes("too short") ||
          (msg.includes("length") && msg.includes("password"))
        ) {
          setError(
            "Password is too short. It must be at least 12 characters long."
          );
        } else if (msg.includes("aal2") || msg.includes("insufficient_aal")) {
          setError(
            "Two-factor authentication verification is required. Please request a new password reset link."
          );
        } else {
          setError(error.message);
        }
        setLoading(false);
      } else {
        setSuccess(true);
        setLoading(false);

        // Clear the recovery-flow marker so a stray cookie can't grant
        // future access to this page.
        await clearAuthFlow();

        // Sign out after successful password reset for security
        await supabase.auth.signOut();

        // Redirect to login after 3 seconds
        setTimeout(() => {
          router.push("/auth/login");
        }, 3000);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">
              Password Updated
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your password has been successfully updated. You will be
              redirected to the login page in a few seconds.
            </p>
          </div>

          <Card className="p-8 text-center">
            <Button asChild>
              <Link href="/auth/login">Continue to Login</Link>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Show loading state while validating session
  if (!sessionValidated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Validating reset link...</p>
        </div>
      </div>
    );
  }

  // Show error state if session is invalid
  if (sessionValidated && !hasValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full">
          <Card className="p-8 text-center">
            {error && (
              <div className="bg-red-600 rounded-md p-4 mb-6">
                <p className="text-sm text-white">{error}</p>
              </div>
            )}
            <h1 className="text-xl font-semibold text-foreground mb-4">
              Invalid Reset Link
            </h1>
            <Button asChild>
              <Link href="/auth/login">Back to Login</Link>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Show MFA verification step
  if (requiresMfa && !mfaVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground">
              Reset Your Password
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify your identity to continue
            </p>
          </div>

          <Card className="p-8">
            <form onSubmit={handleMfaVerify} className="space-y-6">
              <div className="text-center mb-2">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium text-foreground">
                  Two-Factor Authentication
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Enter the 6-digit code from your authenticator app
                </p>
                {mfaAttempts > 0 && mfaAttempts < 5 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    {5 - mfaAttempts} attempt{5 - mfaAttempts === 1 ? "" : "s"}{" "}
                    remaining
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-600 rounded-md p-4">
                  <p className="text-sm text-white">{error}</p>
                </div>
              )}

              <div>
                <Input
                  ref={mfaInputRef}
                  type="text"
                  value={mfaCode}
                  onChange={(e) =>
                    setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="text-center font-mono text-xl tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  disabled={loading || mfaAttempts >= 5}
                />
              </div>

              <Button
                type="submit"
                disabled={loading || mfaCode.length !== 6 || mfaAttempts >= 5}
                className="w-full"
              >
                {loading ? (
                  <span className="flex items-center">
                    <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                    Verifying...
                  </span>
                ) : (
                  "Verify & Continue"
                )}
              </Button>

              <div className="text-center">
                <Button variant="ghost" asChild>
                  <Link href="/auth/login">Back to Login</Link>
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Reset Your Password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your new secure password below
          </p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleResetPassword} className="space-y-6">
            {error && (
              <div className="bg-red-600 rounded-md p-4">
                <p className="text-sm text-white">{error}</p>
              </div>
            )}

            <div>
              <Label className="block text-sm font-medium mb-2">
                New Password
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
                  placeholder="Enter your new password"
                  required
                  minLength={12}
                  disabled={loading}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground space-y-1">
                <p>Password requirements:</p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  <li>At least 12 characters long</li>
                  <li>Include uppercase and lowercase letters</li>
                  <li>Include at least one number</li>
                  <li>Include at least one special character</li>
                  <li>Avoid common patterns or dictionary words</li>
                </ul>
              </div>
            </div>

            <div>
              <Label className="block text-sm font-medium mb-2">
                Confirm New Password
              </Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  placeholder="Confirm your new password"
                  required
                  minLength={12}
                  disabled={loading}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !hasValidSession}
              className="w-full"
            >
              <Lock className="w-4 h-4" />
              {loading ? "Updating Password..." : "Update Password"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link
                href="/auth/login"
                className="text-primary hover:text-primary/80"
              >
                Sign in
              </Link>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function ResetPassword() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
