// Sentry initialisation for the Edge runtime (proxy / any edge route).
// Loaded from `instrumentation.ts` → `register()`.
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/sentry-options";

Sentry.init({
  ...sharedSentryOptions,
});
