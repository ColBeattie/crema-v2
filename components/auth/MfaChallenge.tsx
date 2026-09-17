"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Calls the MFA route handler. The TOTP code travels in the POST body (route
// handler bodies aren't logged), never as a Server Action argument.
async function mfaRequest(payload: Record<string, unknown>) {
  const res = await fetch("/api/auth/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

interface MfaChallengeProps {
  userId: string;
  onSuccess: (redirect?: string) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  cancelLabel?: string;
}

const MAX_ATTEMPTS = 5;

export function MfaChallenge({
  userId,
  onSuccess,
  onCancel,
  cancelLabel = "Back to login",
}: MfaChallengeProps) {
  const [initializing, setInitializing] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const result = await mfaRequest({ op: "init" });
        if (cancelled) return;

        if (!result.success) {
          setError(result.error || "Failed to start MFA challenge.");
          setInitializing(false);
          return;
        }

        setSessionId(result.sessionId!);
        sessionIdRef.current = result.sessionId!;
        setExpiresAt(result.expiresAt!);
        setInitializing(false);
      } catch {
        if (cancelled) return;
        setError("Unable to start MFA challenge. Please try signing in again.");
        setInitializing(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sessionId) {
      setError("MFA session invalid. Please sign in again.");
      return;
    }

    if (expiresAt && Date.now() >= expiresAt) {
      setError("MFA challenge has expired. Please sign in again.");
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      setError("Too many failed attempts. Please sign in again.");
      return;
    }

    setVerifying(true);

    try {
      const result = await mfaRequest({ op: "verify", sessionId, code });

      if (!result.success) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (result.error?.includes("expired")) {
          setError("MFA challenge has expired. Please sign in again.");
        } else {
          const remaining = MAX_ATTEMPTS - newAttempts;
          setError(
            remaining > 0
              ? `${result.error || "Invalid verification code"}. ${remaining} attempts remaining.`
              : "Too many failed attempts. Please sign in again."
          );
        }

        setCode("");
        setVerifying(false);
        return;
      }

      sessionIdRef.current = null;
      await onSuccess(result.redirect);
    } catch {
      setError("An unexpected error occurred. Please try signing in again.");
      setVerifying(false);
    }
  };

  const handleCancel = async () => {
    if (sessionIdRef.current) {
      try {
        await mfaRequest({ op: "cancel", sessionId: sessionIdRef.current });
      } catch {}
      sessionIdRef.current = null;
    }
    await onCancel();
  };

  return (
    <form onSubmit={handleVerify} className="space-y-6">
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-lg font-medium text-foreground">
          Two-Factor Authentication
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          Enter the 6-digit code from your authenticator app
        </p>
        {attempts > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            {MAX_ATTEMPTS - attempts} attempts remaining
          </p>
        )}
      </div>

      {initializing ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Input
            type="text"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className="text-center font-mono text-xl tracking-widest"
            placeholder="000000"
            maxLength={6}
            autoFocus
            required
          />

          {error && (
            <div className="bg-red-600 text-white p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={verifying || code.length !== 6 || !sessionId}
            className="w-full"
          >
            {verifying ? (
              <span className="flex items-center">
                <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                Verifying...
              </span>
            ) : (
              "Verify"
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            className="w-full"
          >
            {cancelLabel}
          </Button>
        </>
      )}
    </form>
  );
}
