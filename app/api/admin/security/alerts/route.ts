import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getSecurityAlerts, acknowledgeAlert } from "@/lib/login-security";
import { rateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { sanitizeErrorMessage } from "@/lib/error-handling";

function createSecureResponse(data: unknown, status: number = 200): Response {
  const response = NextResponse.json(data, { status });
  return applySecurityHeaders(response, getEnvironmentSecurityConfig());
}

function createSecureErrorResponse(
  error: string,
  status: number = 400
): Response {
  return createSecureResponse({ error }, status);
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = rateLimit(
      "admin-security-alerts",
      RATE_LIMIT_CONFIGS.ADMIN_OPERATIONS
    )(request);
    if (!rateLimitResult.allowed) {
      return createSecureErrorResponse(
        "Too many requests. Please try again later.",
        429
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user)
      return createSecureErrorResponse("Unauthorized", 401);
    if (user.app_metadata?.role !== "admin")
      return createSecureErrorResponse("Admin access required", 403);

    const { searchParams } = new URL(request.url);
    const severity = searchParams.get("severity") || undefined;
    const acknowledged = searchParams.get("acknowledged");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      100
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = await getSecurityAlerts({
      severity,
      acknowledged:
        acknowledged === "true"
          ? true
          : acknowledged === "false"
            ? false
            : undefined,
      limit,
      offset,
    });

    return createSecureResponse(result);
  } catch (error: unknown) {
    console.error("Error fetching security alerts:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-alerts" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const rateLimitResult = rateLimit(
      "admin-security-alerts-ack",
      RATE_LIMIT_CONFIGS.ADMIN_OPERATIONS
    )(request);
    if (!rateLimitResult.allowed) {
      return createSecureErrorResponse(
        "Too many requests. Please try again later.",
        429
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user)
      return createSecureErrorResponse("Unauthorized", 401);
    if (user.app_metadata?.role !== "admin")
      return createSecureErrorResponse("Admin access required", 403);

    const body = await request.json();
    const { alertId } = body;

    if (!alertId || typeof alertId !== "string") {
      return createSecureErrorResponse("Alert ID is required");
    }

    const result = await acknowledgeAlert(alertId, user.id);

    if (!result.success) {
      return createSecureErrorResponse(
        result.error || "Failed to acknowledge alert"
      );
    }

    return createSecureResponse({ success: true });
  } catch (error: unknown) {
    console.error("Error acknowledging security alert:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-alerts" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}
