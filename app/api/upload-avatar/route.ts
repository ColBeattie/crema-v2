import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeErrorMessage } from "@/lib/error-handling";
import { rateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";
import {
  applySecurityHeaders,
  getEnvironmentSecurityConfig,
} from "@/lib/security-headers";
import { ValidationSchemas } from "@/lib/input-validation";

// Helper function to create secure error responses
function createSecureErrorResponse(
  error: string,
  status: number = 400
): Response {
  const response = NextResponse.json({ error }, { status });
  return applySecurityHeaders(response, getEnvironmentSecurityConfig());
}

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = rateLimit(
      "file-upload",
      RATE_LIMIT_CONFIGS.FILE_UPLOAD
    )(request);
    if (!rateLimitResult.allowed) {
      const response = createSecureErrorResponse(
        "Too many upload attempts. Please try again later.",
        429
      );

      // Add rate limit headers
      Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    }

    // Get the current authenticated user
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return createSecureErrorResponse("Unauthorized", 401);
    }

    // Check if user is admin from app_metadata (only admins can upload for others)
    if (user.app_metadata?.role !== "admin") {
      return createSecureErrorResponse("Admin access required", 403);
    }

    // Create admin client for storage operations (secure server-only)
    const adminClient = createAdminClient();

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const targetUserId = formData.get("targetUserId") as string;

    if (!file || !targetUserId) {
      return createSecureErrorResponse("File and target user ID required");
    }

    // Validate targetUserId is a UUID — prevents path traversal in filePath
    // (e.g. "../other-folder") since this is interpolated into a storage key
    // and the admin client bypasses RLS.
    const userIdCheck = ValidationSchemas.userId.safeParse(targetUserId);
    if (!userIdCheck.success) {
      return createSecureErrorResponse("Invalid target user ID");
    }
    const safeTargetUserId = userIdCheck.data;

    // Security validations for file upload

    // 1. File size validation (limit to 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
      return createSecureErrorResponse("File size exceeds 5MB limit");
    }

    // 2. File type validation - only allow image files
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (!allowedMimeTypes.includes(file.type)) {
      return createSecureErrorResponse(
        "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed."
      );
    }

    // 3. File extension validation (defense in depth)
    const fileExt = file.name.split(".").pop()?.toLowerCase();
    const allowedExtensions = ["jpg", "jpeg", "png", "gif", "webp"];

    if (!fileExt || !allowedExtensions.includes(fileExt)) {
      return createSecureErrorResponse(
        "Invalid file extension. Only .jpg, .jpeg, .png, .gif, and .webp files are allowed."
      );
    }

    // 4. Content verification - check file header/magic bytes
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    const isValidImageFile = (bytes: Uint8Array): boolean => {
      // JPEG magic bytes: FF D8 FF
      if (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      ) {
        return true;
      }
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      ) {
        return true;
      }
      // GIF magic bytes: 47 49 46 38 (GIF8)
      if (
        bytes.length >= 4 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38
      ) {
        return true;
      }
      // WebP magic bytes: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
      if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      ) {
        return true;
      }
      return false;
    };

    if (!isValidImageFile(uint8Array)) {
      return createSecureErrorResponse(
        "File content does not match expected image format"
      );
    }

    // 5. Filename sanitization - use only safe characters
    const timestamp = Date.now();
    const sanitizedFileName = `avatar-${timestamp}.${fileExt}`;
    const filePath = `${safeTargetUserId}/${sanitizedFileName}`;

    // Defense-in-depth: reject any path-traversal sequences before handing the
    // key to Supabase Storage, even though targetUserId is a validated UUID
    // and fileExt is an allowlisted extension.
    if (filePath.includes("..") || filePath.includes("\\")) {
      return createSecureErrorResponse("Invalid file path");
    }

    // Upload using admin client to bypass RLS (use buffer since we've already read it)
    const { error: uploadError } = await adminClient.storage
      .from("profiles")
      .upload(filePath, buffer, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = adminClient.storage.from("profiles").getPublicUrl(filePath);

    const cacheBustedUrl = `${publicUrl}?t=${timestamp}`;

    // Record successful upload for rate limiting
    rateLimitResult.recordSuccess();

    const response = NextResponse.json({
      success: true,
      avatarUrl: cacheBustedUrl,
    });

    return applySecurityHeaders(response, getEnvironmentSecurityConfig());
  } catch (error: any) {
    console.error("Error uploading avatar:", error);
    Sentry.captureException(error, { tags: { route: "upload-avatar" } });
    const response = NextResponse.json(
      {
        error: sanitizeErrorMessage(error),
      },
      { status: 500 }
    );

    return applySecurityHeaders(response, getEnvironmentSecurityConfig());
  }
}
