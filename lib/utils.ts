import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "1st", "2nd", "3rd", "4th"… including the 11th/12th/13th exceptions. */
function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * Format a date as "Aug 8th 2026".
 *
 * Read in UTC on purpose: the value shown must be the value stored, not the
 * viewer's local rendering of it (see CLAUDE.md → Important Rules). Returns an
 * empty string for missing or unparseable input so callers can render it
 * directly.
 */
export function formatDayMonthYear(value: string | Date | null | undefined) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${MONTHS_SHORT[date.getUTCMonth()]} ${ordinal(
    date.getUTCDate()
  )} ${date.getUTCFullYear()}`;
}

/* -------------------------------------------------------------------------
 * Project-wide date and number formatting
 *
 * Both defaults are set once here and chosen during `/start`. Everything
 * user-facing should go through `formatDate` / `formatNumber` rather than
 * calling `toLocaleDateString()` / `toLocaleString()` at the call site — a bare
 * `toLocale*()` with no locale renders in the *viewer's* locale, so the same
 * record reads "03/04/2026" for one colleague and "04/03/2026" for another,
 * with nothing on screen to say which is which.
 * ---------------------------------------------------------------------- */

/**
 * - `DD/MM/YYYY` — most of Europe, Latin America, Africa, Asia.
 * - `MM/DD/YYYY` — United States (and the few places following it).
 * - `MMM_D_YYYY` — "Aug 8th 2026". Unambiguous in every locale; the right
 *   choice when readers span multiple regions, because 03/04 cannot be
 *   misread as the wrong day.
 */
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "MMM_D_YYYY";

/**
 * Thousands and decimal separators.
 *
 * - `1.234,56` — Germany, Netherlands, Spain, Italy, Brazil, Indonesia…
 * - `1,234.56` — US, UK, Ireland, Australia, most of Asia.
 * - `1 234,56` — France, Nordics, Poland, Czechia, South Africa (SI style).
 */
export type NumberFormat = "1.234,56" | "1,234.56" | "1 234,56";

/**
 * Template default: the unambiguous one.
 *
 * A template is copied into projects whose audience isn't known yet, and
 * DD/MM vs MM/DD is the failure that is invisible until someone books the
 * wrong month. `/start` asks and replaces this with the regional format when
 * the audience is known to be single-region.
 */
export const DATE_FORMAT: DateFormat = "MMM_D_YYYY";

/** Template default. `/start` asks and replaces this. */
export const NUMBER_FORMAT: NumberFormat = "1,234.56";

const NUMBER_SEPARATORS: Record<
  NumberFormat,
  { group: string; decimal: string }
> = {
  "1.234,56": { group: ".", decimal: "," },
  "1,234.56": { group: ",", decimal: "." },
  // U+00A0 no-break space, so a number never wraps across a line mid-value.
  "1 234,56": { group: " ", decimal: "," },
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Format a date for display, using the project's `DATE_FORMAT`.
 *
 * Read in UTC on purpose: the value shown must be the value stored, never the
 * viewer's local rendering of it (CLAUDE.md → Important Rules). Returns an
 * empty string for missing or unparseable input so callers can render the
 * result directly.
 */
export function formatDate(
  value: string | Date | null | undefined,
  format: DateFormat = DATE_FORMAT
): string {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  switch (format) {
    case "DD/MM/YYYY":
      return `${pad(day)}/${pad(month)}/${year}`;
    case "MM/DD/YYYY":
      return `${pad(month)}/${pad(day)}/${year}`;
    case "MMM_D_YYYY":
      return formatDayMonthYear(date);
  }
}

/**
 * Format a number for display, using the project's `NUMBER_FORMAT`.
 *
 * Separators are applied by hand rather than via `Intl.NumberFormat` so the
 * output is identical on every runtime. ICU changes its mind about spacing —
 * modern versions emit a narrow no-break space (U+202F) for `fr-FR` where
 * older ones emit U+00A0 — which turns into snapshot tests that pass locally
 * and fail in CI over an invisible character.
 *
 * Returns an empty string for missing or non-finite input (`NaN`, `Infinity`),
 * so a bad value renders as blank rather than as the text "NaN".
 */
export function formatNumber(
  value: number | string | null | undefined,
  options: { decimals?: number; format?: NumberFormat } = {}
): string {
  if (value === null || value === undefined || value === "") return "";

  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";

  const { decimals, format = NUMBER_FORMAT } = options;
  const { group, decimal } = NUMBER_SEPARATORS[format];

  const fixed = decimals === undefined ? String(num) : num.toFixed(decimals);
  // Split on "." — `toFixed`/`String` always emit a dot, whatever the locale.
  const [rawInt, rawFraction] = fixed.split(".");

  const negative = rawInt.startsWith("-");
  const digits = negative ? rawInt.slice(1) : rawInt;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);

  return `${negative ? "-" : ""}${grouped}${
    rawFraction ? decimal + rawFraction : ""
  }`;
}

/**
 * How one currency is written.
 *
 * `position` and `space` are stored per project rather than derived from the
 * currency, because they follow the *locale*, not the money: the same euro is
 * written `€ 1.234,56` in the Netherlands, `1.234,56 €` in Germany and
 * `1 234,56 €` in France. There is no rule that gets all three right from the
 * currency code alone, so `/start` sets them explicitly.
 */
export interface CurrencyConfig {
  /** ISO 4217, e.g. "EUR". Shown as-is when no symbol is set. */
  code: string;
  symbol: string;
  /** Minor units: 2 for most, 0 for JPY, 3 for KWD/BHD/OMR. */
  decimals: number;
  position: "prefix" | "suffix";
  /** Whether to put a no-break space between symbol and amount. */
  space: boolean;
}

/**
 * The project's default currency, or `null` when the app handles no money at
 * all — which is the template's default, because most apps built on it don't.
 *
 * `/start` asks and sets this. Leave it `null` rather than picking a plausible
 * currency "just in case": a wrong currency symbol on a real figure is worse
 * than no money feature, and `null` makes the absence explicit.
 */
export const CURRENCY: CurrencyConfig | null = null;

/**
 * Starting points for the common currencies — `symbol` and `decimals` are
 * fixed facts, `position` and `space` are the locale-dependent defaults you
 * should confirm. Copy one into `CURRENCY` and adjust; this record is a
 * reference, not something to look up at runtime.
 */
export const CURRENCY_PRESETS: Record<string, CurrencyConfig> = {
  EUR: {
    code: "EUR",
    symbol: "€",
    decimals: 2,
    position: "suffix",
    space: true,
  }, // prefix+space in NL
  USD: {
    code: "USD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  GBP: {
    code: "GBP",
    symbol: "£",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  CHF: {
    code: "CHF",
    symbol: "CHF",
    decimals: 2,
    position: "prefix",
    space: true,
  },
  SEK: {
    code: "SEK",
    symbol: "kr",
    decimals: 2,
    position: "suffix",
    space: true,
  },
  NOK: {
    code: "NOK",
    symbol: "kr",
    decimals: 2,
    position: "suffix",
    space: true,
  },
  DKK: {
    code: "DKK",
    symbol: "kr.",
    decimals: 2,
    position: "suffix",
    space: true,
  },
  PLN: {
    code: "PLN",
    symbol: "zł",
    decimals: 2,
    position: "suffix",
    space: true,
  },
  CZK: {
    code: "CZK",
    symbol: "Kč",
    decimals: 2,
    position: "suffix",
    space: true,
  },
  TRY: {
    code: "TRY",
    symbol: "₺",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  JPY: {
    code: "JPY",
    symbol: "¥",
    decimals: 0,
    position: "prefix",
    space: false,
  },
  CNY: {
    code: "CNY",
    symbol: "¥",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  INR: {
    code: "INR",
    symbol: "₹",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  AUD: {
    code: "AUD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  CAD: {
    code: "CAD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  NZD: {
    code: "NZD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  BRL: {
    code: "BRL",
    symbol: "R$",
    decimals: 2,
    position: "prefix",
    space: true,
  },
  MXN: {
    code: "MXN",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  ZAR: {
    code: "ZAR",
    symbol: "R",
    decimals: 2,
    position: "prefix",
    space: true,
  },
  AED: {
    code: "AED",
    symbol: "AED",
    decimals: 2,
    position: "prefix",
    space: true,
  },
  SGD: {
    code: "SGD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
  HKD: {
    code: "HKD",
    symbol: "$",
    decimals: 2,
    position: "prefix",
    space: false,
  },
};

/**
 * Format a monetary amount using the project's `CURRENCY` and `NUMBER_FORMAT`.
 *
 * Amounts default to the currency's minor units (2 for most, 0 for JPY), so
 * money never renders with a stray third decimal or a missing trailing zero.
 *
 * A negative amount puts the minus **outside** the symbol (`-€1.234,56`, not
 * `€-1.234,56`), which is what every convention that uses a sign does.
 *
 * When no currency is configured and none is passed, this returns the grouped
 * number with no symbol rather than an empty string or a guessed one — an
 * unlabelled figure is honest and readable, a wrong currency symbol is neither.
 * If you see amounts without symbols, `CURRENCY` was never set: fix it there,
 * not at the call site.
 *
 * Returns an empty string for missing or non-finite input, matching
 * `formatNumber`.
 */
export function formatCurrency(
  value: number | string | null | undefined,
  options: {
    currency?: CurrencyConfig | null;
    format?: NumberFormat;
    decimals?: number;
  } = {}
): string {
  if (value === null || value === undefined || value === "") return "";

  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";

  const currency = options.currency !== undefined ? options.currency : CURRENCY;
  const decimals = options.decimals ?? currency?.decimals ?? 2;

  // Format the magnitude, then re-attach the sign, so the minus lands outside
  // the symbol instead of between it and the digits.
  const amount = formatNumber(Math.abs(num), {
    decimals,
    format: options.format,
  });
  const sign = num < 0 ? "-" : "";

  if (!currency) return `${sign}${amount}`;

  // U+00A0, so the symbol never wraps away from its amount.
  const gap = currency.space ? " " : "";

  return currency.position === "prefix"
    ? `${sign}${currency.symbol}${gap}${amount}`
    : `${sign}${amount}${gap}${currency.symbol}`;
}
