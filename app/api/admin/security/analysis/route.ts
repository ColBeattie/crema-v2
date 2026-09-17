import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getSecurityAnalysis } from "@/app/admin/security/actions";
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
      "admin-security-analysis",
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

    const result = await getSecurityAnalysis();
    return createSecureResponse(result);
  } catch (error: unknown) {
    console.error("Error fetching security analysis:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-analysis" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}
