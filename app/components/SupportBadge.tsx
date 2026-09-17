"use client";

import { useEffect, useState } from "react";

/**
 * The "requests waiting on you" badge for the support entry point.
 *
 * The number is how many support requests are waiting on *this user*: work we
 * finished and handed back for them to check, plus questions we asked and are
 * waiting on an answer to. Requests we are still working on are not counted, so
 * every number shown is something only they can move. It falls on its own when
 * they reply or accept — there is nothing to mark as read and nothing to clear.
 *
 * The count comes from the support SDK and nowhere else. Never fetch it, never
 * derive it from our own tables, and never poll: the SDK checks at most once an
 * hour per tab, pauses while the tab is in the background, and re-checks when
 * the user closes the widget.
 */

/**
 * Dispatched on `window` by `SupportWidget` once `support-sdk.js` has run.
 *
 * Needed because the SDK loads with `afterInteractive`, i.e. *after* hydration:
 * a component that only checks `window.PTSupport` in a mount effect would find
 * nothing and never subscribe. Consumers check once, then wait for this.
 */
export const SUPPORT_SDK_READY_EVENT = "ptsupport:ready";

/**
 * Subscribe to the support action count.
 *
 * Returns `null` until the first count arrives — "not known yet", which is not
 * the same as zero and must render as no badge at all. Call this once, in the
 * component that owns the support entry points (`Sidebar`), and pass the value
 * down; a second call site means a second subscription, not a second count.
 */
export function useSupportActionCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // The SDK exposes no unsubscribe, so this guards against attaching twice
    // (the ready event firing after we already attached) and against a handler
    // outliving the component in React's dev-mode double-invoked effects.
    let attached = false;
    let live = true;

    const attach = () => {
      if (attached) return;
      const sdk = window.PTSupport;
      // `on` is absent on an SDK build without badge support: no badge, and the
      // support button keeps working exactly as before.
      if (!sdk?.on) return;
      attached = true;

      sdk.on("badge", (payload) => {
        if (!live) return;
        // `enabled: false` = the badge is switched off for this installation.
        // That is "no badge", not zero.
        if (payload?.enabled === false) {
          setCount(null);
          return;
        }
        // Render whatever arrives, including 0 — that event is what clears the
        // badge once the user has dealt with everything.
        setCount(payload?.count ?? 0);
      });
    };

    attach();
    window.addEventListener(SUPPORT_SDK_READY_EVENT, attach);
    return () => {
      live = false;
      window.removeEventListener(SUPPORT_SDK_READY_EVENT, attach);
    };
  }, []);

  return count;
}

interface SupportBadgeProps {
  /** `null` means not known yet — nothing is rendered. */
  count: number | null;
  /** Positioning/spacing for the call site (inline `ml-auto`, absolute corner…). */
  className?: string;
  /**
   * Hide from assistive tech.
   *
   * Set this where the badge only signals "the menu behind this trigger has
   * something in it" (the avatar, the hamburger). The authoritative, spoken
   * count belongs on the "Help & support" control itself, so a screen reader
   * hears it once, on the thing that acts on it — not on an unrelated Profile
   * link.
   */
  decorative?: boolean;
}

export default function SupportBadge({
  count,
  className = "",
  decorative = false,
}: SupportBadgeProps) {
  // `null` (unknown) and 0 (nothing waiting) both render nothing. A red circle
  // containing "0" is worse than no circle.
  if (count === null || count <= 0) return null;

  const label =
    count === 1
      ? "1 support request needs your attention"
      : `${count} support requests need your attention`;

  return (
    <span
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-card ${className}`}
    >
      {/* The digits are decorative; the sentence below is what gets spoken.
          `ring-card` (not `ring-white`) so the badge separates from the surface
          in dark mode too. */}
      <span aria-hidden="true">{count > 9 ? "9+" : count}</span>
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}
