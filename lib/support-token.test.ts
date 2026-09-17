import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signHs256,
  mintSupportToken,
  getSupportEnv,
  safeEqual,
  SUPPORT_AUDIENCE,
  SUPPORT_TOKEN_TTL_SECONDS,
} from "./support-token";

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("signHs256", () => {
  // The canonical jwt.io reference vector. If this fails, the signer is wrong
  // and every token this app mints will be rejected — fix it here before
  // debugging anything on the support platform's side.
  it("matches the canonical jwt.io HS256 vector", () => {
    const token = signHs256(
      { sub: "1234567890", name: "John Doe", iat: 1516239022 },
      "your-256-bit-secret"
    );

    const [header, payload, signature] = token.split(".");

    expect(decodeSegment(header)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodeSegment(payload)).toEqual({
      sub: "1234567890",
      name: "John Doe",
      iat: 1516239022,
    });
    expect(signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  });

  it("emits base64url — no +, / or = padding anywhere", () => {
    // `??` and `~~` are chosen because their base64 encoding contains + and /.
    const token = signHs256({ sub: "a??b~~c", n: 1 }, "s");
    expect(token).not.toMatch(/[+/=]/);
  });

  it("puts kid in the header when a key id is supplied", () => {
    const token = signHs256({ sub: "u1" }, "s", "key-123");
    expect(decodeSegment(token.split(".")[0])).toEqual({
      alg: "HS256",
      typ: "JWT",
      kid: "key-123",
    });
  });
});

describe("mintSupportToken", () => {
  const env = {
    secret: "test-secret",
    issuerId: "inst_test",
    keyId: "key_test",
  };

  it("sets every claim the support platform requires", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = mintSupportToken(
      {
        sub: "0d1c1f9e-1111-4222-8333-444455556666",
        email: "user@example.com",
        name: "Ada Lovelace",
        role: "customer_admin",
      },
      env
    );
    const after = Math.floor(Date.now() / 1000);

    const header = decodeSegment(token.split(".")[0]);
    const claims = decodeSegment(token.split(".")[1]) as Record<string, never>;

    expect(header).toMatchObject({ alg: "HS256", kid: "key_test" });
    expect(claims.iss).toBe("inst_test");
    expect(claims.aud).toBe(SUPPORT_AUDIENCE);
    expect(claims.sub).toBe("0d1c1f9e-1111-4222-8333-444455556666");
    expect(claims.email).toBe("user@example.com");
    expect(claims.name).toBe("Ada Lovelace");
    expect(claims.role).toBe("customer_admin");
    expect(claims.iat as number).toBeGreaterThanOrEqual(before);
    expect(claims.iat as number).toBeLessThanOrEqual(after);
    expect((claims.exp as number) - (claims.iat as number)).toBe(
      SUPPORT_TOKEN_TTL_SECONDS
    );
    expect(claims.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("expires 10 minutes out", () => {
    expect(SUPPORT_TOKEN_TTL_SECONDS).toBe(600);
  });

  it("issues a fresh jti on every call — tokens are never reusable", () => {
    const claims = { sub: "u1", role: "customer_user" as const };
    const a = decodeSegment(mintSupportToken(claims, env).split(".")[1]);
    const b = decodeSegment(mintSupportToken(claims, env).split(".")[1]);
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("getSupportEnv", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.SUPPORT_SIGNING_SECRET;
    delete process.env.SUPPORT_ISSUER_ID;
    delete process.env.SUPPORT_KEY_ID;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null when nothing is configured", () => {
    expect(getSupportEnv()).toBeNull();
  });

  it("returns null when only some values are set — no half-configured signing", () => {
    process.env.SUPPORT_SIGNING_SECRET = "s";
    process.env.SUPPORT_ISSUER_ID = "i";
    // SUPPORT_KEY_ID missing: a stale/absent kid fails with no_matching_key,
    // so refuse to mint rather than emit a token that cannot verify.
    expect(getSupportEnv()).toBeNull();
  });

  it("returns the config when all three are set", () => {
    process.env.SUPPORT_SIGNING_SECRET = "s";
    process.env.SUPPORT_ISSUER_ID = "i";
    process.env.SUPPORT_KEY_ID = "k";
    expect(getSupportEnv()).toEqual({
      secret: "s",
      issuerId: "i",
      keyId: "k",
    });
  });
});

describe("safeEqual", () => {
  it("compares equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings and different lengths without throwing", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
