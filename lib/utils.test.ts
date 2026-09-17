import { describe, it, expect } from "vitest";
import {
  formatDayMonthYear,
  formatDate,
  formatNumber,
  formatCurrency,
  CURRENCY_PRESETS,
} from "@/lib/utils";

describe("formatDayMonthYear", () => {
  it("formats as 'Mon Dayth Year'", () => {
    expect(formatDayMonthYear("2026-08-08T10:30:00Z")).toBe("Aug 8th 2026");
    expect(formatDayMonthYear("2026-01-15T00:00:00Z")).toBe("Jan 15th 2026");
    expect(formatDayMonthYear("2026-12-30T23:59:00Z")).toBe("Dec 30th 2026");
  });

  it.each([
    ["2026-08-01T12:00:00Z", "Aug 1st 2026"],
    ["2026-08-02T12:00:00Z", "Aug 2nd 2026"],
    ["2026-08-03T12:00:00Z", "Aug 3rd 2026"],
    ["2026-08-04T12:00:00Z", "Aug 4th 2026"],
    ["2026-08-11T12:00:00Z", "Aug 11th 2026"],
    ["2026-08-12T12:00:00Z", "Aug 12th 2026"],
    ["2026-08-13T12:00:00Z", "Aug 13th 2026"],
    ["2026-08-21T12:00:00Z", "Aug 21st 2026"],
    ["2026-08-22T12:00:00Z", "Aug 22nd 2026"],
    ["2026-08-23T12:00:00Z", "Aug 23rd 2026"],
    ["2026-08-31T12:00:00Z", "Aug 31st 2026"],
  ])("gets the ordinal right for %s", (input, expected) => {
    expect(formatDayMonthYear(input)).toBe(expected);
  });

  it("reads the date in UTC, not the viewer's timezone", () => {
    // Stored value is the value shown (CLAUDE.md → Important Rules). Late-UTC
    // timestamps must not roll back a day for viewers behind UTC.
    expect(formatDayMonthYear("2026-08-08T23:30:00Z")).toBe("Aug 8th 2026");
    expect(formatDayMonthYear("2026-08-08T00:30:00Z")).toBe("Aug 8th 2026");
  });

  it("accepts a Date object", () => {
    expect(formatDayMonthYear(new Date("2026-03-03T09:00:00Z"))).toBe(
      "Mar 3rd 2026"
    );
  });

  it("returns an empty string for missing or unparseable input", () => {
    expect(formatDayMonthYear(null)).toBe("");
    expect(formatDayMonthYear(undefined)).toBe("");
    expect(formatDayMonthYear("")).toBe("");
    expect(formatDayMonthYear("not a date")).toBe("");
  });
});

describe("formatDate", () => {
  const stamp = "2026-03-04T10:30:00Z"; // 4 March — the classic ambiguous one

  it("formats each style", () => {
    expect(formatDate(stamp, "DD/MM/YYYY")).toBe("04/03/2026");
    expect(formatDate(stamp, "MM/DD/YYYY")).toBe("03/04/2026");
    expect(formatDate(stamp, "MMM_D_YYYY")).toBe("Mar 4th 2026");
  });

  it("zero-pads day and month in the numeric styles", () => {
    expect(formatDate("2026-01-05T00:00:00Z", "DD/MM/YYYY")).toBe("05/01/2026");
    expect(formatDate("2026-01-05T00:00:00Z", "MM/DD/YYYY")).toBe("01/05/2026");
  });

  it("reads the date in UTC, not the viewer's timezone", () => {
    // Same rule as formatDayMonthYear: stored value is the value shown.
    expect(formatDate("2026-08-08T23:30:00Z", "DD/MM/YYYY")).toBe("08/08/2026");
    expect(formatDate("2026-08-08T00:30:00Z", "DD/MM/YYYY")).toBe("08/08/2026");
  });

  it("returns an empty string for missing or unparseable input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("formatNumber", () => {
  it("groups thousands per style", () => {
    expect(formatNumber(1234567.89, { decimals: 2, format: "1.234,56" })).toBe(
      "1.234.567,89"
    );
    expect(formatNumber(1234567.89, { decimals: 2, format: "1,234.56" })).toBe(
      "1,234,567.89"
    );
    expect(formatNumber(1234567.89, { decimals: 2, format: "1 234,56" })).toBe(
      "1 234 567,89"
    );
  });

  it("uses a no-break space so a number can't wrap mid-value", () => {
    expect(formatNumber(1234, { format: "1 234,56" })).toContain(" ");
    expect(formatNumber(1234, { format: "1 234,56" })).not.toContain(" ");
  });

  it("leaves numbers under 1000 ungrouped", () => {
    expect(formatNumber(999, { format: "1.234,56" })).toBe("999");
    expect(formatNumber(1000, { format: "1.234,56" })).toBe("1.000");
  });

  it("handles negatives without grouping the minus sign", () => {
    expect(formatNumber(-1234567, { format: "1,234.56" })).toBe("-1,234,567");
    expect(formatNumber(-1234.5, { decimals: 2, format: "1.234,56" })).toBe(
      "-1.234,50"
    );
  });

  it("omits the decimal separator when there is no fraction", () => {
    expect(formatNumber(1500, { format: "1,234.56" })).toBe("1,500");
    expect(formatNumber(1500, { decimals: 0, format: "1,234.56" })).toBe(
      "1,500"
    );
  });

  it("accepts numeric strings", () => {
    expect(formatNumber("1234.5", { decimals: 2, format: "1,234.56" })).toBe(
      "1,234.50"
    );
  });

  it("returns an empty string rather than 'NaN' for bad input", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(undefined)).toBe("");
    expect(formatNumber("")).toBe("");
    expect(formatNumber("not a number")).toBe("");
    expect(formatNumber(Infinity)).toBe("");
    expect(formatNumber(NaN)).toBe("");
  });
});

describe("formatCurrency", () => {
  const eurNl = { ...CURRENCY_PRESETS.EUR, position: "prefix" as const };
  const eurDe = CURRENCY_PRESETS.EUR; // suffix + space
  const usd = CURRENCY_PRESETS.USD;

  it("places the symbol per the currency config", () => {
    expect(formatCurrency(1234.5, { currency: usd, format: "1,234.56" })).toBe(
      "$1,234.50"
    );
    expect(
      formatCurrency(1234.5, { currency: eurDe, format: "1.234,56" })
    ).toBe("1.234,50\u00a0\u20ac");
    expect(
      formatCurrency(1234.5, { currency: eurNl, format: "1.234,56" })
    ).toBe("\u20ac\u00a01.234,50");
  });

  it("puts the minus outside the symbol, not between symbol and digits", () => {
    expect(formatCurrency(-99, { currency: usd, format: "1,234.56" })).toBe(
      "-$99.00"
    );
    expect(formatCurrency(-99, { currency: eurDe, format: "1.234,56" })).toBe(
      "-99,00\u00a0\u20ac"
    );
  });

  it("uses the currency's minor units by default", () => {
    // JPY has no minor unit — a "¥1,234.00" would be wrong, not just ugly.
    expect(
      formatCurrency(1234, {
        currency: CURRENCY_PRESETS.JPY,
        format: "1,234.56",
      })
    ).toBe("\u00a51,234");
    expect(formatCurrency(1234, { currency: usd, format: "1,234.56" })).toBe(
      "$1,234.00"
    );
  });

  it("lets an explicit decimals option win over the currency default", () => {
    expect(
      formatCurrency(1234.567, {
        currency: usd,
        decimals: 3,
        format: "1,234.56",
      })
    ).toBe("$1,234.567");
  });

  it("uses a no-break space so the symbol can't wrap off its amount", () => {
    const out = formatCurrency(1234.5, { currency: eurDe, format: "1.234,56" });
    expect(out).toContain("\u00a0");
    expect(out).not.toContain(" ");
  });

  it("renders an unlabelled number when no currency is configured", () => {
    // Honest and readable; a guessed symbol would not be.
    expect(formatCurrency(1234.5, { currency: null, format: "1,234.56" })).toBe(
      "1,234.50"
    );
  });

  it("returns an empty string rather than a symbol for bad input", () => {
    expect(formatCurrency(null, { currency: usd })).toBe("");
    expect(formatCurrency(undefined, { currency: usd })).toBe("");
    expect(formatCurrency("", { currency: usd })).toBe("");
    expect(formatCurrency("not a number", { currency: usd })).toBe("");
    expect(formatCurrency(NaN, { currency: usd })).toBe("");
    expect(formatCurrency(Infinity, { currency: usd })).toBe("");
  });

  it("keeps zero visible", () => {
    expect(formatCurrency(0, { currency: usd, format: "1,234.56" })).toBe(
      "$0.00"
    );
  });
});
