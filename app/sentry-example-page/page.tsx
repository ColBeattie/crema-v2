"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED, SENTRY_TEST_EVENT_TAG } from "@/lib/sentry-options";

/**
 * Manual test page for the Sentry integration. The errors triggered here are
 * tagged as test events, which is the single kind of event allowed through on
 * the dev server — so you can verify reporting locally without enabling Sentry
 * for every other dev error.
 */
export default function SentryExamplePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const NOT_CONFIGURED_MESSAGE =
    "Sentry isn't configured. Set NEXT_PUBLIC_SENTRY_DSN to a real DSN in .env.local, then restart the dev server before testing.";

  async function sendClientError() {
    if (!SENTRY_ENABLED) {
      setIsError(true);
      setStatus(NOT_CONFIGURED_MESSAGE);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      throw new Error("Sentry client-side test error (deliberate)");
    } catch (error) {
      const eventId = Sentry.captureException(error, {
        tags: { [SENTRY_TEST_EVENT_TAG]: "true" },
      });
      await Sentry.flush(2000);
      setIsError(false);
      setStatus(
        `Client test error sent to Sentry${
          eventId ? ` (event ${eventId})` : ""
        }. It should appear in your Issues feed within a few seconds.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendServerError() {
    if (!SENTRY_ENABLED) {
      setIsError(true);
      setStatus(NOT_CONFIGURED_MESSAGE);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/sentry-example-error");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Request failed");
      }
      setIsError(false);
      setStatus(
        `Server test error sent to Sentry${
          data?.eventId ? ` (event ${data.eventId})` : ""
        }. It should appear in your Issues feed within a few seconds.`
      );
    } catch (error) {
      setIsError(true);
      setStatus(
        error instanceof Error
          ? error.message
          : "Failed to reach the server test endpoint."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Sentry test page
        </h1>
        <p className="text-sm text-muted-foreground">
          Trigger a deliberate error and confirm it shows up in your Sentry
          project. These test events are allowed through even on the dev server;
          all other local errors are dropped.
        </p>
      </div>

      {!SENTRY_ENABLED && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-red-600 px-4 py-3 text-sm text-white"
        >
          <p className="font-medium">
            Sentry is not configured — set this up first.
          </p>
          <p>
            <code>NEXT_PUBLIC_SENTRY_DSN</code> is missing or not a valid DSN (a
            real one looks like{" "}
            <code>
              https://&lt;key&gt;@&lt;org&gt;.ingest.sentry.io/&lt;project&gt;
            </code>
            ). Put the real value in <code>.env.local</code> and{" "}
            <strong>restart the dev server</strong> — until then events are
            discarded and the buttons below are disabled.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={sendClientError}
          disabled={busy || !SENTRY_ENABLED}
          className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Throw client-side test error
        </button>
        <button
          type="button"
          onClick={sendServerError}
          disabled={busy || !SENTRY_ENABLED}
          className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Throw server-side test error
        </button>
      </div>

      {status && (
        <div
          role="status"
          className={
            isError
              ? "rounded-md bg-red-600 px-4 py-3 text-sm text-white"
              : "rounded-md border border-border bg-card px-4 py-3 text-sm text-foreground"
          }
        >
          {status}
        </div>
      )}
    </main>
  );
}
