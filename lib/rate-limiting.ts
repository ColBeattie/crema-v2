/**
 * Rate limiting implementation to prevent brute force attacks and API abuse.
 *
 * ⚠️ STORAGE IS IN-MEMORY AND PER-INSTANCE. On serverless / multi-instance
 * deployments (e.g. Vercel) each instance keeps its own counters, so the
 * effective limit is multiplied by the instance count and counters reset on
 * every cold start. Treat this as best-effort throttling only. Before relying
 * on it as a real security control, back it with shared storage (Upstash/Redis,
 * Vercel KV) keyed by IP (for anonymous endpoints) or user id (for actions).
 */

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
    blocked: boolean;
    blockUntil?: number;
  };
}

// In-memory store (in production, use Redis or similar)
const rateLimitStore: RateLimitStore = {};

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach((key) => {
    const entry = rateLimitStore[key];
    if (
      entry.resetTime < now &&
      (!entry.blockUntil || entry.blockUntil < now)
    ) {
      delete rateLimitStore[key];
    }
  });
}, 60000); // Cleanup every minute

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxAttempts: number; // Maximum attempts in window
  blockDurationMs: number; // Block duration after exceeding limit
  skipOnSuccess?: boolean; // Reset counter on successful operation
}

// Predefined rate limit configurations
export const RATE_LIMIT_CONFIGS = {
  // Authentication attempts
  LOGIN: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 5,
    blockDurationMs: 30 * 60 * 1000, // 30 minutes
    skipOnSuccess: true,
  },

  // Password reset requests
  PASSWORD_RESET: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: 3,
    blockDurationMs: 60 * 60 * 1000, // 1 hour
    skipOnSuccess: false,
  },

  // MFA verification attempts
  MFA_VERIFY: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxAttempts: 5,
    blockDurationMs: 15 * 60 * 1000, // 15 minutes
    skipOnSuccess: true,
  },

  // API calls (general)
  API_CALLS: {
    windowMs: 60 * 1000, // 1 minute
    maxAttempts: 60,
    blockDurationMs: 60 * 1000, // 1 minute
    skipOnSuccess: false,
  },

  // File upload
  FILE_UPLOAD: {
    windowMs: 60 * 1000, // 1 minute
    maxAttempts: 5,
    blockDurationMs: 5 * 60 * 1000, // 5 minutes
    skipOnSuccess: true,
  },

  // Admin operations
  ADMIN_OPERATIONS: {
    windowMs: 60 * 1000, // 1 minute
    maxAttempts: 30,
    blockDurationMs: 5 * 60 * 1000, // 5 minutes
    skipOnSuccess: false,
  },
} as const;

/**
 * Get client identifier from request.
 *
 * Keyed on IP only. Do NOT mix in the User-Agent: a brute-forcer fully controls
 * that header, so including it would let them mint a fresh bucket per request
 * and sail past a per-IP limit.
 */
export function getClientId(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const cfConnectingIp = request.headers.get("cf-connecting-ip"); // Cloudflare

  const ip =
    forwardedFor?.split(",")[0].trim() || realIp || cfConnectingIp || "unknown";

  return ip;
}

/**
 * Check if request is rate limited
 */
export function checkRateLimit(
  clientId: string,
  key: string,
  config: RateLimitConfig
): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
} {
  const now = Date.now();
  const storeKey = `${clientId}:${key}`;
  const entry = rateLimitStore[storeKey];

  // Check if client is currently blocked
  if (entry?.blocked && entry.blockUntil && entry.blockUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.blockUntil,
      retryAfter: Math.ceil((entry.blockUntil - now) / 1000),
    };
  }

  // Initialize or reset if window has passed
  if (!entry || entry.resetTime < now) {
    rateLimitStore[storeKey] = {
      count: 1,
      resetTime: now + config.windowMs,
      blocked: false,
    };

    return {
      allowed: true,
      remaining: config.maxAttempts - 1,
      resetTime: now + config.windowMs,
    };
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > config.maxAttempts) {
    // Block the client
    entry.blocked = true;
    entry.blockUntil = now + config.blockDurationMs;

    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter: Math.ceil(config.blockDurationMs / 1000),
    };
  }

  return {
    allowed: true,
    remaining: config.maxAttempts - entry.count,
    resetTime: entry.resetTime,
  };
}

/**
 * Record successful operation (optionally reset counter)
 */
export function recordSuccess(
  clientId: string,
  key: string,
  config: RateLimitConfig
): void {
  if (config.skipOnSuccess) {
    const storeKey = `${clientId}:${key}`;
    delete rateLimitStore[storeKey];
  }
}

/**
 * Rate limiting middleware for Next.js API routes
 */
export function rateLimit(key: string, config: RateLimitConfig) {
  return (request: Request) => {
    const clientId = getClientId(request);
    const result = checkRateLimit(clientId, key, config);

    return {
      ...result,
      headers: {
        "X-RateLimit-Limit": config.maxAttempts.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
        ...(result.retryAfter && {
          "Retry-After": result.retryAfter.toString(),
        }),
      },
      recordSuccess: () => recordSuccess(clientId, key, config),
    };
  };
}

/**
 * Server action rate limiting wrapper
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  action: T,
  key: string,
  config: RateLimitConfig,
  getClientId?: () => string
): T {
  return (async (...args: Parameters<T>) => {
    // For server actions, we need to get client info differently
    // This is a limitation - server actions don't have direct request access
    // In practice, you'd integrate with your auth system to get user/session info
    const clientId = getClientId ? getClientId() : "server-action";

    const result = checkRateLimit(clientId, key, config);

    if (!result.allowed) {
      return {
        success: false,
        error: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
        rateLimited: true,
      };
    }

    try {
      const actionResult = await action(...args);

      // If action was successful, record it
      if (actionResult?.success !== false) {
        recordSuccess(clientId, key, config);
      }

      return actionResult;
    } catch (error) {
      throw error;
    }
  }) as T;
}

/**
 * Per-actor rate limit for server actions. Throws when the limit is exceeded so
 * callers can simply `await assertRateLimit(...)` at the top of an action.
 *
 * Key the limit on something the caller cannot freely rotate — typically the
 * authenticated user id. See the storage caveat at the top of this file.
 */
export async function assertRateLimit(
  actorId: string,
  key: string,
  config: RateLimitConfig
): Promise<void> {
  const result = checkRateLimit(actorId, key, config);
  if (!result.allowed) {
    throw new Error(
      `Rate limit exceeded. Please try again in ${result.retryAfter ?? 60} seconds.`
    );
  }
}

/**
 * Clean up rate limit store (useful for testing)
 */
export function clearRateLimitStore(): void {
  Object.keys(rateLimitStore).forEach((key) => {
    delete rateLimitStore[key];
  });
}

/**
 * Get current rate limit stats (useful for monitoring)
 */
export function getRateLimitStats(): {
  totalEntries: number;
  blockedClients: number;
  topClients: Array<{ clientId: string; count: number; blocked: boolean }>;
} {
  const entries = Object.entries(rateLimitStore);
  const blockedClients = entries.filter(([_, entry]) => entry.blocked).length;

  const topClients = entries
    .map(([key, entry]) => ({
      clientId: key.split(":")[0],
      count: entry.count,
      blocked: entry.blocked,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalEntries: entries.length,
    blockedClients,
    topClients,
  };
}
