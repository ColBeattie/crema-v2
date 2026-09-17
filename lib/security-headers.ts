/**
 * Security headers configuration to prevent XSS, clickjacking, and other attacks
 */

import { SUPPORT_URL } from "@/lib/support";

export interface SecurityHeadersConfig {
  enableCSP?: boolean;
  enableHSTS?: boolean;
  enableClickjackProtection?: boolean;
  enableContentTypeProtection?: boolean;
  enableReferrerPolicy?: boolean;
  cspDirectives?: Partial<CSPDirectives>;
}

export interface CSPDirectives {
  "default-src": string[];
  "script-src": string[];
  "style-src": string[];
  "img-src": string[];
  "font-src": string[];
  "connect-src": string[];
  "media-src": string[];
  "object-src": string[];
  "child-src": string[];
  "worker-src": string[];
  "frame-src": string[];
  "base-uri": string[];
  "form-action": string[];
  "frame-ancestors": string[];
  "manifest-src": string[];
}

// Default CSP configuration for Next.js applications
const DEFAULT_CSP_DIRECTIVES: CSPDirectives = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-eval'", // Required for Next.js development
    "'unsafe-inline'", // Required for some Next.js features
    "https://vercel.live",
    "https://vercel.com",
    SUPPORT_URL, // Support widget SDK (support-sdk.js)
  ],
  "style-src": [
    "'self'",
    "'unsafe-inline'", // Required for CSS-in-JS and Tailwind
    "https://fonts.googleapis.com",
  ],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https:", // Allow images from HTTPS sources
    "http://localhost:*", // Development only
  ],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "connect-src": [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    "https://vercel.live",
    "https://*.sentry.io", // Sentry error reporting (browser SDK ingest)
    SUPPORT_URL, // Support widget action-count badge (/api/widget/v1/badge)
    "ws://localhost:*", // Development HMR
    "http://localhost:*", // Development API calls
  ],
  "media-src": ["'self'"],
  "object-src": ["'none'"],
  "child-src": ["'none'"],
  "worker-src": ["'self'", "blob:"],
  // The support widget renders its whole UI in an iframe from this origin.
  // Kept unconditional rather than keyed off whether support is configured: a
  // CSP that varies per environment produces the "works for some users" class
  // of bug, and this is our own domain.
  "frame-src": [SUPPORT_URL],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "manifest-src": ["'self'"],
};

/**
 * Generate Content Security Policy header value
 */
function generateCSP(directives: Partial<CSPDirectives>): string {
  const mergedDirectives = { ...DEFAULT_CSP_DIRECTIVES, ...directives };

  return Object.entries(mergedDirectives)
    .map(
      ([directive, values]) =>
        [directive, (values || []).filter(Boolean)] as const
    )
    .filter(([, values]) => values.length > 0)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Get security headers based on configuration
 */
export function getSecurityHeaders(
  config: SecurityHeadersConfig = {}
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Content Security Policy
  if (config.enableCSP !== false) {
    headers["Content-Security-Policy"] = generateCSP(
      config.cspDirectives || {}
    );
  }

  // HTTP Strict Transport Security
  if (config.enableHSTS !== false) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains; preload";
  }

  // Clickjacking protection
  if (config.enableClickjackProtection !== false) {
    headers["X-Frame-Options"] = "DENY";
    // frame-ancestors is already defined in the CSP directives object — no string appending needed
  }

  // Content type protection
  if (config.enableContentTypeProtection !== false) {
    headers["X-Content-Type-Options"] = "nosniff";
  }

  // Referrer policy
  if (config.enableReferrerPolicy !== false) {
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  }

  // Permissions-Policy: disable powerful features by default. Re-enable any
  // feature the app actually uses (e.g. camera for a QR scanner) at the point
  // of use rather than loosening this baseline.
  headers["Permissions-Policy"] =
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
    "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()";

  // Additional security headers
  headers["X-DNS-Prefetch-Control"] = "off";
  headers["X-Download-Options"] = "noopen";
  headers["X-Permitted-Cross-Domain-Policies"] = "none";
  headers["Cross-Origin-Embedder-Policy"] = "unsafe-none"; // Adjust based on requirements
  headers["Cross-Origin-Opener-Policy"] = "same-origin";
  headers["Cross-Origin-Resource-Policy"] = "same-origin";

  return headers;
}

/**
 * Apply security headers to Next.js response
 */
export function applySecurityHeaders(
  response: Response,
  config?: SecurityHeadersConfig
): Response {
  const headers = getSecurityHeaders(config);

  Object.entries(headers).forEach(([name, value]) => {
    if (value) {
      response.headers.set(name, value);
    }
  });

  return response;
}

/**
 * Middleware helper to add security headers
 */
export function withSecurityHeaders(config?: SecurityHeadersConfig) {
  return (response: Response): Response => {
    return applySecurityHeaders(response, config);
  };
}

/**
 * Development-specific CSP directives
 */
export const DEVELOPMENT_CSP_OVERRIDES: Partial<CSPDirectives> = {
  "script-src": [
    "'self'",
    "'unsafe-eval'",
    "'unsafe-inline'",
    "http://localhost:*",
    "ws://localhost:*",
    "https://vercel.live",
    "https://vercel.com",
    SUPPORT_URL, // Support widget SDK (support-sdk.js)
  ],
  "connect-src": [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    "http://localhost:*",
    "ws://localhost:*",
    "https://vercel.live",
    "https://*.sentry.io", // Sentry error reporting (browser SDK ingest)
    SUPPORT_URL, // Support widget action-count badge (/api/widget/v1/badge)
  ],
  "img-src": ["'self'", "data:", "blob:", "https:", "http:"],
};

/**
 * Production-specific CSP directives (more restrictive)
 */
export const PRODUCTION_CSP_OVERRIDES: Partial<CSPDirectives> = {
  "script-src": [
    "'self'",
    "'unsafe-inline'", // Required for Next.js hydration/bootstrapping inline scripts
    "https://vercel.live", // Remove if not using Vercel
    SUPPORT_URL, // Support widget SDK (support-sdk.js)
  ],
  "connect-src": [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    "https://vercel.live", // Remove if not using Vercel
    "https://*.sentry.io", // Sentry error reporting (browser SDK ingest)
    SUPPORT_URL, // Support widget action-count badge (/api/widget/v1/badge)
  ],
  "img-src": ["'self'", "data:", "blob:", "https:"],
};

/**
 * Get environment-specific security configuration
 */
export function getEnvironmentSecurityConfig(): SecurityHeadersConfig {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    enableCSP: true,
    enableHSTS: isProduction, // Only enable HSTS in production
    enableClickjackProtection: true,
    enableContentTypeProtection: true,
    enableReferrerPolicy: true,
    cspDirectives: isProduction
      ? PRODUCTION_CSP_OVERRIDES
      : DEVELOPMENT_CSP_OVERRIDES,
  };
}
