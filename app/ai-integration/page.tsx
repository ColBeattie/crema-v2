import { headers } from "next/headers";
import type { Metadata } from "next";
import { AlertTriangle, Bot, Check, Info, Sparkles, X } from "lucide-react";
import { COMPANY_NAME } from "@/lib/company";
import {
  buildAddCommand,
  MCP_PATH,
  MCP_SERVER_SLUG,
  MCP_SETUP_OWNER,
} from "@/lib/mcp/config";
import { MCP_NOT_ENTITLED_MESSAGE } from "@/lib/mcp/entitlement";
import { getBaseUrlFromHeaders } from "@/lib/mcp/url";
import { getMcpPageState } from "./actions";
import CommandBlock from "./CommandBlock";
import Connections from "./Connections";

/**
 * The AI Integration page — how a user connects Claude (or any MCP client) to
 * this application.
 *
 * A server component, because everything on it is server-derived: whether the
 * Supabase migration has been run, the caller's entitlement, and this
 * deployment's own origin (so the setup command is correct on localhost, on a
 * preview URL and in production without anyone editing it).
 *
 * Access is gated three times over, which is intentional rather than
 * redundant: the routing middleware treats `/ai-integration` as an admin
 * route, this page re-checks entitlement, and every server action checks again
 * because it is directly callable.
 */

export const metadata: Metadata = {
  title: `AI Integration · ${COMPANY_NAME}`,
};

export const dynamic = "force-dynamic";

/** One numbered step in the setup instructions. */
function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-11">
      {/* Decorative: the step's position is already conveyed by the ordered
          list, so the number must not be announced twice. */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
      >
        {number}
      </span>
      <h3 className="pt-1 text-base font-semibold text-foreground">{title}</h3>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  );
}

export default async function AiIntegrationPage() {
  const [state, headerBag] = await Promise.all([getMcpPageState(), headers()]);

  if (!state.entitled) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-bold text-foreground">AI Integration</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {MCP_NOT_ENTITLED_MESSAGE}
          </p>
        </div>
      </div>
    );
  }

  // Falls back to a readable placeholder rather than a broken command: an
  // origin we could not determine must not be printed as `undefined/api/mcp`
  // and pasted into a terminal.
  const baseUrl =
    getBaseUrlFromHeaders(headerBag) ?? "https://your-deployment-url";
  const command = buildAddCommand(baseUrl);

  /**
   * Prompts that map one-to-one onto the tools in `lib/mcp/tools.ts`. Written
   * as things a person would actually type, not as tool names — someone
   * checking a fresh connection needs a sentence to paste, not an API
   * reference.
   */
  const examples = [
    `Which account am I connected to on ${COMPANY_NAME}?`,
    "List the user accounts and tell me which ones are admins.",
    "Show me the last 20 audit log entries and summarise what changed.",
    "Were there any failed sign-in attempts this week?",
    "What is the MFA requirement set to right now?",
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              AI Integration (MCP)
            </h1>
            <p className="text-sm text-muted-foreground">
              Connect your AI client such as Claude to the {COMPANY_NAME}{" "}
              platform.
            </p>
          </div>
        </div>
      </header>

      {/* ── Setup / status banner ──────────────────────────────────────────
          Always present, and it says one of two things.

          The loud version matters because until this deployment's database has
          been provisioned, none of the steps below work — and a page that
          walks you through four of them without saying so wastes an afternoon.

          It is written for the person actually reading it: an administrator of
          THIS APP, who has no Supabase project and no repository. Telling them
          to run a migration would be an instruction they cannot act on, so the
          copy names who does it and gives them the one thing they can do — ask.
          See MCP_SETUP_OWNER in lib/mcp/config.ts. */}
      {state.ready ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Check
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-500"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Ready to connect
              </p>
              <p className="text-sm text-muted-foreground">
                This integration is switched on for {COMPANY_NAME}, so you can
                follow the steps below. The default setup lets administrators{" "}
                <strong className="font-medium text-foreground">
                  read basic information
                </strong>{" "}
                only — accounts, the audit log, sign-in attempts and settings.
                Nothing can be changed or deleted. If you need it to do more,
                ask {MCP_SETUP_OWNER} to expand what it can access.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-5 dark:border-amber-500/70 dark:bg-amber-950/40">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600 dark:text-amber-500"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <h2 className="text-base font-bold text-amber-900 dark:text-amber-100">
                Not switched on yet — {MCP_SETUP_OWNER} needs to enable this
              </h2>
              <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                Before any of this works, the integration has to be enabled in{" "}
                {COMPANY_NAME}&apos;s Supabase database. That is done by{" "}
                {MCP_SETUP_OWNER}, or by a team member with Supabase access —
                there is nothing to switch on from this page.
              </p>
              <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                <strong className="font-semibold">To get it enabled:</strong>{" "}
                use <em>Help &amp; support</em> in the menu under your profile
                picture and ask for the AI integration to be turned on. You are
                welcome to read the steps below in the meantime — they will run,
                but the sign-in step will fail until it is enabled.
              </p>
              {state.setupReason && (
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Status: {state.setupReason}
                </p>
              )}
              <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                Once it is on, the default setup lets administrators{" "}
                <strong className="font-semibold">
                  read basic information
                </strong>{" "}
                only — accounts, the audit log, sign-in attempts and settings.
                Nothing can be changed or deleted. These permissions can be
                expanded, so mention it when you ask if you need more.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Setup steps ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Connect your AI client
        </h2>

        <ol className="mt-5 space-y-7">
          <Step number={1} title="Open Claude Code and ask it to run this">
            <p>
              Open Claude Code in a terminal, paste the command below, and tell
              Claude to run it.
            </p>
            <CommandBlock command={command} />
          </Step>

          <Step number={2} title="Close Claude Code and reopen it">
            <p>
              Servers are picked up when a session starts, so the one you just
              added will not appear until you restart. Quit Claude Code
              completely and open it again before the next step.
            </p>
          </Step>

          <Step number={3} title="Sign in">
            <p>
              In a Claude Code session run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                /mcp
              </code>
              , pick{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {MCP_SERVER_SLUG}
              </code>{" "}
              and choose Authenticate.
            </p>
            <p>
              A browser opens on {COMPANY_NAME}. Sign in with your usual email
              and password, enter your two-factor code, then approve the consent
              screen. Tokens are stored and refreshed for you, so this is once
              per machine.
            </p>
          </Step>

          <Step number={4} title="Check it works">
            <p>Ask any of these:</p>
            <ul className="space-y-2">
              {examples.map((example) => (
                <li
                  key={example}
                  className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
                >
                  “{example}”
                </li>
              ))}
            </ul>
          </Step>
        </ol>
      </section>

      {/* ── Capabilities ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground">
          What it can do
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Check
                className="h-4 w-4 text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold text-foreground">It can</h3>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Tell you which account it is connected as, and its role</li>
              <li>
                List user accounts with their role, sign-up date and last
                sign-in
              </li>
              <li>Look up a single account by email address or id</li>
              <li>Read the administrative audit log, filtered by action</li>
              <li>
                Read sign-in attempts, including failures, IP address and
                location
              </li>
              <li>Read application settings, such as the MFA requirement</li>
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <X
                className="h-4 w-4 text-red-600 dark:text-red-500"
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold text-foreground">
                It cannot
              </h3>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                Change anything — there are no create, update or delete tools
              </li>
              <li>Create users, change roles, or reset passwords or MFA</li>
              <li>Read passwords, MFA secrets, session tokens or passkeys</li>
              <li>Read or write files in Supabase Storage</li>
              <li>Send email or trigger any notification</li>
              <li>
                Act for anyone but you — it holds your access, not the
                app&apos;s
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4">
          <Info
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            Only administrators can connect an AI client. Every request is
            re-checked against your live account, so removing someone&apos;s
            admin role or deactivating them cuts their AI client off
            immediately. The endpoint is{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              {baseUrl}
              {MCP_PATH}
            </code>
            .
          </p>
        </div>
      </section>

      {/* ── Connected clients ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">
            Your connected clients
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Each machine you authenticate from appears here. Disconnecting revokes
          its access immediately.
        </p>
        <div className="mt-4">
          <Connections
            initialConnections={state.connections}
            loadError={state.connectionsError}
          />
        </div>
      </section>
    </div>
  );
}
