import { describe, it, expect } from "vitest";
import {
  describePasskeyError,
  isStepUpRequiredError,
  isWebAuthnSupported,
  PasskeyOperationError,
} from "@/lib/webauthn";

describe("describePasskeyError", () => {
  it("returns null ONLY for a programmatic abort", () => {
    expect(
      describePasskeyError({ code: "ERROR_CEREMONY_ABORTED" }, "sign-in")
    ).toBe(null);
    expect(describePasskeyError({ name: "AbortError" }, "sign-in")).toBe(null);
  });

  it("returns a message for a dismissed prompt, never null", () => {
    // The browser reports "user cancelled" and "no passkey saved for this
    // site" as the same NotAllowedError. Staying silent leaves the user with a
    // button that appears to do nothing, so both must produce copy.
    const message = describePasskeyError(
      { name: "NotAllowedError" },
      "sign-in"
    );
    expect(message).not.toBe(null);
    expect(message).toMatch(/passkey/i);
  });

  it("tailors NotAllowedError copy to the action", () => {
    const signIn = describePasskeyError({ name: "NotAllowedError" }, "sign-in");
    const registration = describePasskeyError(
      { name: "NotAllowedError" },
      "registration"
    );
    expect(signIn).not.toBe(registration);
  });

  it("prefers the GoTrue code over the DOMException name", () => {
    expect(
      describePasskeyError(
        { code: "too_many_passkeys", name: "NotAllowedError" },
        "registration"
      )
    ).toMatch(/maximum number of passkeys/i);
  });

  it.each([
    ["passkey_disabled", /isn't enabled/i],
    ["insufficient_aal", /authenticator app/i],
    ["webauthn_credential_exists", /already has a passkey/i],
    ["webauthn_credential_not_found", /isn't registered/i],
    ["webauthn_challenge_expired", /expired/i],
    ["webauthn_challenge_not_found", /expired/i],
    ["webauthn_verification_failed", /couldn't be verified/i],
    ["ERROR_INVALID_RP_ID", /domain/i],
  ])("maps %s to user-facing copy", (code, pattern) => {
    expect(describePasskeyError({ code }, "sign-in")).toMatch(pattern);
  });

  it("never leaks a raw code as the whole message", () => {
    const message = describePasskeyError(
      { code: "insufficient_aal" },
      "sign-in"
    );
    expect(message).not.toBe("insufficient_aal");
  });

  it("falls back to the raw message, then to a generic string", () => {
    expect(describePasskeyError({ message: "boom" }, "sign-in")).toBe("boom");
    expect(describePasskeyError({}, "sign-in")).toMatch(/failed to sign in/i);
    expect(describePasskeyError({}, "registration")).toMatch(
      /failed to register/i
    );
  });
});

describe("isStepUpRequiredError", () => {
  it("is true for insufficient_aal", () => {
    expect(
      isStepUpRequiredError(
        new PasskeyOperationError("needs verification", "insufficient_aal")
      )
    ).toBe(true);
  });

  it("is false for every other passkey failure", () => {
    expect(
      isStepUpRequiredError(
        new PasskeyOperationError(
          "already registered",
          "webauthn_credential_exists"
        )
      )
    ).toBe(false);
    expect(isStepUpRequiredError(new PasskeyOperationError("no code"))).toBe(
      false
    );
  });

  it("is false for unrelated throwables, including lookalike text", () => {
    // Guards against regressing to message-substring matching.
    expect(isStepUpRequiredError(new Error("insufficient_aal"))).toBe(false);
    expect(isStepUpRequiredError("insufficient_aal")).toBe(false);
    expect(isStepUpRequiredError(null)).toBe(false);
    expect(isStepUpRequiredError(undefined)).toBe(false);
  });
});

describe("PasskeyOperationError", () => {
  it("defaults to not aborted and carries the code", () => {
    const error = new PasskeyOperationError("nope", "passkey_disabled");
    expect(error).toBeInstanceOf(Error);
    expect(error.aborted).toBe(false);
    expect(error.code).toBe("passkey_disabled");
  });

  it("can be flagged as aborted", () => {
    expect(
      new PasskeyOperationError("cancelled", undefined, true).aborted
    ).toBe(true);
  });
});

describe("isWebAuthnSupported", () => {
  it("is false when there is no window (SSR)", () => {
    // Vitest runs in node here, so this also documents that the login page must
    // set the flag in an effect rather than during render.
    expect(isWebAuthnSupported()).toBe(false);
  });
});
