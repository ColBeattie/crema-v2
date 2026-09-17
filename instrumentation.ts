// Next.js instrumentation entrypoint.
//
// `register()` runs once per server runtime at boot and loads the matching
// Sentry init. `onRequestError` is the hook that makes Sentry capture *any*
// error thrown out of a route handler, React Server Component or Server Action
// — without it, server-side errors are never reported. Keep it exported.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
