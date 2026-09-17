import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  // Don't advertise the framework/version in response headers
  poweredByHeader: false,
  // Allow the ngrok tunnel host to hit dev-server assets (/_next/*) without
  // triggering the cross-origin dev request warning/block.
  allowedDevOrigins: ["productivitytools.ngrok.app"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Build identification for the support widget, so every ticket records which
  // build was running when it was raised. The CI variables below are
  // server-side only — client code cannot read them, so they are mapped to
  // public ones here at build time. Empty is fine and honest; do NOT substitute
  // a placeholder like "1.0.0", which would make an unknown build look known.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || "",
    NEXT_PUBLIC_GIT_COMMIT:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "",
    NEXT_PUBLIC_RELEASE_ID:
      process.env.VERCEL_DEPLOYMENT_ID || process.env.GITHUB_RUN_ID || "",
  },
  // Suppress specific warnings in production builds
  typescript: {
    ignoreBuildErrors: false,
  },
  // OAuth discovery documents for the MCP integration.
  //
  // RFC 8414 / RFC 9728 fix these paths at the origin root, and an AI client
  // fetches them literally — they are not ours to move. The handlers live
  // under /api/mcp/oauth/* (outside the proxy matcher, so they stay public,
  // which they must be: they are what an unauthenticated client reads to find
  // out how to authenticate).
  //
  // Both the bare path and the resource-suffixed form are mapped, because
  // clients differ on which they try — the suffixed form appends the
  // resource's path, e.g. /.well-known/oauth-protected-resource/api/mcp.
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/mcp/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/oauth/authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/mcp/oauth/authorization-server",
      },
    ];
  },
  async headers() {
    return [
      {
        // Site-wide noindex. The `robots` metadata in app/layout.tsx only
        // reaches rendered HTML; this header also covers API responses, file
        // downloads, PDFs and static assets. Set here rather than in
        // lib/security-headers.ts because the proxy matcher excludes /api and
        // static paths — next.config headers apply to every response.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

// Wrap the config with Sentry's build plugin. This is safe to apply
// unconditionally: when the Sentry credentials below are absent, source-map
// upload is disabled and the build proceeds normally — a missing key never
// fails the build. Source maps are only uploaded when SENTRY_AUTH_TOKEN (plus
// org/project) are present, typically in CI / Vercel for production builds.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Only upload source maps when an auth token is configured, so local and
  // key-less builds never fail or stall on an upload step.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Keep the build output quiet unless running in CI.
  silent: !process.env.CI,
  // Don't send Sentry's own bundler telemetry.
  telemetry: false,
  // Upload a wider set of client bundles for better stack traces.
  widenClientFileUpload: true,
  // Strip the Sentry SDK's debug logging from the production client bundle.
  disableLogger: true,
});
