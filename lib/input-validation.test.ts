import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  sanitizeHTML,
  sanitizeFilename,
  sanitizeEmail,
} from "./input-validation";

describe("sanitizeString", () => {
  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("removes null bytes", () => {
    expect(sanitizeString("hello\x00world")).toBe("helloworld");
  });

  it("removes script tags", () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe("");
  });

  it("removes iframe tags", () => {
    expect(sanitizeString('<iframe src="evil.com"></iframe>')).toBe("");
  });

  it("removes javascript: protocol", () => {
    expect(sanitizeString("javascript:alert(1)")).toBe("alert(1)");
  });

  it("throws on non-string input", () => {
    expect(() => sanitizeString(123 as any)).toThrow("Input must be a string");
  });
});

describe("sanitizeHTML", () => {
  it("encodes angle brackets", () => {
    expect(sanitizeHTML("<div>")).toBe("&lt;div&gt;");
  });

  it("encodes ampersands", () => {
    expect(sanitizeHTML("a & b")).toBe("a &amp; b");
  });

  it("encodes quotes", () => {
    expect(sanitizeHTML("\"hello'")).toBe("&quot;hello&#x27;");
  });
});

describe("sanitizeFilename", () => {
  it("removes path separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etcpasswd");
  });

  it("removes leading dots", () => {
    expect(sanitizeFilename("..hidden")).toBe("hidden");
  });

  it("truncates to 255 characters", () => {
    const long = "a".repeat(300);
    expect(sanitizeFilename(long).length).toBe(255);
  });

  it("keeps valid filenames unchanged", () => {
    expect(sanitizeFilename("report-2024.pdf")).toBe("report-2024.pdf");
  });
});

describe("sanitizeEmail", () => {
  it("lowercases and trims", () => {
    expect(sanitizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("removes invalid characters", () => {
    expect(sanitizeEmail("user+tag@example.com")).toBe("usertag@example.com");
  });
});
