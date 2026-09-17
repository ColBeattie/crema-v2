/**
 * Client-safe configuration for the Productivity Tools Support widget.
 *
 * Nothing secret may be added to this file — it is imported by client
 * components. The signing secret lives in `lib/support-token.ts`, which is
 * imported only by the token route.
 */

/**
 * Where the support SDK and its iframe are served from.
 *
 * Hardcoded on purpose: it is the same for every project built from this
 * template, so making it an env var only creates one more thing to forget.
 * What DOES change per project (and per environment) is the installation key
 * below and the three server-side values in `lib/support-token.ts`.
 */
export const SUPPORT_URL = "https://nexus.productivitytools.io";

/**
 * Per-installation public key. Safe in the browser — it identifies the
 * installation, it does not authenticate anyone. Issue a separate installation
 * (and therefore a separate key) for production and staging.
 */
export const SUPPORT_INSTALLATION_KEY =
  process.env.NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY ?? "";

/** Path to this app's own token endpoint. */
export const SUPPORT_TOKEN_URL = "/api/support-token";

/**
 * Whether support is wired up in this deployment.
 *
 * A fresh clone of the template has no installation key, so the SDK would 404.
 * We skip loading it in that case (`SupportWidget`), but the sidebar's
 * "Help & support" entry stays visible and explains what is missing when
 * clicked — a named missing variable is easier to act on than a menu item that
 * silently isn't there.
 *
 * Either way this is presentation only — `/api/support-token` enforces auth and
 * entitlement independently, exactly as if the button were visible.
 */
export const isSupportConfigured = SUPPORT_INSTALLATION_KEY.length > 0;

/**
 * Build identification, attached to every ticket so we can tell "this broke
 * after your deploy on the 14th" from "this has always been broken".
 *
 * These are mapped from CI variables to public ones in `next.config.ts` — the
 * raw `VERCEL_*` / `GITHUB_*` variables are server-side only and would render
 * as empty attributes if read here directly.
 */
export const SUPPORT_RELEASE = {
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
  releaseId: process.env.NEXT_PUBLIC_RELEASE_ID ?? "",
  gitCommit: process.env.NEXT_PUBLIC_GIT_COMMIT ?? "",
};
