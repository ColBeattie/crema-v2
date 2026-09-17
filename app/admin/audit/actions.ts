"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  target_user_id: string | null;
  details: any;
  created_at: string;
  formatted_message?: string;
  formatted_details?: string; // Additional formatted details for changes
  user_email?: string; // Will be fetched from auth.users
  target_email?: string; // Will be fetched from auth.users
}

// Function to create an audit log entry
export async function createAuditLog(
  action: string,
  targetUserId?: string | null,
  details?: any
) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  try {
    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // When called from server actions with admin client, user might not be available
      // Log this but don't throw - the action might be legitimate
      console.warn("createAuditLog: No authenticated user found");
      return;
    }

    // Insert audit log using admin client (bypasses RLS)
    const { error } = await adminClient.from("audit_logs").insert({
      user_id: user.id,
      action,
      target_user_id: targetUserId || null,
      details: details || null,
    });

    if (error) {
      console.error("Error creating audit log:", error);
      // Don't throw - audit log failure shouldn't break the main operation
    }
  } catch (error) {
    console.error("Error in createAuditLog:", error);
    // Don't throw - audit log failure shouldn't break the main operation
  }
}

// Function to fetch audit logs
export async function getAuditLogs(page: number = 1, limit: number = 20) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Check if user is admin
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required");
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    // Fetch audit logs
    const {
      data: logs,
      error,
      count,
    } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    // Get unique user IDs (both performers and targets) to fetch their emails
    const allUserIds = [
      ...new Set([
        ...(logs?.map((log) => log.user_id) || []),
        ...(logs?.map((log) => log.target_user_id).filter((id) => id) || []),
      ]),
    ];

    // Fetch user emails from auth.users for all relevant users
    const {
      data: { users },
    } = await adminClient.auth.admin.listUsers();
    const userMap = new Map(
      users
        ?.filter((u) => allUserIds.includes(u.id))
        .map((u) => [u.id, u.email]) || []
    );

    // Format the messages with user emails
    const formattedLogs =
      logs?.map((log) => {
        const userEmail = userMap.get(log.user_id) || "unknown user";
        const targetEmail = log.target_user_id
          ? userMap.get(log.target_user_id) || "unknown user"
          : null;
        let formatted_message = "";
        let formatted_details = "";

        switch (log.action) {
          case "create_user":
            formatted_message = `${userEmail} created user ${targetEmail || "unknown"}`;
            if (log.details?.first_name || log.details?.last_name) {
              formatted_details = `Name: ${[log.details.first_name, log.details.last_name].filter(Boolean).join(" ")}, Role: ${log.details.role || "user"}`;
            } else if (log.details?.full_name) {
              formatted_details = `Name: ${log.details.full_name}, Role: ${log.details.role || "user"}`;
            }
            break;
          case "update_user":
            formatted_message = `${userEmail} updated ${targetEmail || "unknown"}`;
            if (log.details?.old_name && log.details?.new_name) {
              formatted_details = `Name changed from "${log.details.old_name}" to "${log.details.new_name}"`;
            }
            break;
          case "invite_user": {
            const inviteName = [log.details?.first_name, log.details?.last_name]
              .filter(Boolean)
              .join(" ");
            const inviteTarget = inviteName
              ? `${inviteName} (${targetEmail || "unknown"})`
              : targetEmail || "unknown";
            formatted_message = `${userEmail} invited ${inviteTarget}`;
            if (log.details?.role) {
              formatted_details = `Role: ${log.details.role}`;
            }
            break;
          }
          case "delete_user": {
            // User no longer exists in auth, so use stored details
            const deletedName = log.details?.deleted_name;
            const deletedEmail =
              log.details?.deleted_email || targetEmail || "unknown";
            const deleteTarget = deletedName
              ? `${deletedName} (${deletedEmail})`
              : deletedEmail;
            formatted_message = `${userEmail} deleted user ${deleteTarget}`;
            break;
          }
          case "deactivate_user": {
            const name = log.details?.target_name;
            const email = log.details?.target_email || targetEmail || "unknown";
            const target = name ? `${name} (${email})` : email;
            formatted_message = `${userEmail} deactivated user ${target}`;
            break;
          }
          case "reactivate_user": {
            const name = log.details?.target_name;
            const email = log.details?.target_email || targetEmail || "unknown";
            const target = name ? `${name} (${email})` : email;
            formatted_message = `${userEmail} reactivated user ${target}`;
            break;
          }
          case "change_role":
            formatted_message = `${userEmail} updated ${targetEmail || "unknown"}`;
            formatted_details = `Role changed from "${log.details?.old_role || "unknown"}" to "${log.details?.new_role || "unknown"}"`;
            break;
          case "reset_password":
            formatted_message = `${userEmail} sent password reset email to ${targetEmail || "unknown"}`;
            break;
          case "reset_mfa":
            formatted_message = `${userEmail} reset MFA for ${targetEmail || "unknown"}`;
            break;
          case "enable_mfa":
            formatted_message = `${targetEmail || userEmail || "unknown"} enabled multi-factor authentication`;
            break;
          case "disable_mfa":
            formatted_message = `${targetEmail || userEmail || "unknown"} disabled multi-factor authentication`;
            break;
          case "update_company_name":
            formatted_message = `${userEmail} updated company settings`;
            formatted_details = `Company name changed from "${log.details?.old_name || "unknown"}" to "${log.details?.new_name || "unknown"}"`;
            break;
          case "update_company_logo":
            formatted_message = `${userEmail} updated the company logo`;
            break;
          case "update_mfa_requirement":
            formatted_message = `${userEmail} updated the MFA requirement setting`;
            if (log.details?.old_value && log.details?.new_value) {
              const formatValue = (v: string) =>
                v === "all_users" ? "All Users" : "Admins Only";
              formatted_details = `Changed from "${formatValue(log.details.old_value)}" to "${formatValue(log.details.new_value)}"`;
            }
            break;
          default:
            formatted_message = `${userEmail} performed action: ${log.action}`;
        }

        return {
          ...log,
          user_email: userEmail,
          target_email: targetEmail,
          formatted_message,
          formatted_details,
        };
      }) || [];

    return {
      logs: formattedLogs as AuditLog[],
      totalCount: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      currentPage: page,
    };
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    throw new Error("Failed to fetch audit logs");
  }
}
