import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
      "admin-security-users",
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

    const adminClient = createAdminClient();
    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers();

    if (error) {
      console.error("Error listing users:", error);
      return createSecureErrorResponse("Failed to list users", 500);
    }

    const userList = (users || []).map((u) => ({
      id: u.id,
      email: u.email || "",
      firstName: u.user_metadata?.first_name || "",
      lastName: u.user_metadata?.last_name || "",
    }));

    return createSecureResponse({ users: userList });
  } catch (error: unknown) {
    console.error("Error fetching users for security:", error);
    Sentry.captureException(error, {
      tags: { route: "admin-security-users" },
    });
    return createSecureResponse({ error: sanitizeErrorMessage(error) }, 500);
  }
}
