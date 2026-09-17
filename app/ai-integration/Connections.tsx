"use client";

import { useState } from "react";
import { Bot, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatDate } from "@/lib/utils";
import { revokeConnection } from "./actions";
import type { ConnectionSummary } from "@/lib/mcp/store";

/**
 * The list of AI clients currently connected to this account, with a way to
 * cut each one off.
 *
 * Revoking is destructive and cannot be undone (the client must go through
 * consent again), so it goes through a styled confirmation dialog — never a
 * bare button and never `window.confirm`, per `.claude/rules/ui.md`.
 *
 * The list is seeded from the server render and kept in local state afterwards,
 * so a successful revoke removes the row immediately rather than waiting for a
 * refresh.
 */
/** A read failure, stated plainly and kept next to the list it affects. */
function LoadError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-3 rounded-md bg-red-600 px-4 py-3 text-sm font-medium text-white"
    >
      {message}
    </div>
  );
}

export default function Connections({
  initialConnections,
  loadError,
}: {
  initialConnections: ConnectionSummary[];
  /**
   * Set when the list could not be read. Shown ABOVE the list, never instead
   * of it — a failed read rendered as "no clients connected" would tell the
   * user something false about their own security posture.
   */
  loadError?: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [confirming, setConfirming] = useState<ConnectionSummary | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmRevoke = async () => {
    if (!confirming) return;

    setRevoking(true);
    setError(null);

    const result = await revokeConnection(confirming.grantId);

    if (result.success) {
      setConnections((current) =>
        current.filter((c) => c.grantId !== confirming.grantId)
      );
      setConfirming(null);
    } else {
      setError(result.error ?? "Could not disconnect that client.");
    }

    setRevoking(false);
  };

  if (connections.length === 0) {
    return (
      <>
        {loadError && <LoadError message={loadError} />}
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No AI clients connected</EmptyTitle>
            <EmptyDescription>
              Follow the steps above to connect one. It will appear here once it
              has signed in.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {loadError && <LoadError message={loadError} />}
      <ul className="space-y-2">
        {connections.map((connection) => (
          <li
            key={connection.grantId}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {connection.displayName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Connected {formatDate(connection.connectedAt)} · Last used{" "}
                {connection.lastUsedAt
                  ? formatDate(connection.lastUsedAt)
                  : "never"}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => {
                setError(null);
                setConfirming(connection);
              }}
            >
              <Unplug className="h-4 w-4" aria-hidden="true" />
              Disconnect
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          // Don't let the dialog be dismissed mid-request — the row would
          // disappear or not, with nothing on screen explaining which.
          if (!open && !revoking) {
            setConfirming(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect this AI client?</DialogTitle>
            <DialogDescription>
              {confirming?.displayName} will lose access immediately and any
              request it is making will start failing. To reconnect it, you will
              need to run <code className="font-mono">/mcp</code> and
              authenticate again.
            </DialogDescription>
          </DialogHeader>

          {error && (
            // Solid red per .claude/rules/ui.md.
            <div
              role="alert"
              className="rounded-md bg-red-600 px-4 py-3 text-sm font-medium text-white"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={revoking}
              onClick={() => {
                setConfirming(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoking}
              onClick={confirmRevoke}
            >
              {revoking ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Disconnecting…
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
