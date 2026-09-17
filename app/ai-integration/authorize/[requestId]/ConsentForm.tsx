"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveAuthorization, denyAuthorization } from "../actions";

/**
 * Approve / cancel, and the hop back to the AI client.
 *
 * The server action returns the callback URL instead of redirecting, so the
 * cross-origin navigation happens here where it is visible. `window.location`
 * rather than the router: the target is a loopback HTTP server on the user's
 * own machine, not a route in this app.
 */
export default function ConsentForm({
  requestId,
  clientName,
}: {
  requestId: string;
  clientName: string;
}) {
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    action: "approve" | "deny",
    fn: () => Promise<{ redirectUrl?: string; error?: string }>
  ) => {
    setPending(action);
    setError(null);

    const result = await fn();

    if (result.redirectUrl) {
      // Leave `pending` set: the button stays disabled and spinning while the
      // browser navigates away, so a slow hop can't be double-submitted.
      window.location.assign(result.redirectUrl);
      return;
    }

    setError(result.error ?? "Something went wrong. Please try again.");
    setPending(null);
  };

  return (
    <div className="space-y-3">
      {error && (
        // Solid red per .claude/rules/ui.md — an error here means the user is
        // stuck, and a pale tint would let them miss it.
        <div
          role="alert"
          className="rounded-md bg-red-600 px-4 py-3 text-sm font-medium text-white"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:flex-1"
          disabled={pending !== null}
          onClick={() => run("deny", () => denyAuthorization(requestId))}
        >
          {pending === "deny" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Cancelling…
            </>
          ) : (
            "Cancel"
          )}
        </Button>

        <Button
          type="button"
          className="w-full sm:flex-1"
          disabled={pending !== null}
          onClick={() => run("approve", () => approveAuthorization(requestId))}
        >
          {pending === "approve" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Connecting…
            </>
          ) : (
            `Allow ${clientName}`
          )}
        </Button>
      </div>
    </div>
  );
}
