"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_NAME } from "@/lib/company";
import { getMfaRequirement } from "@/app/admin/settings/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function MfaSetup() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(true);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    document.title = "Set Up Two-Factor Authentication";

    const checkAndEnroll = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push("/auth/login");
          return;
        }

        // Determine if MFA is required for this user via server action
        const userRole = user.app_metadata?.role || "user";
        try {
          const mfaSetting = await getMfaRequirement();
          const required =
            mfaSetting === "all_users" ||
            (mfaSetting === "admins_only" && userRole === "admin");
          setMfaRequired(required);
        } catch {
          // If server action fails, default to required (safe default)
          setMfaRequired(true);
        }

        // Check if MFA is already enabled and clean up unverified factors
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verifiedFactor = factors?.totp?.find(
          (f) => f.status === "verified"
        );
        if (verifiedFactor) {
          // Already has MFA, redirect home
          router.push("/");
          return;
        }

        // Clean up all unverified factors before enrolling
        const unverifiedFactors =
          factors?.all?.filter(
            (f) => f.factor_type === "totp" && f.status === "unverified"
          ) || [];
        for (const factor of unverifiedFactors) {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }

        // Enroll new TOTP factor
        let enrollResult = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: COMPANY_NAME,
          issuer: COMPANY_NAME,
        });

        // If enroll fails (e.g. stale factor from a previous attempt), re-list, cleanup, and retry once
        if (enrollResult.error) {
          await new Promise((r) => setTimeout(r, 500));
          const { data: retryFactors } = await supabase.auth.mfa.listFactors();
          const staleFactors =
            retryFactors?.all?.filter(
              (f) => f.factor_type === "totp" && f.status === "unverified"
            ) || [];
          for (const factor of staleFactors) {
            await supabase.auth.mfa.unenroll({ factorId: factor.id });
          }
          enrollResult = await supabase.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: COMPANY_NAME,
            issuer: COMPANY_NAME,
          });
        }

        if (enrollResult.error) throw enrollResult.error;
        const data = enrollResult.data;

        if (data) {
          setMfaQrCode(data.totp.qr_code);
          setMfaSecret(data.totp.secret);
          setMfaFactorId(data.id);
        }
      } catch (err: any) {
        setError(err.message || "Failed to set up two-factor authentication");
      } finally {
        setLoading(false);
      }
    };

    checkAndEnroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerify = async () => {
    if (verificationCode.length !== 6 || !mfaFactorId) return;

    setVerifying(true);
    setError(null);

    try {
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: mfaFactorId });

      if (challengeError) throw challengeError;
      if (!challengeData) {
        throw new Error("Failed to create verification challenge");
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: verificationCode,
      });

      if (verifyError) throw verifyError;

      // Determine where to go next.
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      const metadata = currentUser?.user_metadata || {};
      const dest =
        !metadata.onboarding_completed && !metadata.avatar_url
          ? "/auth/profile-setup"
          : "/";

      // Hard navigation. mfa.verify just rotated the JWT and AAL — soft
      // router.push reuses cached middleware state from when the session was
      // still aal1 and bounces us back here. A full reload guarantees the
      // next request carries the new cookies.
      window.location.assign(dest);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.toLowerCase();

      let friendly =
        "That code didn't work. Please check your authenticator app and try again.";
      if (msg.includes("rate") || msg.includes("too many")) {
        friendly = "Too many attempts. Please wait a minute, then try again.";
      } else if (msg.includes("expired") || msg.includes("challenge")) {
        friendly =
          "The verification window expired. Open your authenticator app, copy the latest 6-digit code, and try again.";
      } else if (msg.includes("invalid") || msg.includes("totp")) {
        // Catches "Invalid TOTP code entered" — the raw Supabase string the
        // user reported. Authenticator codes change every 30s, so this is
        // almost always a timing or wrong-account issue, not a bug.
        friendly =
          "That code didn't match. Open your authenticator app, find the entry for this account, and enter the latest 6-digit code (it refreshes every 30 seconds).";
      }
      setError(friendly);
      setVerifying(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    setError(null);

    try {
      // Unenroll any unverified factor before skipping
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const unverifiedFactor = factors?.all?.find(
        (f) => f.factor_type === "totp" && f.status === "unverified"
      );
      if (unverifiedFactor) {
        await supabase.auth.mfa.unenroll({ factorId: unverifiedFactor.id });
      }

      // Check if profile setup is needed
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      const metadata = currentUser?.user_metadata || {};
      if (!metadata.onboarding_completed && !metadata.avatar_url) {
        router.push("/auth/profile-setup");
      } else {
        router.push("/");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSkipping(false);
    }
  };

  const copyToClipboard = () => {
    if (mfaSecret) {
      navigator.clipboard.writeText(mfaSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
      <div className="max-w-lg w-full">
        <Card className="p-6 md:p-8 gap-0">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {mfaRequired
                  ? "Two-Factor Authentication Required"
                  : "Set Up Two-Factor Authentication"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {mfaRequired
                  ? "Your organization requires two-factor authentication"
                  : "Add an extra layer of security to your account"}
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-6">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              {mfaRequired
                ? "You must set up two-factor authentication before you can continue using the application."
                : "We recommend setting up two-factor authentication to keep your account secure."}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-600 rounded-md">
              <p className="text-sm text-white">{error}</p>
            </div>
          )}

          {/* Setup Steps */}
          <ol className="space-y-5">
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-3 mt-0.5">
                1
              </span>
              <div className="flex-1">
                <p className="text-sm text-foreground">
                  Install an authenticator app like Google Authenticator or
                  Authy on your phone
                </p>
              </div>
            </li>

            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-3 mt-0.5">
                2
              </span>
              <div className="flex-1">
                <p className="text-sm text-foreground mb-3">
                  Scan this QR code with your authenticator app
                </p>
                {mfaQrCode && (
                  <div className="bg-card p-4 rounded-lg inline-block border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mfaQrCode}
                      alt="MFA QR Code"
                      className="w-48 h-48"
                    />
                  </div>
                )}
                {mfaSecret && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Or enter this code manually:
                    </p>
                    <div className="flex items-center space-x-2">
                      <code className="bg-muted px-3 py-1 rounded text-xs font-mono">
                        {mfaSecret}
                      </code>
                      <button
                        onClick={copyToClipboard}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>

            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-3 mt-0.5">
                3
              </span>
              <div className="flex-1">
                <p className="text-sm text-foreground mb-3">
                  Enter the 6-digit verification code from your app
                </p>
                <div className="flex items-center space-x-3">
                  <Input
                    type="text"
                    value={verificationCode}
                    onChange={(e) =>
                      setVerificationCode(
                        e.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    placeholder="000000"
                    className="w-32 text-center font-mono text-lg"
                    maxLength={6}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && verificationCode.length === 6) {
                        handleVerify();
                      }
                    }}
                  />
                  <Button
                    onClick={handleVerify}
                    disabled={verifying || verificationCode.length !== 6}
                  >
                    {verifying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Verify & Enable"
                    )}
                  </Button>
                </div>
              </div>
            </li>
          </ol>

          {!mfaRequired && (
            <div className="mt-6 pt-4 border-t border-border">
              <Button
                variant="ghost"
                onClick={handleSkip}
                disabled={skipping}
                className="w-full text-sm"
              >
                {skipping ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Skipping...
                  </span>
                ) : (
                  "Skip for now"
                )}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
