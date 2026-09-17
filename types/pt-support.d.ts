/**
 * Global type for the Productivity Tools Support SDK, which attaches itself to
 * `window` once `support-sdk.js` has loaded.
 *
 * Optional on purpose: the SDK may legitimately not be there yet (deferred
 * script, blocked by CSP, no installation key). Call sites must check for it
 * explicitly and tell the user — never `window.PTSupport?.open()`, which turns
 * a diagnosable failure into a button that silently does nothing.
 */

export {};

declare global {
  interface PTSupportOpenOptions {
    type?: "bug" | "list";
    /**
     * Business context for the record the user is looking at. Identifiers and
     * names ONLY — never personal data, financial figures, credentials or
     * tokens.
     */
    context?: {
      entityType?: string;
      entityId?: string;
      entityName?: string;
      [key: string]: unknown;
    };
  }

  /**
   * Payload of the `badge` event: how many support requests are waiting on
   * THIS user — work we handed back for them to check, plus questions we are
   * waiting on an answer to. Nothing we are still working on is counted, so
   * every number is something only they can move.
   *
   * `enabled: false` means the support platform has the badge switched off for
   * this installation; treat it as "no badge", not as zero.
   */
  interface PTSupportBadgePayload {
    count?: number;
    enabled?: boolean;
  }

  interface PTSupportApi {
    open: (options?: PTSupportOpenOptions) => void;
    configure?: (config: { installationKey: string; tokenUrl: string }) => void;
    /**
     * Subscribe to an SDK event. `badge` fires whenever the count changes,
     * including when it drops to zero — that is what clears the badge, so
     * always render from it rather than reacting only to non-zero values.
     */
    on?: (
      event: "badge",
      handler: (payload: PTSupportBadgePayload) => void
    ) => void;
    /** Current count, or `null` if nothing is known yet. Never poll this. */
    getActionCount?: () => number | null;
    /**
     * Force a re-check. The count is cached per browser tab for an hour, so
     * this is required when the signed-in user changes — otherwise a second
     * person on a shared machine briefly sees the first person's number.
     */
    refreshActionCount?: () => void;
  }

  interface Window {
    PTSupport?: PTSupportApi;
  }
}
