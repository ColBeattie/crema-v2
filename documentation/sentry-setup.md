# Sentry error reporting

Server-side and client-side error reporting via `@sentry/nextjs`. Wired so that
**future code reports errors automatically**, **missing keys never break the
build or app**, and **the dev server stays silent** except for deliberate tests.

## How errors reach Sentry

| Source                                                    | Captured by                                          |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Thrown errors in route handlers / RSCs / Server Actions   | `onRequestError` in `instrumentation.ts`             |
| Errors caught & returned as a 500 via `withApiSecurity()` | `Sentry.captureException` in `lib/api-security.ts`   |
| Errors caught by `handleSecureError()` (server actions)   | `Sentry.captureException` in `lib/error-handling.ts` |
| The hand-rolled admin/security + upload-avatar routes     | `Sentry.captureException` before each `500` return   |
| Unhandled errors in the browser                           | `instrumentation-client.ts`                          |

The second/third rows matter: most handlers here **catch** the error and return
a sanitized `500` as a _value_, which never propagates to Sentry's
auto-instrumentation. We capture explicitly at those chokepoints so nothing is
silently swallowed.

## Behaviour guarantees

- **No keys → no failure.** When `NEXT_PUBLIC_SENTRY_DSN` is unset the SDK is
  `enabled: false` and fully no-ops. The build also succeeds: source-map upload
  is skipped unless `SENTRY_AUTH_TOKEN` is present (see `next.config.ts`).
- **Dev server is muted.** Outside a production build, `beforeSend`
  (`lib/sentry-options.ts`) drops every event — **except** events tagged as a
  manual test, which is how `/sentry-example-page` works locally.
- **PII scrubbed.** `sendDefaultPii: false` plus `beforeSend` strips query
  strings, headers, cookies and request bodies, and reduces `user` to an id.
- **No Session Replay / screen recording.** Intentionally omitted.

## Environment variables

Set these in Vercel (and `.env.local` for local testing). All are optional —
the app runs fine without them.

| Variable                                | Required?        | Purpose                                                            |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN`                | to report at all | Project ingest DSN (public by design).                             |
| `SENTRY_ORG`                            | source maps only | Sentry org slug, used at build time for source-map upload.         |
| `SENTRY_PROJECT`                        | source maps only | Sentry project slug.                                               |
| `SENTRY_AUTH_TOKEN`                     | source maps only | Build-time token; when absent, upload is skipped (build still ok). |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | no (default `0`) | Set `>0` to enable performance tracing. Errors don't need it.      |

> `SENTRY_AUTH_TOKEN` is a secret — keep it un-prefixed and never expose it
> client-side. The DSN is the only Sentry value that is safe as `NEXT_PUBLIC_`.

## Testing the integration

Visit **`/sentry-example-page`** and click either button:

- **Client-side test error** — captured in the browser SDK.
- **Server-side test error** — hits `GET /api/sentry-example-error`.

Both emit a test-tagged event, so they show up in Sentry **even when running
`npm run dev`** (every other dev error stays muted). If `NEXT_PUBLIC_SENTRY_DSN`
is unset, the page shows a red banner and events are discarded.

## CSP note

`https://*.sentry.io` is allow-listed in `connect-src` (single CSP source:
`lib/security-headers.ts`) so the browser SDK can reach the ingest endpoint.
