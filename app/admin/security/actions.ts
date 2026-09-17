"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SecurityAlert {
  id: string;
  type:
    | "password_age"
    | "weak_password"
    | "no_mfa"
    | "inactive_user"
    | "multiple_failed_logins"
    | "admin_without_mfa";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  userId: string;
  userEmail: string;
  userName?: string;
  details?: any;
  createdAt: string;
}

export interface SecuritySummary {
  totalUsers: number;
  usersWithMfa: number;
  usersWithoutMfa: number;
  adminUsersWithoutMfa: number;
  usersWithOldPasswords: number;
  inactiveUsers: number;
  alerts: SecurityAlert[];
}

async function checkIsAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;
  return user.app_metadata?.role === "admin";
}

// Helper function to check password age (approximated by last password change or user creation)
function getPasswordAge(user: any): number {
  // Use last_sign_in_at as proxy for password activity, fallback to created_at
  const lastActivity = user.last_sign_in_at || user.created_at;
  const lastDate = new Date(lastActivity);
  const now = new Date();
  const ageInDays = Math.floor(
    (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  return ageInDays;
}

// Helper function to check if password is potentially weak (basic heuristics)
function isWeakPassword(user: any): boolean {
  // We can't actually see the password, but we can check for patterns
  // This is a placeholder - in real implementation you might check:
  // - Password was set a very long time ago (might be from older, weaker policies)
  // - User has never changed their password
  // - Account was created with a temporary password

  // For demo purposes, we'll flag users created more than 1 year ago who never signed in
  if (!user.last_sign_in_at) {
    const createdAt = new Date(user.created_at);
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    return createdAt < yearAgo;
  }

  return false;
}

// Helper function to check if user is inactive
function isInactiveUser(user: any): boolean {
  if (!user.last_sign_in_at) {
    // Never signed in and account is older than 30 days
    const createdAt = new Date(user.created_at);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return createdAt < thirtyDaysAgo;
  }

  // Last sign in was more than 90 days ago
  const lastSignIn = new Date(user.last_sign_in_at);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  return lastSignIn < ninetyDaysAgo;
}

export async function getSecurityAnalysis(): Promise<SecuritySummary> {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  const adminClient = createAdminClient();

  try {
    // Get all users with their MFA status
    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers();
    if (error) throw error;

    const alerts: SecurityAlert[] = [];
    let usersWithMfa = 0;
    let usersWithoutMfa = 0;
    let adminUsersWithoutMfa = 0;
    let usersWithOldPasswords = 0;
    let inactiveUsers = 0;

    for (const user of users || []) {
      const userRole = user.app_metadata?.role || "user";
      const userName = [
        user.user_metadata?.first_name,
        user.user_metadata?.last_name,
      ]
        .filter(Boolean)
        .join(" ");

      // listUsers() does not include MFA factors — fetch each user individually
      let hasMfa = false;
      try {
        const {
          data: { user: detailedUser },
        } = await adminClient.auth.admin.getUserById(user.id);
        if (detailedUser?.factors) {
          hasMfa = detailedUser.factors.some(
            (factor: any) =>
              factor.factor_type === "totp" && factor.status === "verified"
          );
        }
      } catch {
        // Fall back to listUsers() factors (usually empty)
        hasMfa =
          user.factors?.some(
            (factor: any) =>
              factor.factor_type === "totp" && factor.status === "verified"
          ) || false;
      }

      // Count MFA stats
      if (hasMfa) {
        usersWithMfa++;
      } else {
        usersWithoutMfa++;

        // High priority: Admin without MFA
        if (userRole === "admin") {
          adminUsersWithoutMfa++;
          const displayName = userName
            ? `${userName} (${user.email})`
            : user.email || "Unknown user";
          alerts.push({
            id: `admin_no_mfa_${user.id}`,
            type: "admin_without_mfa",
            severity: "critical",
            title: "Admin Account Without MFA",
            description: `Admin user ${displayName} does not have multi-factor authentication enabled.`,
            userId: user.id,
            userEmail: user.email || "",
            userName,
            createdAt: new Date().toISOString(),
          });
        } else {
          // Medium priority: Regular user without MFA
          const displayName = userName
            ? `${userName} (${user.email})`
            : user.email || "Unknown user";
          alerts.push({
            id: `no_mfa_${user.id}`,
            type: "no_mfa",
            severity: "medium",
            title: "User Without MFA",
            description: `${displayName} has not enabled multi-factor authentication.`,
            userId: user.id,
            userEmail: user.email || "",
            userName,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Check password age
      const passwordAge = getPasswordAge(user);
      if (passwordAge > 180) {
        // 6 months
        usersWithOldPasswords++;
        const severity =
          passwordAge > 365 ? "high" : passwordAge > 270 ? "medium" : "low";
        const displayName = userName
          ? `${userName} (${user.email})`
          : user.email || "Unknown user";
        alerts.push({
          id: `old_password_${user.id}`,
          type: "password_age",
          severity,
          title: "Old Password",
          description: `${displayName} hasn't changed their password in ${Math.floor(passwordAge / 30)} months.`,
          userId: user.id,
          userEmail: user.email || "",
          userName,
          details: { ageInDays: passwordAge },
          createdAt: new Date().toISOString(),
        });
      }

      // Check for weak passwords
      if (isWeakPassword(user)) {
        const displayName = userName
          ? `${userName} (${user.email})`
          : user.email || "Unknown user";
        alerts.push({
          id: `weak_password_${user.id}`,
          type: "weak_password",
          severity: "high",
          title: "Potentially Weak Password",
          description: `${displayName} may have a weak password that should be updated.`,
          userId: user.id,
          userEmail: user.email || "",
          userName,
          createdAt: new Date().toISOString(),
        });
      }

      // Check for inactive users
      if (isInactiveUser(user)) {
        inactiveUsers++;
        const displayName = userName
          ? `${userName} (${user.email})`
          : user.email || "Unknown user";
        alerts.push({
          id: `inactive_user_${user.id}`,
          type: "inactive_user",
          severity: "low",
          title: "Inactive User Account",
          description: `${displayName} hasn't signed in recently and may be an unused account.`,
          userId: user.id,
          userEmail: user.email || "",
          userName,
          details: {
            lastSignIn: user.last_sign_in_at,
            neverSignedIn: !user.last_sign_in_at,
          },
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Sort alerts by severity (critical -> high -> medium -> low)
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    alerts.sort(
      (a, b) => severityOrder[b.severity] - severityOrder[a.severity]
    );

    return {
      totalUsers: users?.length || 0,
      usersWithMfa,
      usersWithoutMfa,
      adminUsersWithoutMfa,
      usersWithOldPasswords,
      inactiveUsers,
      alerts: alerts.slice(0, 50), // Limit to 50 most important alerts
    };
  } catch (error) {
    console.error("Error analyzing security:", error);
    throw new Error("Failed to analyze security");
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function dismissSecurityAlert(alertId: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  // In a real implementation, you would store dismissed alerts in the database
  // For now, we'll just return success
  return { success: true };
}

export async function resolveSecurityAlert(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  alertId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  action: string
) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  // In a real implementation, you might:
  // - Force password reset for password-related alerts
  // - Send MFA setup instructions for MFA alerts
  // - Disable inactive accounts

  return { success: true };
}
