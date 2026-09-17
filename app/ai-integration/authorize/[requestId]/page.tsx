import Link from "next/link";
import { AlertTriangle, Bot, Eye, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_NAME } from "@/lib/company";
import {
  isEntitledToMcp,
  MCP_NOT_ENTITLED_MESSAGE,
} from "@/lib/mcp/entitlement";
import { getClient, getPendingAuthorizationRequest } from "@/lib/mcp/store";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import ConsentForm from "./ConsentForm";

/**
 * The OAuth consent screen.
 *
 * This is a normal protected route, which is the whole trick: the routing
 * middleware has already required a signed-in session and an AAL2 (TOTP)
 * session before this component runs, so the "sign in with your email and
 * password, then your two-factor code" step in the setup instructions is
 * handled by the app's existing auth, not by anything this integration
 * reimplements.
 *
 * It renders outside the AI Integration page's own layout on purpose: someone
 * arriving here has been sent by a program, and the page's one job is to make
 * clear what is being asked and by whom before they approve it.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  // Next 16: dynamic route params arrive as a Promise.
  params: Promise<{ requestId: string }>;
}

/** A dead end that still explains itself — never a bare error. */
function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-500" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            <Link
              href="/ai-integration"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to AI Integration
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function AuthorizePage({ params }: PageProps) {
  const { requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware would already have bounced an anonymous visitor; this is the
  // independent check, because a layout-level guarantee is not authorization.
  if (!user) {
    return (
      <Problem
        title="Sign in required"
        body="Sign in to this application first, then run the authentication step in your AI client again."
      />
    );
  }

  if (!isEntitledToMcp(user)) {
    return <Problem title="Not allowed" body={MCP_NOT_ENTITLED_MESSAGE} />;
  }

  const pending = await getPendingAuthorizationRequest(requestId);
  if (!pending) {
    // Unknown, expired and already-used are all reported identically — telling
    // them apart would confirm an id to whoever is guessing.
    return (
      <Problem
        title="This request is no longer valid"
        body="Authorization requests expire after ten minutes and can only be used once. Run /mcp in your AI client and choose Authenticate again to start over."
      />
    );
  }

  const client = await getClient(pending.client_id);
  if (!client) {
    return (
      <Problem
        title="Unknown AI client"
        body="This client is not registered with this application. Check the --client-id in your setup command."
      />
    );
  }

  // What the token will actually be able to do, read from the live tool
  // registry rather than a hand-written list — a consent screen that drifts
  // from the real permissions is worse than no consent screen.
  const grantedTools = MCP_TOOLS.filter(
    (tool) => !tool.requiresAdmin || user.app_metadata?.role === "admin"
  );

  return (
    <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                Connect {client.client_name}
              </h1>
              <p className="text-sm text-muted-foreground">
                to your {COMPANY_NAME} account
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-md bg-muted/50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Signed in as
            </p>
            <p className="mt-1 text-sm font-medium break-all text-foreground">
              {user.email}
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Eye
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold text-foreground">
                It will be able to read
              </h2>
            </div>
            <ul className="mt-3 space-y-2">
              {grantedTools.map((tool) => (
                <li
                  key={tool.name}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span>{tool.title}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-border px-4 py-3">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground">
              This connection is read-only — it cannot change or delete
              anything. You can disconnect it at any time from the AI
              Integration page.
            </p>
          </div>

          <ConsentForm requestId={requestId} clientName={client.client_name} />
        </div>
      </div>
    </div>
  );
}
