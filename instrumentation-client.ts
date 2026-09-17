// Sentry initialisation for the browser. Next.js loads this automatically on
// the client; no import needed elsewhere. Captures unhandled client errors and
// promise rejections once a DSN is configured and the build is production.
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/sentry-options";

Sentry.init({
  ...sharedSentryOptions,
});

// Lets Sentry tie navigation transitions to errors in the App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
