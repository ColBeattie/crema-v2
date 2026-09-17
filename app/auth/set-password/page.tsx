"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isInviteSession, isRecoverySession } from "@/lib/supabase/jwt";
import { clearAuthFlow, getAuthFlow } from "@/app/auth/auth-flow-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function SetPassword() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Invite/recovery sessions are exempt from Supabase's "Require current
  // password when updating" check. Regular password logins (e.g. admin sent
  // a temp password) are not — we need to re-verify the temp password first.
  const [requireCurrentPassword, setRequireCurrentPassword] = useState(false);

  useEffect(() => {
    document.title = "Set Your Password";

    const checkUser = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) {
          router.push("/auth/login");
          return;
        }

        // Cookie set by /auth/confirm is the primary signal — current
        // Supabase Auth encodes both invite and recovery as amr=otp in the
        // JWT, so the JWT-based check is only useful as a legacy fallback.
        const flow = await getAuthFlow();
        const token = session?.access_token;
        const isExemptFlow =
          flow === "invite" ||
          flow === "recovery" ||
          isInviteSession(token) ||
          isRecoverySession(token);

        // Keep the user on this page if they need to set/change a password.
        // Two scenarios qualify:
        //   1. Admin-created users with a temp password (must_change_password=true)
        //   2. Invitees coming straight from the invite email — they have no
        //      password yet, so they MUST set one before going anywhere else.
        const mustChange = user.user_metadata?.must_change_password === true;
        if (!mustChange && !isExemptFlow) {
          router.push("/");
          return;
        }

        setUserEmail(user.email ?? null);
        setRequireCurrentPassword(!isExemptFlow);
      } catch {
        setError("Failed to load. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    checkUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (requireCurrentPassword && !currentPassword) {
      setError("Enter your current password to continue");
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (requireCurrentPassword && currentPassword === password) {
      setError("New password must be different from your current password");
      return;
    }

    setSubmitting(true);

    try {
      // For sessions that aren't already exempt (invite/recovery), re-verify
      // the current password via signInWithPassword to refresh the session.
      // This satisfies Supabase's "Require current password when updating"
      // check without forcing the user through an emailed-nonce reauth flow.
      if (requireCurrentPassword) {
        if (!userEmail) {
          setError("Unable to verify account. Please sign in again.");
          setSubmitting(false);
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: currentPassword,
        });
        if (signInError) {
          setError("Current password is incorrect");
          setSubmitting(false);
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });

      if (updateError) {
        const msg = updateError.message.toLowerCase();

        if (
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
            "This password is too weak. Please choose a stronger password."
          );
        } else {
          setError(updateError.message);
        }
        setSubmitting(false);
        return;
      }

      // Password changed successfully. Sign out to discard any recovery/invite
      // claim still embedded in the JWT, then require a fresh sign-in. The
      // middleware will route the user to MFA setup after login if needed.
      await clearAuthFlow();
      // Stay signed in — the user just set the password they're holding, no
      // value in forcing them to type it again. Hard navigation so middleware
      // reads the updated user_metadata (must_change_password: false) and
      // routes to the next onboarding step (MFA setup / profile setup / home).
      window.location.assign("/");
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <Card className="p-6 md:p-8 gap-0">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Set Your Password
              </h1>
              <p className="text-sm text-muted-foreground">
                Choose a secure password for your account
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-6">
            <div className="flex gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-800 dark:text-blue-300">
                For security, you must set your own password before continuing.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-600 rounded-md">
              <p className="text-sm text-white">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {requireCurrentPassword && (
              <div>
                <Label htmlFor="current-password-input" className="mb-2">
                  Current Password
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Input
                    id="current-password-input"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pl-10"
                    placeholder="Enter your current password"
                    required
                    disabled={submitting}
                  />
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="new-password" className="mb-2">
                New Password
              </Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  placeholder="Enter your new password"
                  required
                  minLength={12}
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${password.length >= 12 ? "bg-green-500" : "bg-muted-foreground/30"}`}
                  />
                  <p
                    className={`text-xs ${password.length >= 12 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                  >
                    At least 12 characters
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${/[A-Z]/.test(password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                  />
                  <p
                    className={`text-xs ${/[A-Z]/.test(password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                  >
                    One uppercase letter
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${/[a-z]/.test(password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                  />
                  <p
                    className={`text-xs ${/[a-z]/.test(password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                  >
                    One lowercase letter
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${/[0-9]/.test(password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                  />
                  <p
                    className={`text-xs ${/[0-9]/.test(password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                  >
                    One number
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${/[^A-Za-z0-9]/.test(password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                  />
                  <p
                    className={`text-xs ${/[^A-Za-z0-9]/.test(password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                  >
                    One special character (!@#$%^&*)
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="confirm-password" className="mb-2">
                Confirm New Password
              </Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  placeholder="Confirm your new password"
                  required
                  minLength={12}
                  disabled={submitting}
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Set Password & Continue
                </>
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
