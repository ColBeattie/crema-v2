"use server";

import { cookies } from "next/headers";
import { AUTH_FLOW_COOKIE, type AuthFlow } from "@/lib/supabase/auth-flow";

/**
 * Read the server-set, httpOnly auth-flow marker cookie.
 *
 * The cookie is httpOnly (so the client can't tamper with the middleware gate),
 * which means client pages can't read it directly. They call this server action
 * instead to learn whether the current session came from a recovery/invite
 * email. This is a read-only hint for UI; it cannot be used to bypass anything.
 */
export async function getAuthFlow(): Promise<AuthFlow | null> {
  const store = await cookies();
  const value = store.get(AUTH_FLOW_COOKIE)?.value;
  return value === "recovery" || value === "invite" ? value : null;
}

/**
 * Clear the auth-flow marker once the recovery/invite flow is complete (the
 * user has set their new password). Must run server-side because the cookie is
 * httpOnly.
 */
export async function clearAuthFlow(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_FLOW_COOKIE);
}
