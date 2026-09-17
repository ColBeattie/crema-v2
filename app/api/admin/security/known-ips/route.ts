import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getUserKnownIps, trustIp, untrustIp } from "@/lib/login-security";
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
      "admin-security-ips",
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
    const userId = searchParams.get("userId") || undefined;
    const trusted = searchParams.get("trusted");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      100
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = await getUserKnownIps({
      userId,
      trusted:
        trusted === "true" ? true : trusted === "false" ? false : undefined,
      limit,
      offset,
    });

    return createSecureResponse(result);
  } catch (error: unknown) {
    console.error("Error fetching known IPs:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-known-ips" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const rateLimitResult = rateLimit(
      "admin-security-ips-update",
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
    const { ipId, action } = body;

    if (!ipId || typeof ipId !== "string") {
      return createSecureErrorResponse("IP ID is required");
    }

    if (action !== "trust" && action !== "untrust") {
      return createSecureErrorResponse('Action must be "trust" or "untrust"');
    }

    const result =
      action === "trust" ? await trustIp(ipId, user.id) : await untrustIp(ipId);

    if (!result.success) {
      return createSecureErrorResponse(
        result.error || "Failed to update IP trust status"
      );
    }

    return createSecureResponse({ success: true });
  } catch (error: unknown) {
    console.error("Error updating known IP:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-known-ips" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}
