import { describe, it, expect } from "vitest";
import { signedInWithPasskey } from "@/lib/auth-methods";

/**
 * `signedInWithPasskey` decides whether middleware skips the AAL2 redirect.
 * Both failure directions matter:
 *   - false negative → every passkey user is bounced to /auth/mfa-verify.
 *   - false positive → a password session skips its TOTP challenge.
 */
describe("signedInWithPasskey", () => {
  describe("AMREntry[] shape", () => {
    it("detects a passkey entry", () => {
      expect(
        signedInWithPasskey([{ method: "passkey", timestamp: 1735689600 }])
      ).toBe(true);
    });

    it("detects a passkey alongside other methods", () => {
      expect(
        signedInWithPasskey([
          { method: "otp", timestamp: 1735689600 },
          { method: "passkey", timestamp: 1735689601 },
        ])
      ).toBe(true);
    });

    it("returns false for password sign-in", () => {
      expect(
        signedInWithPasskey([{ method: "password", timestamp: 1735689600 }])
      ).toBe(false);
    });

    it("returns false for password + totp", () => {
      expect(
        signedInWithPasskey([
          { method: "password", timestamp: 1735689600 },
          { method: "totp", timestamp: 1735689660 },
        ])
      ).toBe(false);
    });
  });

  describe("string[] shape", () => {
    it("detects a passkey entry", () => {
      expect(signedInWithPasskey(["passkey"])).toBe(true);
    });

    it("detects a passkey alongside other methods", () => {
      expect(signedInWithPasskey(["otp", "passkey"])).toBe(true);
    });

    it("returns false for password sign-in", () => {
      expect(signedInWithPasskey(["password"])).toBe(false);
    });

    it("returns false for password + totp", () => {
      expect(signedInWithPasskey(["password", "totp"])).toBe(false);
    });
  });

  describe("degenerate input", () => {
    it("returns false for an empty array", () => {
      expect(signedInWithPasskey([])).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(signedInWithPasskey(undefined)).toBe(false);
    });

    it("returns false for null", () => {
      expect(signedInWithPasskey(null)).toBe(false);
    });

    it("returns false for a non-array", () => {
      expect(signedInWithPasskey({ method: "passkey" })).toBe(false);
    });

    it("tolerates null entries inside the array", () => {
      expect(signedInWithPasskey([null, { method: "passkey" }])).toBe(true);
      expect(signedInWithPasskey([null, undefined])).toBe(false);
    });

    it("does not match a substring or different casing", () => {
      expect(signedInWithPasskey(["passkeys"])).toBe(false);
      expect(signedInWithPasskey(["Passkey"])).toBe(false);
      expect(signedInWithPasskey([{ method: "webauthn" }])).toBe(false);
    });
  });
});
