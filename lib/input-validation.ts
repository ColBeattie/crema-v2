/**
 * Comprehensive input validation and sanitization to prevent injection attacks
 */

import { z } from "zod";

// Common patterns for security validation
const DANGEROUS_PATTERNS = {
  SQL_INJECTION: [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|sp_|xp_)\b)/gi,
    /(\s*(=|;|'|"|--|\*|\/\*|\*\/|\+|\||&)\s*)/g,
    /(0x[0-9a-f]+)/gi,
    /(char\s*\(\s*\d+\s*\))/gi,
  ],
  XSS: [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
    /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?>[\s\S]*?<\/embed>/gi,
    /<link[\s\S]*?>/gi,
    /<style[\s\S]*?>[\s\S]*?<\/style>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:/gi,
    /on\w+\s*=/gi, // Event handlers like onclick, onload, etc.
  ],
  COMMAND_INJECTION: [
    /(\||&|;|`|\$\(|\${)/g,
    /(nc|netcat|curl|wget|ping|nslookup|dig)/gi,
    /(rm|cat|ls|ps|kill|chmod|chown|sudo)/gi,
  ],
  PATH_TRAVERSAL: [/\.\.[\/\\]/g, /%2e%2e[\/\\]/gi, /\.\.[%2f%5c]/gi],
  LDAP_INJECTION: [/(\*|\(|\)|\\|\/)/g],
};

// Sanitization functions
export function sanitizeString(input: string): string {
  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }

  let sanitized = input;

  // Remove null bytes
  sanitized = sanitized.replace(/\x00/g, "");

  // Remove dangerous Unicode characters
  sanitized = sanitized.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");

  // Remove suspicious patterns
  DANGEROUS_PATTERNS.XSS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, "");
  });

  return sanitized.trim();
}

export function sanitizeHTML(input: string): string {
  // Basic HTML entity encoding
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

export function sanitizeFilename(filename: string): string {
  // Remove path separators and dangerous characters
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "") // Remove leading dots
    .replace(/\.+$/, "") // Remove trailing dots
    .trim()
    .substring(0, 255); // Limit length
}

export function sanitizeEmail(email: string): string {
  // Basic email sanitization
  return email
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9@._-]/g, "");
}

// Validation schemas with security checks
export const ValidationSchemas = {
  // User input validation
  email: z
    .string()
    .email("Invalid email format")
    .min(3, "Email must be at least 3 characters")
    .max(320, "Email must not exceed 320 characters")
    .refine((email) => {
      // Only check for actual dangerous patterns in emails
      // Skip checks for @ . - _ which are valid email characters
      const dangerousForEmail = [
        /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
        /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
        /javascript:/gi,
        /vbscript:/gi,
        /on\w+\s*=/gi,
        /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi,
        /\.\.[\/\\]/g,
        /(;|'|"|--)/g, // Only truly dangerous SQL characters (+ is valid in emails)
      ];
      return !dangerousForEmail.some((pattern) => pattern.test(email));
    }, "Email contains invalid characters"),

  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must not exceed 128 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    )
    .refine(
      (password) => !containsCommonPatterns(password),
      "Password contains common patterns"
    ),

  firstName: z
    .string()
    .min(1, "First name is required")
    .max(50, "First name must not exceed 50 characters")
    .regex(
      /^[\p{L}\p{M}\d\s'.\-]+$/u,
      "First name can only contain letters, numbers, spaces, hyphens, periods and apostrophes"
    ),

  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(50, "Last name must not exceed 50 characters")
    .regex(
      /^[\p{L}\p{M}\d\s'.\-]+$/u,
      "Last name can only contain letters, numbers, spaces, hyphens, periods and apostrophes"
    ),

  userId: z.string().uuid("Invalid user ID format"),

  filename: z
    .string()
    .min(1, "Filename is required")
    .max(255, "Filename must not exceed 255 characters")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Filename can only contain letters, numbers, dots, underscores and hyphens"
    )
    .refine(
      (filename) => !filename.startsWith("."),
      "Filename cannot start with a dot"
    ),

  // Search query validation
  searchQuery: z
    .string()
    .max(100, "Search query must not exceed 100 characters")
    .refine(
      (query) => !containsDangerousPatterns(query),
      "Search query contains invalid characters"
    ),

  // URL validation
  url: z
    .string()
    .url("Invalid URL format")
    .refine((url) => {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    }, "Only HTTP and HTTPS URLs are allowed"),

  // Generic text validation
  text: z
    .string()
    .max(1000, "Text must not exceed 1000 characters")
    .refine(
      (text) => !containsDangerousPatterns(text),
      "Text contains invalid characters"
    ),

  // Numeric validations
  positiveInteger: z
    .number()
    .int("Must be an integer")
    .positive("Must be positive"),

  page: z
    .number()
    .int("Page must be an integer")
    .min(1, "Page must be at least 1")
    .max(1000, "Page cannot exceed 1000"),

  limit: z
    .number()
    .int("Limit must be an integer")
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100"),
};

// Helper functions
function containsDangerousPatterns(input: string): boolean {
  const allPatterns = [
    ...DANGEROUS_PATTERNS.SQL_INJECTION,
    ...DANGEROUS_PATTERNS.XSS,
    ...DANGEROUS_PATTERNS.COMMAND_INJECTION,
    ...DANGEROUS_PATTERNS.PATH_TRAVERSAL,
    ...DANGEROUS_PATTERNS.LDAP_INJECTION,
  ];

  // These are module-level `/g` regexes. `RegExp.prototype.test` advances
  // `lastIndex` on a global regex, so a reused pattern would start mid-string
  // on the next call and intermittently miss a match. Reset before each test.
  return allPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}

function containsCommonPatterns(password: string): boolean {
  const commonPatterns = [
    /(.)\1{3,}/, // Repeated characters
    /123456|abcdef|qwerty|password|admin|user/i,
    /^.{1,11}$/, // Too short (handled by min length but defensive)
  ];

  return commonPatterns.some((pattern) => pattern.test(password));
}

// Validation middleware for server actions
export function validateInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Get detailed error messages
      if (error.issues && error.issues.length > 0) {
        const errorsByField: { [key: string]: string[] } = {};

        // Group errors by field
        error.issues.forEach((err) => {
          const fieldName =
            err.path.length > 0 ? err.path[0].toString() : "general";
          if (!errorsByField[fieldName]) {
            errorsByField[fieldName] = [];
          }
          errorsByField[fieldName].push(err.message);
        });

        // Format the error message
        const errorMessages: string[] = [];
        for (const [field, messages] of Object.entries(errorsByField)) {
          if (field === "password" && messages.length > 0) {
            // Special formatting for password errors
            errorMessages.push(
              `Please make sure all password requirements are met and try again:\n• ${messages.join("\n• ")}`
            );
          } else if (
            (field === "firstName" || field === "lastName") &&
            messages.length > 0
          ) {
            // Special formatting for name errors
            errorMessages.push(
              `Please check your ${field === "firstName" ? "first" : "last"} name:\n• ${messages.join("\n• ")}`
            );
          } else if (field === "email" && messages.length > 0) {
            // Special formatting for email errors
            errorMessages.push(
              `Please check your email:\n• ${messages.join("\n• ")}`
            );
          } else {
            errorMessages.push(...messages);
          }
        }

        throw new Error(errorMessages.join("\n"));
      } else {
        // If no specific errors, show a generic message
        throw new Error(`Please check your input and try again`);
      }
    }
    // For non-Zod errors, throw a generic message
    throw new Error(
      `Input validation failed. Please check your input and try again.`
    );
  }
}

// Batch validation for multiple inputs
export function validateInputs(
  validations: Array<{ schema: z.ZodSchema<any>; input: unknown; name: string }>
): Record<string, any> {
  const results: Record<string, any> = {};

  for (const { schema, input, name } of validations) {
    try {
      results[name] = validateInput(schema, input);
    } catch (error) {
      throw new Error(
        `Validation failed for ${name}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

// Server action wrapper with validation
export function withValidation<T extends Record<string, any>, R>(
  validationSchema: z.ZodObject<{ [K in keyof T]: z.ZodType<T[K]> }>,
  action: (validatedInput: T) => Promise<R>
) {
  return async (input: T): Promise<R> => {
    const validated = validateInput(validationSchema, input) as T;
    return await action(validated);
  };
}

// Form data validation
export function validateFormData(formData: FormData, schema: z.ZodSchema): any {
  const data: Record<string, any> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      data[key] = sanitizeString(value);
    } else {
      data[key] = value; // File or other type
    }
  }

  return validateInput(schema, data);
}

// Safe JSON parsing
export function safeJsonParse<T>(input: string, schema: z.ZodSchema<T>): T {
  try {
    const parsed = JSON.parse(input);
    return validateInput(schema, parsed);
  } catch {
    throw new Error("Invalid JSON or failed validation");
  }
}

// Content Security Policy violation reporting
export function validateCSPReport(report: unknown): boolean {
  try {
    const cspReportSchema = z.object({
      "csp-report": z.object({
        "document-uri": z.string(),
        referrer: z.string().optional(),
        "violated-directive": z.string(),
        "effective-directive": z.string(),
        "original-policy": z.string(),
        disposition: z.string(),
        "blocked-uri": z.string(),
        "line-number": z.number().optional(),
        "column-number": z.number().optional(),
        "source-file": z.string().optional(),
      }),
    });

    cspReportSchema.parse(report);
    return true;
  } catch {
    return false;
  }
}
