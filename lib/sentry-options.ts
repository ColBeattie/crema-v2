/**
 * Shared Sentry configuration used by every runtime (server, edge, browser).
 *
 * Three guarantees this file enforces, in line with the project rules:
 *
 * 1. **Missing keys never break the app.** `enabled` is false whenever
 *    `NEXT_PUBLIC_SENTRY_DSN` is unset, so the SDK fully no-ops — no crash at
 *    boot, no failed requests, no build failure. Ship without keys and wire
 *    them in later by just setting the env vars.
 * 2. **The dev server never reports real errors.** In any non-production build
 *    (`npm run dev`, NODE_ENV=development) `beforeSend` drops every event before
 *    it leaves the process. The single exception is a deliberately-flagged test
 *    event (see `app/sentry-example-page`), which is allowed through so you can
 *    verify the integration locally. Production reports everything.
 * 3. **PII is scrubbed before send** (see `.claude/rules/security.md` → Observability):
 *    `sendDefaultPii: false` plus a `beforeSend` that strips query strings,
 *    headers, cookies and request bodies, and reduces `user` to an id only.
 *
 * This module must stay free of any runtime-specific imports (no `next/*`, no
 * node built-ins) because it is bundled into the browser build as well.
 */

// The DSN is intentionally public (it only identifies the project ingest
// endpoint and cannot be used to read data), so the NEXT_PUBLIC_ prefix is
// correct here per the secrets rule.
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

/**
 * A real Sentry DSN is a URL like `https://<key>@<host>/<projectId>`. We
 * validate the shape so that a blank value OR a leftover placeholder such as
 * `INSERT_TOKEN_HERE` is treated as "not configured" — instead of silently
 * initialising a dead client that still mints local event IDs (which made the
 * test page falsely report success).
 */
function isValidDsn(dsn: string): boolean {
  try {
    const url = new URL(dsn);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length > 0 && // the public key
      url.pathname.replace(/\//g, "").length > 0 // the project id
    );
  } catch {
    return false;
  }
}

// Without a valid DSN the SDK is completely inert — this is what makes a
// key-less project safe to build and run.
export const SENTRY_ENABLED = isValidDsn(SENTRY_DSN);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Tag that marks an event as a deliberate manual test. Events carrying
 * `{ [SENTRY_TEST_EVENT_TAG]: "true" }` are allowed through even on the dev
 * server, where every other event is dropped. Used by `/sentry-example-page`.
 */
export const SENTRY_TEST_EVENT_TAG = "sentry_test_event";

// Distinguish preview vs production deployments inside Sentry.
const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_VERCEL_ENV ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  "development";

// Default to error-only reporting (no performance transactions) to keep cost
// predictable. Override via env if you want tracing later.
const TRACES_SAMPLE_RATE = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  : 0;

/**
 * Strip personally identifiable / sensitive request data from an event before
 * it leaves the process. Typed as `any` so the same helper works across the
 * browser, node and edge SDK event shapes.
 */
function scrubSensitiveData(event: any): any {
  const request = event?.request as Record<string, any> | undefined;
  if (request) {
    delete request.cookies;
    delete request.headers;
    delete request.data; // request body
    delete request.query_string;
    if (typeof request.url === "string") {
      // Drop the query string from the URL itself.
      request.url = request.url.split("?")[0];
    }
  }

  // Keep only a stable user id; never send ip address or email.
  if (event?.user) {
    const id = event.user.id;
    event.user = id ? { id } : undefined;
  }

  return event;
}

/**
 * Gate + scrub. Returning `null` drops the event entirely.
 */
function beforeSend(event: any): any {
  const isTestEvent = event?.tags?.[SENTRY_TEST_EVENT_TAG] === "true";

  // Outside production, swallow everything except an explicit manual test so
  // the dev server never pollutes Sentry with local noise.
  if (!IS_PRODUCTION && !isTestEvent) {
    return null;
  }

  return scrubSensitiveData(event);
}

/**
 * Options shared by every `Sentry.init()` call. Spread this into each
 * runtime-specific config and add only what is unique to that runtime.
 */
export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  // Never attach cookies / IP / headers automatically.
  sendDefaultPii: false,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  // Keep the SDK quiet in logs; it should be invisible unless it's reporting.
  debug: false,
  beforeSend,
} as const;
