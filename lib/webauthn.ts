import { createClient } from "@/lib/supabase/client";

/**
 * First-factor passkey helpers (Supabase experimental passkey API).
 *
 * These are NOT MFA factors. A passkey lives in its own namespace
 * (`supabase.auth.passkey.*`) and never shows up in `auth.mfa.listFactors()`,
 * so registering one does not satisfy the app's MFA requirement — it is a
 * passwordless sign-in credential, not a second factor.
 *
 * Requires `@supabase/supabase-js` v2.105+ and `auth.experimental.passkey: true`
 * on the browser client (see `lib/supabase/client.ts`), plus passkeys enabled in
 * the Supabase dashboard (Authentication → Passkeys). See
 * `/documentation/passkeys.md`.
 */

/**
 * Check if the browser supports WebAuthn (PublicKeyCredential API).
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

/**
 * Check if a platform authenticator (Face ID, Touch ID, fingerprint, Windows
 * Hello) is available on this device.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Check both conditions: browser support and platform authenticator available.
 *
 * Use this only to decide how to *describe* passkeys (Face ID / Touch ID
 * wording, "recommended" framing) — never to decide whether to offer sign-in.
 * Roaming authenticators (a USB security key) and cross-device sign-in (scan a
 * QR code with your phone) work fine on machines where this returns false, so
 * gating the sign-in button on it hides a working feature. `isWebAuthnSupported`
 * is the correct gate for that.
 */
export async function isPasskeyAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  return isPlatformAuthenticatorAvailable();
}

/**
 * Shape of the errors returned by the Supabase passkey APIs. WebAuthn ceremony
 * failures come back as a `WebAuthnError` (`name` = the DOMException name,
 * `code` = a Supabase-specific classification); server-side failures come back
 * as an `AuthError` with a GoTrue error code.
 */
type PasskeyError = {
  name?: string;
  code?: string;
  message?: string;
};

/**
 * Error thrown by the helpers below. `code` carries the original GoTrue /
 * WebAuthn classification so callers can branch on it (e.g. `insufficient_aal`
 * → offer a step-up) instead of matching on message text.
 */
export class PasskeyOperationError extends Error {
  code?: string;
  /** True when the ceremony was aborted in code — safe for the UI to swallow. */
  aborted: boolean;

  constructor(message: string, code?: string, aborted = false) {
    super(message);
    this.name = "PasskeyOperationError";
    this.code = code;
    this.aborted = aborted;
  }
}

/**
 * True when the failure means "this session isn't verified enough" — GoTrue
 * refuses passkey management on an AAL1 session once the account has a verified
 * MFA factor. Callers should step the session up to AAL2 and retry.
 */
export function isStepUpRequiredError(error: unknown): boolean {
  if (error instanceof PasskeyOperationError) {
    return error.code === "insufficient_aal";
  }
  return false;
}

/**
 * Translate a passkey failure into a message we can show the user.
 * Exported for unit tests; app code should catch `PasskeyOperationError`.
 *
 * Returns `null` when the ceremony was deliberately aborted in code (e.g. a
 * second prompt superseded the first) — that is the only case the UI should
 * swallow silently. Everything else, including a user-cancelled prompt, gets a
 * message, because the browser reports "cancelled" and "no passkey saved for
 * this site" as the same `NotAllowedError` and leaving both silent strands the
 * user with a button that appears to do nothing.
 */
export function describePasskeyError(
  error: PasskeyError,
  action: "sign-in" | "registration"
): string | null {
  // Programmatic abort — the only genuinely silent case.
  if (error.code === "ERROR_CEREMONY_ABORTED" || error.name === "AbortError") {
    return null;
  }

  switch (error.code) {
    case "ERROR_INVALID_RP_ID":
      return "Passkeys aren't available on this domain. They only work on the domain configured in Supabase (Authentication → Passkeys), so use the live site rather than localhost.";
    case "ERROR_INVALID_DOMAIN":
      return "Passkeys aren't available on this domain.";
    // GoTrue server-side codes
    case "passkey_disabled":
      return "Passkey authentication isn't enabled for this project.";
    case "insufficient_aal":
      return "This needs a fully verified session. Enter a code from your authenticator app, then try again.";
    case "too_many_passkeys":
      return "You've reached the maximum number of passkeys for this account. Remove one before adding another.";
    case "webauthn_credential_exists":
      return "This device already has a passkey registered for your account.";
    case "webauthn_credential_not_found":
      return "That passkey isn't registered with this account. Sign in another way, then add a passkey from your profile.";
    case "webauthn_challenge_expired":
    case "webauthn_challenge_not_found":
      return "The passkey request expired. Please try again.";
    case "webauthn_verification_failed":
      return "Your passkey couldn't be verified. Please try again.";
  }

  switch (error.name) {
    case "NotAllowedError":
      return action === "sign-in"
        ? "No passkey was used. You may have dismissed the prompt, or there's no passkey saved for this site on this device. Sign in with your password, then add a passkey from your profile."
        : "Passkey setup didn't complete. You may have dismissed the prompt, or your device declined the request.";
    case "InvalidStateError":
      return "This device already has a passkey registered for your account.";
    case "NotSupportedError":
      return "This device or browser doesn't support the passkey type this app requires.";
    case "ConstraintError":
      return "Your device couldn't create a passkey that meets this app's requirements. Check that screen lock or biometrics are enabled.";
  }

  return (
    error.message ||
    (action === "sign-in"
      ? "Failed to sign in with passkey"
      : "Failed to register passkey")
  );
}

function toPasskeyError(
  error: PasskeyError,
  action: "sign-in" | "registration"
): PasskeyOperationError {
  const message = describePasskeyError(error, action);
  if (message === null) {
    return new PasskeyOperationError(
      action === "sign-in"
        ? "Passkey sign-in was cancelled."
        : "Passkey registration was cancelled.",
      error.code,
      true
    );
  }
  return new PasskeyOperationError(message, error.code);
}

/**
 * Register a new passkey for the current user. The user must be signed in.
 * Triggers the browser's WebAuthn prompt.
 *
 * @returns The registered passkey metadata (id, friendly_name, created_at)
 * @throws PasskeyOperationError — `aborted` is true only when the ceremony was
 *   cancelled in code; callers may suppress that one and should surface
 *   everything else.
 */
export async function registerPasskey() {
  const supabase = createClient();

  const { data, error } = await supabase.auth.registerPasskey();

  if (error) throw toPasskeyError(error, "registration");

  return data;
}

/**
 * Sign in with a passkey. Triggers the browser's WebAuthn prompt to select and
 * use an existing passkey. Uses discoverable credentials, so the user does not
 * have to type an email first.
 *
 * @returns The session and user from Supabase auth
 * @throws PasskeyOperationError — see `registerPasskey` for the `aborted` flag.
 */
export async function signInWithPasskey() {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPasskey();

  if (error) throw toPasskeyError(error, "sign-in");

  return data;
}
