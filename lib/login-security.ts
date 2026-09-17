/**
 * Login security service for tracking login attempts, detecting suspicious activity,
 * and managing security alerts and known IPs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/postmark";
import { sanitizeHTML } from "@/lib/input-validation";

// ── Types ───────────────────────────────────────────────────

export interface LoginAttemptRecord {
  id: string;
  user_id: string | null;
  email: string;
  ip_address: string;
  user_agent: string | null;
  country: string | null;
  city: string | null;
  success: boolean;
  failure_reason: string | null;
  mfa_used: boolean;
  created_at: string;
}

export interface SecurityAlertRecord {
  id: string;
  user_id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
}

export interface UserKnownIpRecord {
  id: string;
  user_id: string;
  ip_address: string;
  country: string | null;
  city: string | null;
  trusted: boolean;
  login_count: number;
  first_seen_at: string;
  last_seen_at: string;
  trusted_by: string | null;
  trusted_at: string | null;
}

export interface RecordLoginAttemptParams {
  email: string;
  userId?: string | null;
  ipAddress: string;
  userAgent?: string | null;
  country?: string | null;
  city?: string | null;
  success: boolean;
  failureReason?: string | null;
  mfaUsed?: boolean;
}

// ── Thresholds ──────────────────────────────────────────────

const FAILED_ATTEMPTS_THRESHOLD = 5;
const FAILED_ATTEMPTS_WINDOW_MINUTES = 15;

// ── Service ─────────────────────────────────────────────────

/**
 * Record a login attempt and trigger security checks.
 */
export async function recordLoginAttempt(
  params: RecordLoginAttemptParams
): Promise<void> {
  const adminClient = createAdminClient();

  try {
    // 1. Insert the login attempt
    const { error: insertError } = await adminClient
      .from("login_attempt")
      .insert({
        user_id: params.userId || null,
        email: params.email,
        ip_address: params.ipAddress,
        user_agent: params.userAgent || null,
        country: params.country || null,
        city: params.city || null,
        success: params.success,
        failure_reason: params.failureReason || null,
        mfa_used: params.mfaUsed || false,
      });

    if (insertError) {
      console.error(
        "[LoginSecurity] Failed to insert login attempt:",
        insertError
      );
      return;
    }

    // 2. Update or create known IP record (only for identified users)
    if (params.userId) {
      await upsertKnownIp(adminClient, params);
    }

    // 3. Run security checks
    // Failed attempt threshold runs for ALL failed attempts (email-based, no userId needed)
    await checkFailedAttemptThreshold(adminClient, params);

    if (params.userId) {
      await checkNewIp(adminClient, params);
      await checkNewCountry(adminClient, params);
    }
  } catch (error: unknown) {
    console.error("[LoginSecurity] Error recording login attempt:", error);
  }
}

/**
 * Upsert a known IP for the user - increment login count or create new.
 */
async function upsertKnownIp(
  adminClient: ReturnType<typeof createAdminClient>,
  params: RecordLoginAttemptParams
): Promise<void> {
  if (!params.userId) return;

  const { data: existing } = await adminClient
    .from("user_known_ip")
    .select("id, login_count")
    .eq("user_id", params.userId)
    .eq("ip_address", params.ipAddress)
    .single();

  if (existing) {
    await adminClient
      .from("user_known_ip")
      .update({
        login_count: existing.login_count + 1,
        last_seen_at: new Date().toISOString(),
        country: params.country || undefined,
        city: params.city || undefined,
      })
      .eq("id", existing.id);
  } else {
    await adminClient.from("user_known_ip").insert({
      user_id: params.userId,
      ip_address: params.ipAddress,
      country: params.country || null,
      city: params.city || null,
      trusted: false,
      login_count: 1,
    });
  }
}

/**
 * Check if a user has exceeded the failed attempts threshold and raise a
 * security alert (email to admins). Works with or without userId — uses email
 * for the alert and for dedup.
 */
async function checkFailedAttemptThreshold(
  adminClient: ReturnType<typeof createAdminClient>,
  params: RecordLoginAttemptParams
): Promise<void> {
  if (params.success) return;

  const windowStart = new Date(
    Date.now() - FAILED_ATTEMPTS_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count } = await adminClient
    .from("login_attempt")
    .select("*", { count: "exact", head: true })
    .eq("email", params.email)
    .eq("success", false)
    .gte("created_at", windowStart);

  if (count && count >= FAILED_ATTEMPTS_THRESHOLD) {
    // Check if we already have a recent alert for this email
    let existingAlertQuery = adminClient
      .from("security_alert")
      .select("id")
      .eq("alert_type", "failed_login_threshold")
      .gte("created_at", windowStart)
      .limit(1);

    if (params.userId) {
      existingAlertQuery = existingAlertQuery.eq("user_id", params.userId);
    } else {
      // When no userId, check via metadata email match
      existingAlertQuery = existingAlertQuery.contains("metadata", {
        email: params.email,
      });
    }

    const { data: existingAlert } = await existingAlertQuery.single();

    if (!existingAlert) {
      await createSecurityAlert(adminClient, {
        userId: params.userId || null,
        alertType: "failed_login_threshold",
        severity: "high",
        title: "Multiple Failed Login Attempts",
        description: `${count} failed login attempts for ${params.email} in the last ${FAILED_ATTEMPTS_WINDOW_MINUTES} minutes from IP ${params.ipAddress}.`,
        metadata: {
          email: params.email,
          ipAddress: params.ipAddress,
          failedCount: count,
          windowMinutes: FAILED_ATTEMPTS_WINDOW_MINUTES,
        },
      });
    }
  }
}

/**
 * Check if this is a new IP for the user and create an alert.
 */
async function checkNewIp(
  adminClient: ReturnType<typeof createAdminClient>,
  params: RecordLoginAttemptParams
): Promise<void> {
  if (!params.success || !params.userId) return;

  const { data: knownIp } = await adminClient
    .from("user_known_ip")
    .select("id, login_count")
    .eq("user_id", params.userId)
    .eq("ip_address", params.ipAddress)
    .single();

  // If login_count is 1, this is a brand new IP (just inserted above)
  if (knownIp && knownIp.login_count === 1) {
    await createSecurityAlert(adminClient, {
      userId: params.userId,
      alertType: "new_ip",
      severity: "medium",
      title: "Login from New IP Address",
      description: `${params.email} logged in from a new IP address: ${params.ipAddress}${params.city ? ` (${params.city}${params.country ? ", " + params.country : ""})` : ""}.`,
      metadata: {
        email: params.email,
        ipAddress: params.ipAddress,
        country: params.country,
        city: params.city,
      },
    });
  }
}

/**
 * Check if this is a new country for the user and create an alert.
 */
async function checkNewCountry(
  adminClient: ReturnType<typeof createAdminClient>,
  params: RecordLoginAttemptParams
): Promise<void> {
  if (!params.success || !params.userId || !params.country) return;

  const { data: knownCountries } = await adminClient
    .from("user_known_ip")
    .select("country")
    .eq("user_id", params.userId)
    .not("country", "is", null);

  const countries = new Set(
    (knownCountries || []).map((r) => r.country).filter(Boolean)
  );

  // If the only entry with this country is the one we just created (count = 1 unique country entry)
  // We need to check if this country existed before this login
  if (countries.size > 1) {
    // Check if this country was seen before by looking at older records
    const { data: olderWithCountry } = await adminClient
      .from("user_known_ip")
      .select("id")
      .eq("user_id", params.userId)
      .eq("country", params.country)
      .neq("ip_address", params.ipAddress)
      .limit(1);

    if (!olderWithCountry || olderWithCountry.length === 0) {
      // Also check if the current IP record has login_count > 1 (i.e., country was already known via this IP)
      const { data: currentIp } = await adminClient
        .from("user_known_ip")
        .select("login_count")
        .eq("user_id", params.userId)
        .eq("ip_address", params.ipAddress)
        .single();

      if (currentIp && currentIp.login_count === 1) {
        await createSecurityAlert(adminClient, {
          userId: params.userId,
          alertType: "new_country",
          severity: "high",
          title: "Login from New Country",
          description: `${params.email} logged in from a new country: ${params.country}${params.city ? ` (${params.city})` : ""}.`,
          metadata: {
            email: params.email,
            ipAddress: params.ipAddress,
            country: params.country,
            city: params.city,
          },
        });
      }
    }
  }
}

// ── Alert Creation ──────────────────────────────────────────

interface CreateAlertParams {
  userId: string | null;
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
}

async function createSecurityAlert(
  adminClient: ReturnType<typeof createAdminClient>,
  params: CreateAlertParams
): Promise<void> {
  // Only insert to DB if we have a userId (security_alert.user_id is NOT NULL)
  if (params.userId) {
    const { error } = await adminClient.from("security_alert").insert({
      user_id: params.userId,
      alert_type: params.alertType,
      severity: params.severity,
      title: params.title,
      description: params.description,
      metadata: params.metadata || {},
    });

    if (error) {
      console.error("[LoginSecurity] Failed to create security alert:", error);
    }
  }

  // Send email notification for high/critical alerts (even without userId)
  if (params.severity === "high" || params.severity === "critical") {
    await notifyAdmins(adminClient, params);
  }
}

/**
 * Send email notifications to all admin users for high/critical alerts.
 */
async function notifyAdmins(
  adminClient: ReturnType<typeof createAdminClient>,
  alert: CreateAlertParams
): Promise<void> {
  try {
    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers();
    if (error || !users) return;

    const admins = users.filter((u) => u.app_metadata?.role === "admin");

    for (const admin of admins) {
      if (!admin.email) continue;

      const firstName = admin.user_metadata?.first_name || "Admin";

      const safeTitle = sanitizeHTML(alert.title);
      const safeSeverity = sanitizeHTML(alert.severity);
      const safeDescription = sanitizeHTML(alert.description);
      const safeFirstName = sanitizeHTML(firstName);

      await sendEmail({
        to: admin.email,
        subject: `[${alert.severity.toUpperCase()}] Security Alert: ${alert.title}`,
        htmlBody: `
          <h2>Security Alert</h2>
          <p>Hi ${safeFirstName},</p>
          <p>A <strong>${safeSeverity}</strong> security alert has been triggered:</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; font-weight: bold;">Type:</td><td style="padding: 8px;">${safeTitle}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Severity:</td><td style="padding: 8px;">${safeSeverity}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Details:</td><td style="padding: 8px;">${safeDescription}</td></tr>
          </table>
          <p>Please review this alert in the Security Dashboard.</p>
        `,
        textBody: `Security Alert: ${alert.title}\nSeverity: ${alert.severity}\nDetails: ${alert.description}`,
      });
    }
  } catch (error: unknown) {
    console.error("[LoginSecurity] Failed to notify admins:", error);
  }
}

// ── Admin Query Functions ───────────────────────────────────

/**
 * Get security alerts with optional filters.
 */
export async function getSecurityAlerts(options?: {
  severity?: string;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ alerts: SecurityAlertRecord[]; total: number }> {
  const adminClient = createAdminClient();
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let query = adminClient
    .from("security_alert")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.severity) {
    query = query.eq("severity", options.severity);
  }

  if (options?.acknowledged === true) {
    query = query.not("acknowledged_at", "is", null);
  } else if (options?.acknowledged === false) {
    query = query.is("acknowledged_at", null);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("[LoginSecurity] Failed to get security alerts:", error);
    return { alerts: [], total: 0 };
  }

  return { alerts: (data || []) as SecurityAlertRecord[], total: count || 0 };
}

/**
 * Acknowledge a security alert.
 */
export async function acknowledgeAlert(
  alertId: string,
  adminUserId: string
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("security_alert")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: adminUserId,
    })
    .eq("id", alertId);

  if (error) {
    console.error("[LoginSecurity] Failed to acknowledge alert:", error);
    return { success: false, error: "Failed to acknowledge alert" };
  }

  return { success: true };
}

/**
 * Get login attempts with optional filters.
 */
export async function getLoginAttempts(options?: {
  userId?: string;
  email?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ attempts: LoginAttemptRecord[]; total: number }> {
  const adminClient = createAdminClient();
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let query = adminClient
    .from("login_attempt")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  if (options?.email) {
    query = query.ilike("email", `%${options.email}%`);
  }

  if (options?.success !== undefined) {
    query = query.eq("success", options.success);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("[LoginSecurity] Failed to get login attempts:", error);
    return { attempts: [], total: 0 };
  }

  return { attempts: (data || []) as LoginAttemptRecord[], total: count || 0 };
}

/**
 * Get known IPs, optionally filtered by user.
 */
export async function getUserKnownIps(options?: {
  userId?: string;
  trusted?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ ips: UserKnownIpRecord[]; total: number }> {
  const adminClient = createAdminClient();
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let query = adminClient
    .from("user_known_ip")
    .select("*", { count: "exact" })
    .order("last_seen_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  if (options?.trusted !== undefined) {
    query = query.eq("trusted", options.trusted);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("[LoginSecurity] Failed to get known IPs:", error);
    return { ips: [], total: 0 };
  }

  return { ips: (data || []) as UserKnownIpRecord[], total: count || 0 };
}

/**
 * Trust an IP address.
 */
export async function trustIp(
  ipId: string,
  adminUserId: string
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("user_known_ip")
    .update({
      trusted: true,
      trusted_by: adminUserId,
      trusted_at: new Date().toISOString(),
    })
    .eq("id", ipId);

  if (error) {
    console.error("[LoginSecurity] Failed to trust IP:", error);
    return { success: false, error: "Failed to trust IP" };
  }

  return { success: true };
}

/**
 * Untrust an IP address.
 */
export async function untrustIp(
  ipId: string
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("user_known_ip")
    .update({
      trusted: false,
      trusted_by: null,
      trusted_at: null,
    })
    .eq("id", ipId);

  if (error) {
    console.error("[LoginSecurity] Failed to untrust IP:", error);
    return { success: false, error: "Failed to untrust IP" };
  }

  return { success: true };
}
