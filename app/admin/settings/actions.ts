"use server";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/app/admin/audit/actions";
import { checkIsAdmin } from "@/app/admin/users/actions";

export type MfaRequirement = "all_users" | "admins_only";

const VALID_MFA_REQUIREMENTS: MfaRequirement[] = ["all_users", "admins_only"];

export async function getMfaRequirement(): Promise<MfaRequirement> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("setting")
    .select("value")
    .eq("key", "mfa_requirement")
    .single();

  if (error || !data) {
    // Default to all_users if not set
    return "all_users";
  }

  const value = data.value as string;
  return VALID_MFA_REQUIREMENTS.includes(value as MfaRequirement)
    ? (value as MfaRequirement)
    : "all_users";
}

export async function updateMfaRequirement(value: MfaRequirement) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  if (!VALID_MFA_REQUIREMENTS.includes(value)) {
    return { success: false, error: "Invalid MFA requirement value" };
  }

  const supabase = await createClient();

  // Get current value for audit log
  const currentValue = await getMfaRequirement();

  const { error } = await supabase.from("setting").upsert(
    {
      key: "mfa_requirement",
      value: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("Error updating MFA requirement:", error);
    return { success: false, error: "Failed to update MFA requirement" };
  }

  // Create audit log
  await createAuditLog("update_mfa_requirement", null, {
    old_value: currentValue,
    new_value: value,
  });

  return { success: true };
}
