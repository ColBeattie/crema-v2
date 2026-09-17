"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createAuditLog } from "@/app/admin/audit/actions";
import { handleSecureError } from "@/lib/error-handling";
import {
  validateInput,
  ValidationSchemas,
  sanitizeString,
} from "@/lib/input-validation";
import { z } from "zod";
import { sendEmail } from "@/lib/email/postmark";
import { sanitizeHTML } from "@/lib/input-validation";
import { assertRateLimit, RATE_LIMIT_CONFIGS } from "@/lib/rate-limiting";

// Validation schemas for admin actions
//
// ⚠️ ADDING A ROLE HERE? ASK FIRST WHETHER IT MAY SUBMIT SUPPORT TICKETS.
//
// `role` is the app's authorization vocabulary, and these three `z.enum`s are
// where a new one enters it. Every new role silently inherits whatever
// `isEntitledToSupport()` in `app/api/support-token/route.ts` currently
// returns — which by default is `true` for any authenticated user. So adding
// e.g. "contractor" or "client" here hands that role read access to the whole
// support inbox for this application (every bug report colleagues have filed,
// not just their own) without anyone deciding that it should.
//
// The failure is silent and grant-shaped: nothing errors, no test breaks, the
// new role just quietly gains access. So do NOT infer the answer from the role
// name — stop and ask the user "should <role> be able to raise support
// tickets?", then encode the answer in `isEntitledToSupport()` and record it in
// that function's comment. See `/documentation/support-widget.md`.
//
// Keep all three enums below in sync when a role is added.
const CreateUserSchema = z.object({
  email: ValidationSchemas.email,
  password: ValidationSchemas.password,
  firstName: ValidationSchemas.firstName,
  lastName: ValidationSchemas.lastName,
  role: z.enum(["user", "admin"]),
});

const InviteUserSchema = z.object({
  email: ValidationSchemas.email,
  firstName: ValidationSchemas.firstName,
  lastName: ValidationSchemas.lastName,
  role: z.enum(["user", "admin"]),
});

const UpdateUserSchema = z.object({
  userId: ValidationSchemas.userId,
  firstName: ValidationSchemas.firstName.optional(),
  lastName: ValidationSchemas.lastName.optional(),
  role: z.enum(["user", "admin"]).optional(),
});

export async function checkIsAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  // Check role from app_metadata (secure, server-controlled)
  return user.app_metadata?.role === "admin";
}

/**
 * Return the authenticated caller's user id (server-derived), or null. Used by
 * the UI to hide self-targeting actions like deactivation. Authorization is
 * still enforced server-side in each action — this is only a UX hint.
 */
export async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Throttle a mutating/email-sending admin action, keyed on the acting admin's
 * user id, so a single compromised admin session can't flood email/user-create
 * APIs. Best-effort (in-memory) — see lib/rate-limiting.ts storage caveat.
 */
async function assertAdminRateLimit(actionKey: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await assertRateLimit(
    user?.id ?? "unknown-admin",
    actionKey,
    RATE_LIMIT_CONFIGS.ADMIN_OPERATIONS
  );
}

/**
 * Return the set of user ids that are currently deactivated, derived from
 * profiles.deactivated_at (the app-level source of truth for deactivation).
 */
async function getDeactivatedUserIds(
  adminClient: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await adminClient
    .from("profiles")
    .select("id")
    .in("id", userIds)
    .not("deactivated_at", "is", null);
  return new Set((data || []).map((row) => row.id as string));
}

export async function getUsers() {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  const adminClient = createAdminClient();

  try {
    // Fetch all users in a single large page so the client can filter by
    // active/deactivated status and search, then paginate locally.
    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers({ perPage: 1000 });

    if (error) throw error;

    const allUsers = users || [];

    // Get profiles for additional app data (not roles anymore)
    const userIds = allUsers.map((u) => u.id);
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, created_at, updated_at, deactivated_at")
      .in("id", userIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

    // Combine user data with roles from app_metadata, MFA and active status
    const usersWithRoles = await Promise.all(
      allUsers.map(async (user) => {
        // Get detailed user info including MFA factors
        let hasMfa = false;

        // Passkeys are NOT MFA factors, so they need a separate lookup.
        // Run it alongside the user fetch rather than after it, so adding
        // this column doesn't double the wall-clock time of the list.
        const [detailedResult, passkeyResult] = await Promise.allSettled([
          adminClient.auth.admin.getUserById(user.id),
          adminClient.auth.admin.passkey.listPasskeys({ userId: user.id }),
        ]);

        if (detailedResult.status === "fulfilled") {
          const detailedUser = detailedResult.value.data?.user;
          // Check if user has verified TOTP factors
          if (detailedUser?.factors) {
            hasMfa = detailedUser.factors.some(
              (factor: any) =>
                factor.factor_type === "totp" && factor.status === "verified"
            );
          }
        } else {
          console.error(
            `Error fetching MFA status for user ${user.id}:`,
            detailedResult.reason
          );
          // Fall back to checking if factors exist on the original user object
          hasMfa =
            user.factors?.some(
              (factor: any) =>
                factor.factor_type === "totp" && factor.status === "verified"
            ) || false;
        }

        // A project with passkeys switched off in the Supabase dashboard
        // errors here for every user — report zero rather than breaking the
        // whole user list over an optional feature.
        const passkeyCount =
          passkeyResult.status === "fulfilled" && !passkeyResult.value.error
            ? (passkeyResult.value.data?.length ?? 0)
            : 0;

        return {
          id: user.id,
          email: user.email || "",
          first_name: user.user_metadata?.first_name || "",
          last_name: user.user_metadata?.last_name || "",
          role: user.app_metadata?.role || "user", // Get role from app_metadata
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          mfa_enabled: hasMfa,
          passkey_count: passkeyCount,
          is_active: !profileMap.get(user.id)?.deactivated_at,
          profile: profileMap.get(user.id), // Additional profile data if needed
        };
      })
    );

    return { users: usersWithRoles };
  } catch (error) {
    console.error("Error fetching users:", error);
    throw new Error("Failed to fetch users");
  }
}

export async function createUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  role: string = "user"
) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:createUser");

  try {
    // Validate and sanitize input
    const validatedInput = validateInput(CreateUserSchema, {
      email,
      password,
      firstName: sanitizeString(firstName),
      lastName: sanitizeString(lastName),
      role,
    });

    const adminClient = createAdminClient();
    // Create user with admin client, set role in app_metadata
    const { data: user, error: createError } =
      await adminClient.auth.admin.createUser({
        email: validatedInput.email,
        password: validatedInput.password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          first_name: validatedInput.firstName,
          last_name: validatedInput.lastName,
          must_change_password: true,
        },
        app_metadata: { role: validatedInput.role }, // Set role in app_metadata (secure)
      });

    if (createError) {
      // Check for duplicate user error
      if (
        createError.message?.toLowerCase().includes("already") ||
        createError.message?.toLowerCase().includes("duplicate") ||
        createError.message?.toLowerCase().includes("exists")
      ) {
        return {
          success: false,
          error: "A user with this email address already exists.",
        };
      }
      throw createError;
    }

    // Create profile entry (without role, just for app data) - use upsert to handle existing profiles
    if (user) {
      const { error: profileError } = await adminClient.from("profiles").upsert(
        {
          id: user.user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (profileError) {
        console.error("Error creating profile:", profileError);
      }

      // Create audit log
      await createAuditLog("create_user", user.user.id, {
        first_name: validatedInput.firstName,
        last_name: validatedInput.lastName,
        role: validatedInput.role,
      });
    }

    revalidatePath("/admin/users");
    return { success: true, user };
  } catch (error: any) {
    // Check for duplicate user error (code 23505 or message patterns)
    if (
      error?.code === "23505" ||
      error?.message?.toLowerCase()?.includes("already") ||
      error?.message?.toLowerCase()?.includes("duplicate")
    ) {
      return {
        success: false,
        error: "A user with this email address already exists.",
      };
    }

    // Check if this is a validation error (these should be shown to users)
    if (
      error instanceof Error &&
      (error.message.includes("Please") ||
        error.message.includes("must") ||
        error.message.includes("can only") ||
        error.message.includes("requirements"))
    ) {
      // Return the validation error as-is, it's already formatted
      return { success: false, error: error.message };
    }

    return handleSecureError(error, "createUser");
  }
}

export async function inviteUser(
  email: string,
  firstName: string,
  lastName: string,
  role: string = "user"
) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:inviteUser");

  try {
    const validatedInput = validateInput(InviteUserSchema, {
      email,
      firstName: sanitizeString(firstName),
      lastName: sanitizeString(lastName),
      role,
    });

    const adminClient = createAdminClient();

    // Use inviteUserByEmail which sends a magic link / invite email
    //
    // The invite template (setup/email-templates/2-invite-user.html) builds its
    // own link to /auth/confirm?...&type=invite&next=/auth/set-password, so this
    // redirectTo is NOT what the recipient follows — it only applies if that
    // template is ever reverted to {{ .ConfirmationURL }}. Kept pointing at the
    // same destination so the two can't disagree about where an invite lands.
    const { data: user, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(validatedInput.email, {
        data: {
          first_name: validatedInput.firstName,
          last_name: validatedInput.lastName,
        },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=/auth/set-password`,
      });

    if (inviteError) {
      if (inviteError.message.includes("rate limit")) {
        return {
          success: false,
          error:
            "Email rate limit reached. Please wait a few minutes and try again.",
          errorDetail:
            "Supabase\u0027s built-in email provider can only send a few emails per hour. To remove this limit, connect a custom SMTP provider in Supabase under Project Settings \u2192 Authentication \u2192 SMTP.",
        };
      }
      // Check for duplicate user error
      if (
        inviteError.message?.toLowerCase().includes("already") ||
        inviteError.message?.toLowerCase().includes("duplicate") ||
        inviteError.message?.toLowerCase().includes("exists")
      ) {
        return {
          success: false,
          error: "A user with this email address already exists.",
        };
      }
      throw inviteError;
    }

    if (user) {
      // Set the role in app_metadata (inviteUserByEmail doesn't support app_metadata directly)
      await adminClient.auth.admin.updateUserById(user.user.id, {
        app_metadata: { role: validatedInput.role },
      });

      // Create profile entry - use upsert to handle existing profiles
      const { error: profileError } = await adminClient.from("profiles").upsert(
        {
          id: user.user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (profileError) {
        console.error("Error creating profile:", profileError);
      }

      // Create audit log
      await createAuditLog("invite_user", user.user.id, {
        first_name: validatedInput.firstName,
        last_name: validatedInput.lastName,
        role: validatedInput.role,
      });
    }

    revalidatePath("/admin/users");
    return { success: true, user };
  } catch (error: any) {
    // Check for duplicate user error
    if (
      error?.code === "23505" ||
      error?.message?.toLowerCase()?.includes("already") ||
      error?.message?.toLowerCase()?.includes("duplicate")
    ) {
      return {
        success: false,
        error: "A user with this email address already exists.",
      };
    }

    if (
      error instanceof Error &&
      (error.message.includes("Please") ||
        error.message.includes("must") ||
        error.message.includes("can only") ||
        error.message.includes("requirements"))
    ) {
      return { success: false, error: error.message };
    }

    return handleSecureError(error, "inviteUser");
  }
}

export async function updateUser(
  userId: string,
  updates: { firstName?: string; lastName?: string; role?: string }
) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  try {
    // Validate and sanitize input
    const validatedInput = validateInput(UpdateUserSchema, {
      userId,
      firstName: updates.firstName
        ? sanitizeString(updates.firstName)
        : undefined,
      lastName: updates.lastName ? sanitizeString(updates.lastName) : undefined,
      role: updates.role,
    });

    const adminClient = createAdminClient();
    // First get current user data to track changes
    const {
      data: { user: currentUser },
      error: getUserError,
    } = await adminClient.auth.admin.getUserById(validatedInput.userId);
    if (getUserError) throw getUserError;

    const updateData: any = {};
    let roleChanged = false;
    const oldFirstName = currentUser?.user_metadata?.first_name;
    const oldLastName = currentUser?.user_metadata?.last_name;

    // Update user metadata if name fields are provided
    if (validatedInput.firstName || validatedInput.lastName) {
      updateData.user_metadata = {
        ...currentUser?.user_metadata,
        ...(validatedInput.firstName && {
          first_name: validatedInput.firstName,
        }),
        ...(validatedInput.lastName && { last_name: validatedInput.lastName }),
      };
    }

    // Update role in app_metadata if role is provided
    if (validatedInput.role) {
      // Check if role is actually changing
      roleChanged = currentUser?.app_metadata?.role !== validatedInput.role;

      // Prevent demoting the last admin
      if (
        roleChanged &&
        currentUser?.app_metadata?.role === "admin" &&
        validatedInput.role === "user"
      ) {
        const {
          data: { users: allUsers },
        } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const adminCount = allUsers.filter(
          (u) => u.app_metadata?.role === "admin"
        ).length;
        if (adminCount <= 1) {
          return {
            success: false,
            error:
              "Cannot change the role of the last admin. Promote another user to admin first.",
          };
        }
      }

      updateData.app_metadata = {
        ...currentUser?.app_metadata,
        role: validatedInput.role,
      };
    }

    // Apply updates if there are any
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } =
        await adminClient.auth.admin.updateUserById(
          validatedInput.userId,
          updateData
        );
      if (updateError) throw updateError;
    }

    // If role changed, sign out all sessions for this user to force re-authentication
    if (roleChanged) {
      try {
        // Sign out the user from all sessions
        await adminClient.auth.admin.signOut(validatedInput.userId, "global");
      } catch (signOutError) {
        console.error("Error signing out user sessions:", signOutError);
        // Continue even if sign out fails
      }

      // Create audit log for role change
      await createAuditLog("change_role", validatedInput.userId, {
        old_role: currentUser?.app_metadata?.role || "user",
        new_role: validatedInput.role,
      });
    } else if (validatedInput.firstName || validatedInput.lastName) {
      // Create audit log for user update
      await createAuditLog("update_user", validatedInput.userId, {
        old_name:
          [oldFirstName, oldLastName].filter(Boolean).join(" ") || "No name",
        new_name: [
          validatedInput.firstName || oldFirstName,
          validatedInput.lastName || oldLastName,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    // Update the profiles table updated_at timestamp
    await adminClient.from("profiles").upsert({
      id: validatedInput.userId,
      updated_at: new Date().toISOString(),
    });

    revalidatePath("/admin/users");

    // Return with information about what happened
    return {
      success: true,
      roleChanged,
      message: roleChanged
        ? "Role updated successfully. The user will need to refresh their browser for the new permissions to take effect."
        : "User updated successfully.",
    };
  } catch (error: any) {
    // Check if this is a validation error (these should be shown to users)
    if (
      error instanceof Error &&
      (error.message.includes("Please") ||
        error.message.includes("must") ||
        error.message.includes("can only") ||
        error.message.includes("requirements"))
    ) {
      // Return the validation error as-is, it's already formatted
      return { success: false, error: error.message };
    }

    return handleSecureError(error, "updateUser");
  }
}

/**
 * Deactivate a user: sets profiles.deactivated_at so they can no longer sign in
 * (enforced by the login route and the routing middleware), while leaving the
 * auth user and all of their data fully intact. Reversible via reactivateUser.
 */
export async function deactivateUser(userId: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:deactivateUser");

  // Prevent deactivating yourself
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    return { success: false, error: "Cannot deactivate your own account" };
  }

  const adminClient = createAdminClient();

  try {
    const {
      data: { user: targetUser },
    } = await adminClient.auth.admin.getUserById(userId);

    if (!targetUser) {
      return { success: false, error: "User not found" };
    }

    // Prevent deactivating the last active admin, which would lock everyone out
    // of admin access. Count only admins who are currently active.
    if (targetUser.app_metadata?.role === "admin") {
      const {
        data: { users: allUsers },
      } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const adminIds =
        allUsers
          ?.filter((u) => u.app_metadata?.role === "admin")
          .map((u) => u.id) || [];
      const deactivatedAdminIds = await getDeactivatedUserIds(
        adminClient,
        adminIds
      );
      const activeAdminCount = adminIds.filter(
        (id) => !deactivatedAdminIds.has(id)
      ).length;
      if (activeAdminCount <= 1) {
        return {
          success: false,
          error:
            "Cannot deactivate the only active admin. Promote or reactivate another admin first.",
        };
      }
    }

    // Record the deactivation on the user's profile. This is the source of
    // truth: the login route refuses to authenticate a user whose profile is
    // deactivated, and the routing middleware reads it to terminate any existing
    // session on the next request.
    const nowIso = new Date().toISOString();
    const { error: deactivationError } = await adminClient
      .from("profiles")
      .upsert(
        { id: userId, deactivated_at: nowIso, updated_at: nowIso },
        { onConflict: "id" }
      );
    if (deactivationError) throw deactivationError;

    // Revoke all existing refresh tokens so the user is signed out immediately.
    try {
      await adminClient.auth.admin.signOut(userId, "global");
    } catch (signOutError) {
      console.error(
        "Error signing out deactivated user sessions:",
        signOutError
      );
      // Continue even if sign out fails — middleware still gates every request.
    }

    await createAuditLog("deactivate_user", userId, {
      target_email: targetUser.email,
      target_name:
        [
          targetUser.user_metadata?.first_name,
          targetUser.user_metadata?.last_name,
        ]
          .filter(Boolean)
          .join(" ") || null,
    });

    revalidatePath("/admin/users");
    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return handleSecureError(error, "deactivateUser");
  }
}

/**
 * Reactivate a previously deactivated user by removing their deactivation
 * record so they can sign in again.
 */
export async function reactivateUser(userId: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:reactivateUser");

  const adminClient = createAdminClient();

  try {
    const {
      data: { user: targetUser },
    } = await adminClient.auth.admin.getUserById(userId);

    if (!targetUser) {
      return { success: false, error: "User not found" };
    }

    // Clear the deactivation flag so the login route and middleware stop gating
    // them.
    const { error: deactivationError } = await adminClient
      .from("profiles")
      .update({ deactivated_at: null, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (deactivationError) throw deactivationError;

    await createAuditLog("reactivate_user", userId, {
      target_email: targetUser.email,
      target_name:
        [
          targetUser.user_metadata?.first_name,
          targetUser.user_metadata?.last_name,
        ]
          .filter(Boolean)
          .join(" ") || null,
    });

    revalidatePath("/admin/users");
    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return handleSecureError(error, "reactivateUser");
  }
}

/**
 * Permanently delete a user's auth account. Guarded so it can only be done to an
 * already-deactivated user (a deliberate two-step action).
 *
 * This removes the auth identity and the 1:1 profile row only. It does NOT
 * delete the user's records in business/content tables — to keep that guarantee,
 * define any FK from such a table to the user as ON DELETE SET NULL (not
 * CASCADE), so deleting the account orphans those rows instead of removing them.
 * (The "<table>_user_id" → SET NULL pattern, as used by login_attempt and
 * audit_logs.target_user_id here.) Audit history of actions against this user
 * survives because target_user_id is SET NULL and the email/name are stored in
 * the log details.
 */
export async function deleteUser(userId: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:deleteUser");

  // Prevent deleting yourself
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    return { success: false, error: "Cannot delete your own account" };
  }

  const adminClient = createAdminClient();

  try {
    const {
      data: { user: targetUser },
    } = await adminClient.auth.admin.getUserById(userId);
    if (!targetUser) {
      return { success: false, error: "User not found" };
    }

    // Only deactivated users can be deleted.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("deactivated_at")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.deactivated_at) {
      return {
        success: false,
        error:
          "Only deactivated users can be deleted. Deactivate the user first.",
      };
    }

    // Audit before deletion (target_user_id FK is ON DELETE SET NULL, so the
    // row survives with the email/name we store here).
    await createAuditLog("delete_user", userId, {
      deleted_email: targetUser.email,
      deleted_name:
        [
          targetUser.user_metadata?.first_name,
          targetUser.user_metadata?.last_name,
        ]
          .filter(Boolean)
          .join(" ") || null,
    });

    // Delete the auth account. The 1:1 profile row is removed with it; records
    // in other tables are intentionally left intact.
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) throw error;

    revalidatePath("/admin/users");
    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return handleSecureError(error, "deleteUser");
  }
}

export async function sendPasswordResetEmail(email: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:sendPasswordResetEmail");

  const supabase = await createClient();
  const adminClient = createAdminClient();

  try {
    // The Reset Password template (setup/email-templates/5-reset-password.html)
    // links straight to /auth/confirm with a token_hash, so this redirectTo is
    // only a fallback for a project still on the default {{ .ConfirmationURL }}
    // template. Recovery must not go through /auth/callback — see that route.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=/auth/reset-password`,
    });

    if (error) throw error;

    // Get user ID for audit log
    const { data: users } = await adminClient.auth.admin.listUsers();
    const targetUser = users?.users?.find((u) => u.email === email);

    // Create audit log
    await createAuditLog("reset_password", targetUser?.id);

    return { success: true };
  } catch (error: any) {
    return handleSecureError(error, "sendPasswordResetEmail");
  }
}

// Reset MFA for a user (admin only)
export async function resetUserMfa(userId: string, userEmail: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:resetUserMfa");

  const adminClient = createAdminClient();

  try {
    // Get user to find their MFA factors
    const {
      data: { user },
      error: getUserError,
    } = await adminClient.auth.admin.getUserById(userId);
    if (getUserError) throw getUserError;

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Check if user actually has MFA enabled
    const hasMfa =
      user.factors?.some(
        (factor: any) =>
          factor.factor_type === "totp" && factor.status === "verified"
      ) || false;

    if (!hasMfa) {
      return { success: false, error: "User does not have MFA enabled" };
    }

    // Get the admin performing the action for the notification email
    const supabase = await createClient();
    const {
      data: { user: adminUser },
    } = await supabase.auth.getUser();
    const adminName = adminUser
      ? [
          adminUser.user_metadata?.first_name,
          adminUser.user_metadata?.last_name,
        ]
          .filter(Boolean)
          .join(" ") ||
        adminUser.email ||
        "An administrator"
      : "An administrator";

    // Always derive the recipient email from the server-side user record, not
    // the client-supplied `userEmail` argument (which could be spoofed).
    const recipientEmail = user.email ?? userEmail;

    // Remove every enrolled factor via the GoTrue Admin API (preferred — no
    // dependency on a SECURITY DEFINER RPC). Fall back to the locked-down
    // service_role-only RPC if the admin API path fails.
    let mfaRemoved = false;
    try {
      for (const factor of user.factors ?? []) {
        const { error: deleteFactorError } =
          await adminClient.auth.admin.mfa.deleteFactor({
            id: factor.id,
            userId,
          });
        if (deleteFactorError) throw deleteFactorError;
      }
      mfaRemoved = true;
    } catch (adminApiError) {
      console.error(
        "Admin MFA deleteFactor failed, trying RPC fallback:",
        adminApiError
      );
      const { error: rpcError } = await adminClient.rpc(
        "delete_user_mfa_factors",
        { target_user_id: userId }
      );
      mfaRemoved = !rpcError;
    }

    if (!mfaRemoved) {
      // Last resort: flag the account so the user is forced to reset on next
      // sign-in. Does not remove MFA on its own.
      const { error: updateError } =
        await adminClient.auth.admin.updateUserById(userId, {
          app_metadata: {
            ...user.app_metadata,
            mfa_reset_requested: true,
            mfa_reset_requested_at: new Date().toISOString(),
            mfa_reset_requested_by: adminUser?.email,
          },
        });

      if (updateError) {
        console.error("Error updating user metadata:", updateError);
        return { success: false, error: "Failed to mark MFA for reset" };
      }

      await createAuditLog("reset_mfa", userId);
      await notifyUserMfaReset(recipientEmail, adminName);

      revalidatePath("/admin/users");
      revalidatePath("/settings");

      return {
        success: true,
        message: `MFA reset has been requested for ${recipientEmail}. The user must complete the reset by either:
1. Disabling MFA from their profile settings
2. Contacting support to manually remove it from the Supabase dashboard

This is a security feature to prevent unauthorized MFA removal.`,
        warning: true,
      };
    }

    // MFA successfully removed.
    await createAuditLog("reset_mfa", userId);
    await notifyUserMfaReset(recipientEmail, adminName);

    revalidatePath("/admin/users");
    revalidatePath("/settings");

    return {
      success: true,
      message: `MFA has been successfully reset for ${recipientEmail}. They will need to set it up again if they want to use two-factor authentication.`,
    };
  } catch (error: any) {
    return handleSecureError(error, "resetUserMfa");
  }
}

// Notify user that their MFA has been reset by an admin
async function notifyUserMfaReset(userEmail: string, adminName: string) {
  const safeAdmin = sanitizeHTML(adminName);
  const now = new Date();
  const timeStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  try {
    await sendEmail({
      to: userEmail,
      subject: "Your two-factor authentication has been reset",
      htmlBody: `
        <h2>Two-Factor Authentication Reset</h2>
        <p>Your two-factor authentication (MFA) has been reset by ${safeAdmin} on ${sanitizeHTML(timeStr)}.</p>
        <p>This means your authenticator app will no longer work for signing in. If MFA is required, you will be prompted to set it up again on your next login.</p>
        <p><strong>If you did not expect this change, please contact your administrator immediately.</strong></p>
      `,
      textBody: `Your two-factor authentication (MFA) has been reset by ${adminName} on ${timeStr}.\n\nThis means your authenticator app will no longer work for signing in. If MFA is required, you will be prompted to set it up again on your next login.\n\nIf you did not expect this change, please contact your administrator immediately.`,
    });
  } catch (error: unknown) {
    // Don't fail the MFA reset if the notification email fails
    console.error("Failed to send MFA reset notification email:", error);
  }
}

/**
 * Remove every passkey registered to a user (admin only).
 *
 * This is the recovery path for a lost or stolen device: the user can no longer
 * reach their own /profile to remove the passkey, so an admin revokes it for
 * them. Passkeys are not MFA factors, so `resetUserMfa` does not touch them —
 * the two actions are deliberately separate.
 *
 * Note this removes ALL of the user's passkeys — there is deliberately no
 * per-device admin revocation yet, since the recovery case is "the device is
 * gone, start over".
 */
export async function resetUserPasskeys(userId: string) {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }
  await assertAdminRateLimit("admin:resetUserPasskeys");

  const adminClient = createAdminClient();

  try {
    const validatedUserId = validateInput(ValidationSchemas.userId, userId);

    // Always resolve the account server-side; never trust a client-supplied
    // email for the notification recipient.
    const {
      data: { user },
      error: getUserError,
    } = await adminClient.auth.admin.getUserById(validatedUserId);
    if (getUserError) throw getUserError;

    if (!user) {
      return { success: false, error: "User not found" };
    }

    const { data: passkeys, error: listError } =
      await adminClient.auth.admin.passkey.listPasskeys({
        userId: validatedUserId,
      });

    if (listError) throw listError;

    if (!passkeys || passkeys.length === 0) {
      return { success: false, error: "User has no passkeys registered" };
    }

    // Get the admin performing the action for the notification email
    const supabase = await createClient();
    const {
      data: { user: adminUser },
    } = await supabase.auth.getUser();
    const adminName = adminUser
      ? [
          adminUser.user_metadata?.first_name,
          adminUser.user_metadata?.last_name,
        ]
          .filter(Boolean)
          .join(" ") ||
        adminUser.email ||
        "An administrator"
      : "An administrator";

    for (const passkey of passkeys) {
      const { error: deleteError } =
        await adminClient.auth.admin.passkey.deletePasskey({
          userId: validatedUserId,
          passkeyId: passkey.id,
        });
      if (deleteError) throw deleteError;
    }

    await createAuditLog("reset_passkeys", validatedUserId, {
      removed_count: passkeys.length,
    });

    if (user.email) {
      await notifyUserPasskeysReset(user.email, adminName, passkeys.length);
    }

    revalidatePath("/admin/users");
    revalidatePath("/settings");

    return {
      success: true,
      message: `Removed ${passkeys.length} passkey${
        passkeys.length === 1 ? "" : "s"
      } for ${user.email}. They can register a new one from their profile after signing in with their password.`,
    };
  } catch (error: any) {
    return handleSecureError(error, "resetUserPasskeys");
  }
}

// Notify user that their passkey(s) have been removed by an admin
async function notifyUserPasskeysReset(
  userEmail: string,
  adminName: string,
  removedCount: number
) {
  const safeAdmin = sanitizeHTML(adminName);
  const now = new Date();
  const timeStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const noun =
    removedCount === 1 ? "passkey has" : `${removedCount} passkeys have`;

  try {
    await sendEmail({
      to: userEmail,
      subject: "Your passkeys have been removed",
      htmlBody: `
        <h2>Passkeys Removed</h2>
        <p>Your ${sanitizeHTML(noun)} been removed by ${safeAdmin} on ${sanitizeHTML(timeStr)}.</p>
        <p>You can no longer sign in with those passkeys. Sign in with your email and password, then add a new passkey from your profile.</p>
        <p><strong>If you did not expect this change, please contact your administrator immediately.</strong></p>
      `,
      textBody: `Your ${noun} been removed by ${adminName} on ${timeStr}.\n\nYou can no longer sign in with those passkeys. Sign in with your email and password, then add a new passkey from your profile.\n\nIf you did not expect this change, please contact your administrator immediately.`,
    });
  } catch (error: unknown) {
    // Don't fail the reset if the notification email fails
    console.error("Failed to send passkey reset notification email:", error);
  }
}

// New function to refresh user token after role change
export async function refreshUserToken() {
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    return handleSecureError(error, "refreshUserToken");
  }
}
