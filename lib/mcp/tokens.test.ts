import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  expiresAt,
  generateSecret,
  hashSecret,
  safeEqual,
  verifyPkce,
} from "./tokens";

/**
 * These cover the parts of the MCP OAuth server where a bug is silent.
 *
 * A broken PKCE check does not throw and does not fail a build — it just
 * accepts an authorization code from whoever presents it, which is the one
 * thing PKCE exists to prevent. Same for hashing: if `hashSecret` ever stopped
 * matching the digest the store looks up by, every token would simply be
 * "invalid" and the failure would look like a configuration problem.
 */

describe("hashSecret", () => {
  it("is SHA-256 hex of the input", () => {
    const secret = "mcp_at_example";
    expect(hashSecret(secret)).toBe(
      createHash("sha256").update(secret).digest("hex")
    );
  });

  it("is stable across calls, so a stored hash keeps matching", () => {
    expect(hashSecret("abc")).toBe(hashSecret("abc"));
  });

  it("never returns the plaintext", () => {
    expect(hashSecret("mcp_rt_secret")).not.toContain("secret");
  });
});

describe("generateSecret", () => {
  it("prefixes each kind so a leaked string is identifiable", () => {
    expect(generateSecret("access").startsWith("mcp_at_")).toBe(true);
    expect(generateSecret("refresh").startsWith("mcp_rt_")).toBe(true);
    expect(generateSecret("code").startsWith("mcp_ac_")).toBe(true);
    expect(generateSecret("request").startsWith("mcp_rq_")).toBe(true);
  });

  it("does not repeat itself", () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => generateSecret("access"))
    );
    expect(seen.size).toBe(200);
  });

  it("carries 32 bytes of entropy (43 base64url chars after the prefix)", () => {
    const secret = generateSecret("access");
    expect(secret.slice("mcp_at_".length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the guard must catch it.
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("verifyPkce", () => {
  // The worked example from RFC 7636 Appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("accepts the RFC 7636 reference vector", () => {
    expect(verifyPkce(verifier, challenge, "S256")).toBe(true);
  });

  it("rejects a mismatched verifier", () => {
    expect(verifyPkce("a".repeat(43), challenge, "S256")).toBe(false);
  });

  it("refuses the plain method even when the values match", () => {
    // `plain` is allowed by the RFC and offers no protection against anyone who
    // can read the authorization request. It must never be accepted here.
    expect(verifyPkce(challenge, challenge, "plain")).toBe(false);
  });

  it("refuses an unknown method", () => {
    expect(verifyPkce(verifier, challenge, "S512")).toBe(false);
  });

  it("rejects a verifier that is too short to be worth checking", () => {
    const short = "abc";
    const shortChallenge = createHash("sha256")
      .update(short)
      .digest("base64url");
    expect(verifyPkce(short, shortChallenge, "S256")).toBe(false);
  });

  it("rejects a verifier containing characters outside the allowed set", () => {
    const bad = `${"a".repeat(42)}!`;
    const badChallenge = createHash("sha256").update(bad).digest("base64url");
    expect(verifyPkce(bad, badChallenge, "S256")).toBe(false);
  });
});

describe("expiresAt", () => {
  it("returns an ISO timestamp the given number of seconds ahead", () => {
    const before = Date.now();
    const result = Date.parse(expiresAt(60));
    expect(result).toBeGreaterThanOrEqual(before + 60_000);
    expect(result).toBeLessThan(before + 61_000);
  });
});
