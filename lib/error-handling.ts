/**
 * Secure error handling utilities to prevent information disclosure
 */

import * as Sentry from "@sentry/nextjs";

// Define safe error messages that don't expose system internals
const SAFE_ERROR_MESSAGES = {
  // Authentication errors
  INVALID_CREDENTIALS: "Invalid email or password",
  SESSION_EXPIRED: "Your session has expired. Please sign in again",
  UNAUTHORIZED: "You are not authorized to perform this action",

  // Validation errors
  INVALID_INPUT: "Please check your input and try again",
  REQUIRED_FIELD: "All required fields must be filled",
  INVALID_EMAIL: "Please enter a valid email address",
  INVALID_PASSWORD: "Password does not meet security requirements",

  // Operation errors
  OPERATION_FAILED: "The operation could not be completed. Please try again",
  USER_NOT_FOUND: "User not found",
  EMAIL_SEND_FAILED: "Unable to send email. Please try again later",
  FILE_UPLOAD_FAILED:
    "File upload failed. Please check your file and try again",

  // Database/System errors
  DATABASE_ERROR: "A database error occurred. Please try again later",
  NETWORK_ERROR: "Network error. Please check your connection and try again",
  SERVER_ERROR: "An internal server error occurred. Please try again later",
  SERVICE_UNAVAILABLE:
    "Service temporarily unavailable. Please try again later",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "Too many requests. Please wait and try again",

  // Generic fallback
  GENERIC_ERROR: "An unexpected error occurred. Please try again",
} as const;

// Patterns to detect sensitive information in error messages
const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /key/i,
  /secret/i,
  /database/i,
  /sql/i,
  /connection/i,
  /port/i,
  /host/i,
  /server/i,
  /internal/i,
  /stack/i,
  /trace/i,
  /debug/i,
  /supabase/i,
  /postgres/i,
  /auth\./i,
  /\.env/i,
  /config/i,
  /NEXT_/i,
  /process\.env/i,
];

/**
 * Sanitizes error messages to prevent information disclosure
 */
export function sanitizeErrorMessage(error: unknown): string {
  // Handle null/undefined
  if (!error) {
    return SAFE_ERROR_MESSAGES.GENERIC_ERROR;
  }

  let errorMessage: string;

  // Extract message from various error types
  if (typeof error === "string") {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    errorMessage = String((error as any).message);
  } else {
    return SAFE_ERROR_MESSAGES.GENERIC_ERROR;
  }

  // Check for specific known error patterns and map to safe messages
  const lowerMessage = errorMessage.toLowerCase();

  // Validation errors - preserve these as they are user-facing and helpful
  if (
    lowerMessage.includes("password must") ||
    lowerMessage.includes("name can only") ||
    lowerMessage.includes("email must") ||
    lowerMessage.includes("at least") ||
    lowerMessage.includes("must contain") ||
    lowerMessage.includes("must not exceed") ||
    lowerMessage.includes("is required") ||
    lowerMessage.includes("validation failed")
  ) {
    // These are validation errors that should be shown to the user
    return errorMessage;
  }

  // Authentication-related errors
  if (
    lowerMessage.includes("invalid login credentials") ||
    lowerMessage.includes("invalid email or password") ||
    lowerMessage.includes("email not confirmed")
  ) {
    return SAFE_ERROR_MESSAGES.INVALID_CREDENTIALS;
  }

  if (
    lowerMessage.includes("email rate limit exceeded") ||
    lowerMessage.includes("too many requests")
  ) {
    return SAFE_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
  }

  if (
    lowerMessage.includes("user not found") ||
    lowerMessage.includes("no user found")
  ) {
    return SAFE_ERROR_MESSAGES.USER_NOT_FOUND;
  }

  if (
    lowerMessage.includes("session") &&
    (lowerMessage.includes("expired") || lowerMessage.includes("invalid"))
  ) {
    return SAFE_ERROR_MESSAGES.SESSION_EXPIRED;
  }

  if (
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("access denied") ||
    lowerMessage.includes("permission denied")
  ) {
    return SAFE_ERROR_MESSAGES.UNAUTHORIZED;
  }

  // Database/Network errors
  if (lowerMessage.includes("network") || lowerMessage.includes("fetch")) {
    return SAFE_ERROR_MESSAGES.NETWORK_ERROR;
  }

  if (
    lowerMessage.includes("database") ||
    lowerMessage.includes("connection") ||
    lowerMessage.includes("timeout")
  ) {
    return SAFE_ERROR_MESSAGES.DATABASE_ERROR;
  }

  if (
    lowerMessage.includes("service unavailable") ||
    lowerMessage.includes("503")
  ) {
    return SAFE_ERROR_MESSAGES.SERVICE_UNAVAILABLE;
  }

  // Check for sensitive patterns
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    console.warn(
      "Sensitive information detected in error message:",
      errorMessage
    );
    return SAFE_ERROR_MESSAGES.SERVER_ERROR;
  }

  // If message is safe and user-friendly, allow it
  if (
    errorMessage.length < 100 &&
    !errorMessage.includes("/") &&
    !errorMessage.includes("\\") &&
    !errorMessage.includes("Error:") &&
    !/[A-Z]{3,}/.test(errorMessage)
  ) {
    return errorMessage;
  }

  // Default to generic error for any unhandled cases
  return SAFE_ERROR_MESSAGES.GENERIC_ERROR;
}

/**
 * Logs errors securely for debugging while returning safe messages to users
 */
export function handleSecureError(
  error: unknown,
  context?: string
): { success: false; error: string } {
  // Log the full error for debugging (server-side only)
  const errorInfo = {
    context,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
    timestamp: new Date().toISOString(),
  };

  console.error("Secure error handler:", errorInfo);

  // Report to Sentry. Many of our handlers catch the error and return a 500 as
  // a value, which means it never propagates to Sentry's auto-instrumentation —
  // so we capture it explicitly here. No-ops when Sentry has no DSN or the build
  // isn't production.
  Sentry.captureException(error, context ? { tags: { context } } : undefined);

  // Return sanitized message to user
  return {
    success: false,
    error: sanitizeErrorMessage(error),
  };
}

/**
 * Server action wrapper that handles errors securely
 */
export function withSecureErrorHandling<
  T extends (...args: any[]) => Promise<any>,
>(action: T, context?: string): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await action(...args);
    } catch (error) {
      return handleSecureError(error, context);
    }
  }) as T;
}

export { SAFE_ERROR_MESSAGES };
