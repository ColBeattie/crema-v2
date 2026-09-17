import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The tools this app exposes over MCP.
 *
 * ── READ-ONLY, ON PURPOSE ────────────────────────────────────────────────────
 * Nothing here writes. An MCP client is an autonomous process acting on a
 * bearer token: a mistake it makes is unattended and unreviewed, so the
 * template's default is a surface where the worst outcome is "it read
 * something". This is the layer a real project extends — see the note at the
 * bottom of this file before adding a mutating tool.
 *
 * ── EVERY TOOL RE-CHECKS THE CALLER ──────────────────────────────────────────
 * The route already verified the bearer token and the caller's entitlement, and
 * every handler still receives the resolved `User` rather than a trusted flag.
 * `requiresAdmin` is enforced by the dispatcher below on every single call, not
 * once at connection time — a token minted while its holder was an admin must
 * stop working the moment their role is taken away, and roles are read live
 * from `app_metadata` on each request for exactly that reason.
 *
 * ── WHY THE ADMIN CLIENT ─────────────────────────────────────────────────────
 * These handlers read through the service-role client because MCP requests
 * carry no Supabase session cookie — there is no user JWT for RLS to act on.
 * That makes the checks in this file the authorization boundary for MCP, so
 * each tool must scope its own query. Where a tool could be widened to
 * non-admins later, filter by `user.id` in the query itself rather than after
 * the fetch.
 */

// ── Tool context and shape ──────────────────────────────────────────────────

export interface ToolContext {
  /** The token holder, re-resolved from Supabase on this request. */
  user: User;
  /** True when `app_metadata.role === "admin"`, read live (never cached). */
  isAdmin: boolean;
}

interface ToolDefinition<Schema extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  /** Refuse the call unless the live role is admin. */
  requiresAdmin: boolean;
  handler: (input: z.infer<Schema>, ctx: ToolContext) => Promise<unknown>;
}

// The registry is heterogeneous by nature; each entry keeps its own input type
// through defineTool's generic, and only the erased form is stored in the list.
type AnyToolDefinition = ToolDefinition<z.ZodType>;

function defineTool<Schema extends z.ZodType>(
  def: ToolDefinition<Schema>
): AnyToolDefinition {
  return def;
}

/** Shared paging input — every list tool bounds its result set. */
const listInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe("How many rows to return (1-200)."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("How many rows to skip, for paging."),
};

function admin() {
  return createAdminClient();
}

/**
 * Turn a Supabase error into something safe to hand an AI client.
 *
 * PostgREST errors name tables, columns and constraints. The raw error is
 * logged server-side; the caller gets a generic sentence — an MCP response is
 * as public as an API response.
 */
function failQuery(scope: string, error: unknown): never {
  console.error(`[mcp:tool:${scope}]`, error);
  throw new Error(`Could not read ${scope}. Please try again.`);
}

// ── The tools ───────────────────────────────────────────────────────────────

const whoami = defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "Identify the account this AI client is connected as, including its role. Use this first when you are unsure what access you have.",
  inputSchema: z.object({}),
  requiresAdmin: false,
  handler: async (_input, ctx) => ({
    user_id: ctx.user.id,
    email: ctx.user.email ?? null,
    role: ctx.user.app_metadata?.role ?? "user",
    is_admin: ctx.isAdmin,
    created_at: ctx.user.created_at,
    last_sign_in_at: ctx.user.last_sign_in_at ?? null,
  }),
});

const listUsers = defineTool({
  name: "list_users",
  title: "List user accounts",
  description:
    "List the application's user accounts with their role, creation date and last sign-in. Returns account metadata only — never passwords, tokens or MFA secrets.",
  inputSchema: z.object(listInput),
  requiresAdmin: true,
  handler: async (input) => {
    // listUsers pages from 1 and takes a page size, so the offset/limit the
    // tool exposes is translated rather than passed through.
    const perPage = Math.min(input.limit, 200);
    const page = Math.floor(input.offset / perPage) + 1;

    const { data, error } = await admin().auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) failQuery("user accounts", error);

    // Deactivation lives in `profiles`, not in auth.users, so it is joined in
    // here — otherwise a deactivated account reads as active.
    const ids = data.users.map((u) => u.id);
    const { data: profiles } = await admin()
      .from("profiles")
      .select("id, deactivated_at")
      .in(
        "id",
        ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]
      );

    const deactivated = new Map(
      (profiles ?? []).map((p) => [p.id, p.deactivated_at])
    );

    return {
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        role: u.app_metadata?.role ?? "user",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed: !!u.email_confirmed_at,
        deactivated_at: deactivated.get(u.id) ?? null,
      })),
      page,
      per_page: perPage,
    };
  },
});

const getUser = defineTool({
  name: "get_user",
  title: "Get one user account",
  description:
    "Look up a single user account by id or email address. Returns account metadata only.",
  inputSchema: z
    .object({
      user_id: z.string().uuid().optional().describe("The account's UUID."),
      email: z
        .string()
        .email()
        .optional()
        .describe("The account's email address."),
    })
    .refine((v) => !!v.user_id !== !!v.email, {
      message: "Provide exactly one of user_id or email.",
    }),
  requiresAdmin: true,
  handler: async (input) => {
    let found = null;

    if (input.user_id) {
      const { data, error } = await admin().auth.admin.getUserById(
        input.user_id
      );
      // A missing user is a normal answer, not a failure — only log-and-mask
      // when there is no user AND no clear "not found".
      if (error && !data?.user) return { user: null };
      found = data?.user ?? null;
    } else {
      // The admin API has no lookup-by-email, so this pages until it matches.
      // Bounded at 10 pages so a large tenant cannot turn one tool call into an
      // unbounded scan.
      const target = input.email!.toLowerCase();
      for (let page = 1; page <= 10 && !found; page++) {
        const { data, error } = await admin().auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (error) failQuery("user accounts", error);
        found =
          data.users.find((u) => u.email?.toLowerCase() === target) ?? null;
        if (data.users.length < 200) break;
      }
    }

    if (!found) return { user: null };

    const { data: profile } = await admin()
      .from("profiles")
      .select("deactivated_at")
      .eq("id", found.id)
      .maybeSingle();

    return {
      user: {
        id: found.id,
        email: found.email ?? null,
        role: found.app_metadata?.role ?? "user",
        created_at: found.created_at,
        last_sign_in_at: found.last_sign_in_at ?? null,
        email_confirmed: !!found.email_confirmed_at,
        deactivated_at: profile?.deactivated_at ?? null,
      },
    };
  },
});

const listAuditLog = defineTool({
  name: "list_audit_log",
  title: "List audit log entries",
  description:
    "List recent entries from the administrative audit log — who did what, to whom, and when. Newest first.",
  inputSchema: z.object({
    ...listInput,
    action: z
      .string()
      .max(100)
      .optional()
      .describe("Only entries with this exact action name."),
  }),
  requiresAdmin: true,
  handler: async (input) => {
    let query = admin()
      .from("audit_logs")
      .select("id, user_id, action, target_user_id, details, created_at")
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    // A single bound .eq() is parameterised by PostgREST — safe. Never build
    // an .or()/.filter() string out of user input here (see security.md).
    if (input.action) query = query.eq("action", input.action);

    const { data, error } = await query;
    if (error) failQuery("the audit log", error);

    return { entries: data ?? [] };
  },
});

const listLoginAttempts = defineTool({
  name: "list_login_attempts",
  title: "List login attempts",
  description:
    "List recent sign-in attempts with their outcome, IP address and location. Useful for investigating lockouts and suspicious activity.",
  inputSchema: z.object({
    ...listInput,
    email: z
      .string()
      .email()
      .optional()
      .describe("Only attempts for this email address."),
    only_failures: z
      .boolean()
      .default(false)
      .describe("Return only failed attempts."),
  }),
  requiresAdmin: true,
  handler: async (input) => {
    let query = admin()
      .from("login_attempt")
      .select(
        "id, email, ip_address, country, city, success, failure_reason, mfa_used, created_at"
      )
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    if (input.email) query = query.eq("email", input.email.toLowerCase());
    if (input.only_failures) query = query.eq("success", false);

    const { data, error } = await query;
    if (error) failQuery("login attempts", error);

    return { attempts: data ?? [] };
  },
});

const getSettings = defineTool({
  name: "get_settings",
  title: "Get application settings",
  description:
    "Read the application's configuration settings (key/value), such as the MFA requirement.",
  inputSchema: z.object({
    key: z
      .string()
      .max(100)
      .optional()
      .describe("Return only this setting key."),
  }),
  requiresAdmin: true,
  handler: async (input) => {
    let query = admin()
      .from("setting")
      .select("key, value, updated_at")
      .order("key");

    if (input.key) query = query.eq("key", input.key);

    const { data, error } = await query;
    if (error) failQuery("settings", error);

    return { settings: data ?? [] };
  },
});

/**
 * The registry.
 *
 * ── ADDING A TOOL ────────────────────────────────────────────────────────────
 * Add it here; `tools/list` and `tools/call` pick it up automatically. Give it
 * a description an AI will read literally — say what it returns AND what it
 * does not, because that description is the only guidance the model gets.
 *
 * ── ADDING A TOOL THAT WRITES ────────────────────────────────────────────────
 * Before you do: this server issues one coarse scope (`mcp:read`), so a
 * mutating tool added here becomes available to every token already in the
 * wild on the next deploy. Introduce a second scope, require it on the tool,
 * and make existing clients re-consent — do not widen `mcp:read`. Audit-log
 * every write with the acting user's id, exactly as the admin server actions
 * do, and ask the user before shipping it.
 */
export const MCP_TOOLS: AnyToolDefinition[] = [
  whoami,
  listUsers,
  getUser,
  listAuditLog,
  listLoginAttempts,
  getSettings,
];

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * The tool list as MCP describes it, filtered to what this caller may use.
 *
 * A tool the caller cannot call is not advertised: listing it would have the
 * model plan around a call that then fails, which wastes a turn and reads as a
 * broken integration.
 */
export function listToolsFor(ctx: ToolContext) {
  return MCP_TOOLS.filter((tool) => !tool.requiresAdmin || ctx.isAdmin).map(
    (tool) => {
      const schema = z.toJSONSchema(tool.inputSchema, {
        target: "draft-7",
        io: "input",
      }) as Record<string, unknown>;
      // The $schema key is noise inside an MCP inputSchema; clients want the
      // bare object schema.
      delete schema.$schema;

      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: schema,
      };
    }
  );
}

export class ToolNotFoundError extends Error {}
export class ToolForbiddenError extends Error {}
export class ToolInputError extends Error {}

/**
 * Run one tool call.
 *
 * Order matters: existence, then permission, then input validation. Validating
 * first would let a non-admin probe the shape of a tool they cannot call.
 */
export async function callTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<unknown> {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolNotFoundError(`Unknown tool: ${name}`);

  if (tool.requiresAdmin && !ctx.isAdmin) {
    throw new ToolForbiddenError(
      `The "${name}" tool requires an administrator account.`
    );
  }

  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    // Annotated because the registry is `ToolDefinition<any>`, which erases
    // the inferred issue type through safeParse.
    const detail = parsed.error.issues
      .map((issue: z.ZodIssue) =>
        issue.path.length > 0
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message
      )
      .join("; ");
    throw new ToolInputError(`Invalid arguments for "${name}". ${detail}`);
  }

  return tool.handler(parsed.data, ctx);
}
