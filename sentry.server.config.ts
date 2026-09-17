// Sentry initialisation for the Node.js server runtime (route handlers, RSCs,
// Server Actions). Loaded from `instrumentation.ts` → `register()`.
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/sentry-options";

Sentry.init({
  ...sharedSentryOptions,
});
