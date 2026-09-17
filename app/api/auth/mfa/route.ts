import { createClient } from "@/lib/supabase/server";
import { validateInput } from "@/lib/input-validation";
import { withApiSecurity, secureJson } from "@/lib/api-security";
import {
  checkRateLimit,
  recordSuccess,
  RATE_LIMIT_CONFIGS,
} from "@/lib/rate-limiting";
import { z } from "zod";

/**
 * MFA challenge endpoint (init / verify / cancel).
 *
 * This is a Route Handler, not a Server Action, on purpose: the 6-digit TOTP
 * code is a secret and Next.js prints Server Action arguments to the dev
 * console. Route handler bodies are never logged, so the code stays private.
 *
 * The acting user is derived from the session server-side (requireAuth), so the
 * client never asserts who it is.
 */

interface StoredMFASession {
  challengeId: string;
  factorId: string;
  expiresAt: number;
  userId: string;
  createdAt: number;
}

// In-memory store (per instance — see lib/rate-limiting.ts caveat; fine for a
// short-lived 5-minute challenge, move to Redis before multi-instance scaling).
const mfaSessions = new Map<string, StoredMFASession>();

setInterval(
  () => {
    const now = Date.now();
    for (const [id, session] of mfaSessions.entries()) {
      if (session.expiresAt < now) mfaSessions.delete(id);
    }
  },
  5 * 60 * 1000
);

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const VerifySchema = z.object({
  sessionId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
});

export const POST = withApiSecurity(
  { rateLimitKey: "auth-mfa", requireAuth: true },
  async ({ request, user }) => {
    let body: { op?: unknown; sessionId?: unknown; code?: unknown };
    try {
      body = await request.json();
    } catch {
      return secureJson({ success: false, error: "Invalid request." }, 400);
    }

    const op = body.op;
    const supabase = await createClient();

    // ── init ────────────────────────────────────────────────────────────
    if (op === "init") {
      const { data: factors, error: factorsError } =
        await supabase.auth.mfa.listFactors();
      if (factorsError) {
        return secureJson(
          { success: false, error: "Failed to retrieve MFA factors" },
          200
        );
      }

      const totpFactor = factors?.totp?.[0];
      if (!totpFactor || totpFactor.status !== "verified") {
        return secureJson(
          { success: false, error: "No verified MFA factor found" },
          200
        );
      }

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
      if (challengeError || !challenge) {
        return secureJson(
          { success: false, error: "Failed to create MFA challenge" },
          200
        );
      }

      const expiresAt = Date.now() + CHALLENGE_TTL_MS;
      const sessionId = `mfa_${user!.id}_${Date.now()}`;
      mfaSessions.set(sessionId, {
        challengeId: challenge.id,
        factorId: totpFactor.id,
        expiresAt,
        userId: user!.id,
        createdAt: Date.now(),
      });

      return secureJson({ success: true, sessionId, expiresAt }, 200);
    }

    // ── verify ──────────────────────────────────────────────────────────
    if (op === "verify") {
      let parsed: z.infer<typeof VerifySchema>;
      try {
        parsed = validateInput(VerifySchema, {
          sessionId: body.sessionId,
          code: body.code,
        });
      } catch {
        return secureJson(
          { success: false, error: "Invalid verification code" },
          200
        );
      }

      // Throttle verify attempts per user (the path MFA_VERIFY protects).
      const rl = checkRateLimit(
        user!.id,
        "mfa-verify",
        RATE_LIMIT_CONFIGS.MFA_VERIFY
      );
      if (!rl.allowed) {
        return secureJson(
          {
            success: false,
            error: "Too many attempts. Please sign in again.",
          },
          429
        );
      }

      const session = mfaSessions.get(parsed.sessionId);
      if (!session) {
        return secureJson(
          { success: false, error: "Invalid or expired MFA session" },
          200
        );
      }
      if (Date.now() > session.expiresAt) {
        mfaSessions.delete(parsed.sessionId);
        return secureJson(
          { success: false, error: "MFA challenge has expired" },
          200
        );
      }
      if (user!.id !== session.userId) {
        mfaSessions.delete(parsed.sessionId);
        return secureJson({ success: false, error: "Unauthorized" }, 200);
      }

      const { error } = await supabase.auth.mfa.verify({
        factorId: session.factorId,
        challengeId: session.challengeId,
        code: parsed.code,
      });

      if (error) {
        // Keep the session for retries until expiry.
        return secureJson(
          {
            success: false,
            error:
              error.message.includes("invalid") ||
              error.message.includes("verification_failed")
                ? "Invalid verification code"
                : "MFA verification failed",
          },
          200
        );
      }

      mfaSessions.delete(parsed.sessionId);
      recordSuccess(user!.id, "mfa-verify", RATE_LIMIT_CONFIGS.MFA_VERIFY);
      return secureJson({ success: true, redirect: "/" }, 200);
    }

    // ── cancel ──────────────────────────────────────────────────────────
    if (op === "cancel") {
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : "";
      const session = mfaSessions.get(sessionId);
      if (session && session.userId === user!.id) {
        mfaSessions.delete(sessionId);
      }
      return secureJson({ success: true }, 200);
    }

    return secureJson({ success: false, error: "Unknown operation" }, 400);
  }
);
