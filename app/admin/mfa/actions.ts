"use server";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/app/admin/audit/actions";

export async function logMfaStatusChange(enabled: boolean) {
  const supabase = await createClient();

  try {
    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized: User not found");
    }

    // Create audit log entry
    const action = enabled ? "enable_mfa" : "disable_mfa";
    await createAuditLog(action, user.id);

    return { success: true };
  } catch (error) {
    console.error("Error logging MFA status change:", error);
    return { success: false, error: "Failed to log MFA status change" };
  }
}

// Admin function to log MFA changes for other users
export async function logMfaStatusChangeForUser(
  userId: string,
  userEmail: string,
  enabled: boolean
) {
  const supabase = await createClient();

  try {
    // Check if user is admin
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    // Create audit log entry
    const action = enabled ? "enable_mfa" : "disable_mfa";
    await createAuditLog(action, userId);

    return { success: true };
  } catch (error) {
    console.error("Error logging MFA status change for user:", error);
    return { success: false, error: "Failed to log MFA status change" };
  }
}
