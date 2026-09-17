import type { User } from "@supabase/supabase-js";

/**
 * Who may connect an AI client to this app over MCP.
 *
 * ── THE DECISION, AND WHY IT IS WRITTEN DOWN HERE ────────────────────────────
 * Admins only. An MCP connection is a long-lived, unattended bearer token that
 * reads app data on the holder's behalf, and the tools this template ships
 * (`lib/mcp/tools.ts`) read the account list, the audit log and login attempts
 * — administrative data. Granting that to every authenticated user would hand
 * an ordinary user a read-only view of everyone else's account activity.
 *
 * This mirrors `isEntitledToSupport()` in `app/api/support-token/route.ts`:
 * one function, one decision, checked server-side on every path that matters.
 *
 * ── ADDING A NEW ROLE? ASK FIRST ─────────────────────────────────────────────
 * Roles enter the app through the `z.enum(["user", "admin"])` schemas in
 * `app/admin/users/actions.ts`. A new role added there inherits whatever this
 * function returns — today `false` for anything that is not `admin`, which is
 * the safe direction, but a role named `owner` or `superadmin` is exactly the
 * case where someone "fixes" this function without thinking it through.
 *
 * Before adding a role to this check, ASK THE USER whether that role may
 * connect an AI client, and record the answer in this comment. Do not infer it
 * from the role's name. Nothing errors and no test fails if you get it wrong,
 * which is why it needs a question rather than a guess.
 *
 * ── WIDENING IT LATER ────────────────────────────────────────────────────────
 * If this app grows tools that are safe for ordinary users (their own records,
 * their own tasks), the right move is NOT to loosen this function — it is to
 * gate each tool on the caller's role in `lib/mcp/tools.ts` and then widen
 * here. The scope granted to a token is coarse; the tools are where per-role
 * filtering belongs.
 */
export function isEntitledToMcp(user: User | null | undefined): boolean {
  if (!user) return false;

  // Role comes from app_metadata (server-controlled). NEVER user_metadata,
  // which the account holder can edit and would make this trivially bypassable.
  return user.app_metadata?.role === "admin";
}

/** What to tell someone who is signed in but not entitled. */
export const MCP_NOT_ENTITLED_MESSAGE =
  "Your account is not allowed to connect an AI client. Ask an administrator if you need access.";
