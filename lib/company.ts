/**
 * Single source of truth for the product / company name.
 *
 * It lives here rather than in `app/layout.tsx` so client components can import
 * it without pulling the root layout (fonts, providers) into their bundle — the
 * MFA enrolment screens need it for the TOTP issuer, which is the label the
 * user sees in their authenticator app after scanning the QR code.
 *
 * Change it in this file only; everything else reads from here.
 */

// TODO: Replace with your actual company name
export const COMPANY_NAME = "Company Name";

/** One short sentence — used for the meta description and link previews. */
export const APP_DESCRIPTION = "Modern app template with Supabase";
