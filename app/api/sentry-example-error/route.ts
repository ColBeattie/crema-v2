import * as Sentry from "@sentry/nextjs";
import { withApiSecurity, secureJson } from "@/lib/api-security";
import { SENTRY_ENABLED, SENTRY_TEST_EVENT_TAG } from "@/lib/sentry-options";

// Don't cache — this should run on every request.
export const dynamic = "force-dynamic";

/**
 * Server-side test endpoint for /sentry-example-page. Captures a deliberate
 * error flagged as a manual test so it reaches Sentry even on the dev server
 * (every other dev event is dropped). Public + rate-limited via withApiSecurity.
 */
export const GET = withApiSecurity(
  { rateLimitKey: "sentry-example", requireAuth: false },
  async () => {
    // Fail loudly instead of pretending success when Sentry has no valid DSN.
    if (!SENTRY_ENABLED) {
      return secureJson(
        {
          ok: false,
          error:
            "Sentry is not configured (NEXT_PUBLIC_SENTRY_DSN missing or invalid).",
        },
        503
      );
    }

    const eventId = Sentry.captureException(
      new Error("Sentry server-side test error (deliberate)"),
      { tags: { [SENTRY_TEST_EVENT_TAG]: "true" } }
    );

    // Ensure the event is flushed before the serverless function returns.
    await Sentry.flush(2000);

    return secureJson({ ok: true, eventId });
  }
);
