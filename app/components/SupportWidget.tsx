"use client";

import Script from "next/script";
import {
  SUPPORT_URL,
  SUPPORT_INSTALLATION_KEY,
  SUPPORT_TOKEN_URL,
  SUPPORT_RELEASE,
  isSupportConfigured,
} from "@/lib/support";
import { SUPPORT_SDK_READY_EVENT } from "./SupportBadge";

/**
 * Loads the Productivity Tools Support SDK.
 *
 * Rendered once, from the authenticated branch of `AuthLayout`, so support is
 * reachable from every page but never loads for a logged-out visitor. Do not
 * add it to individual pages.
 *
 * The SDK reads its `data-*` attributes from `document.currentScript` at load
 * time, which works with `next/script`'s `afterInteractive` strategy because
 * that injects a real <script> element. If a future bundler inlines the SDK
 * source into a chunk instead, there is no script element to read from — call
 * `PTSupport.configure({ installationKey, tokenUrl })` in that case.
 *
 * The floating launcher is suppressed: the entry point lives in the sidebar
 * (see `Sidebar.tsx`) so it sits with the rest of the navigation instead of
 * floating over page content. The sidebar also renders the SDK's action-count
 * badge — see `SupportBadge.tsx`.
 */
export default function SupportWidget() {
  if (!isSupportConfigured) return null;

  return (
    <Script
      src={`${SUPPORT_URL}/support-sdk.js`}
      data-installation-key={SUPPORT_INSTALLATION_KEY}
      data-token-url={SUPPORT_TOKEN_URL}
      data-app-version={SUPPORT_RELEASE.appVersion}
      data-release-id={SUPPORT_RELEASE.releaseId}
      data-git-commit={SUPPORT_RELEASE.gitCommit}
      data-hide-launcher="true"
      strategy="afterInteractive"
      /* Tells the rest of the app the SDK is up. `afterInteractive` runs the
         script *after* hydration, so components that mount earlier (the
         sidebar, which owns the action-count badge) would otherwise check
         `window.PTSupport`, find nothing, and never subscribe. */
      onReady={() => {
        window.dispatchEvent(new Event(SUPPORT_SDK_READY_EVENT));
      }}
    />
  );
}
