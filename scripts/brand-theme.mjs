#!/usr/bin/env node
/**
 * brand-theme.mjs — turn a brand hex colour into the oklch() theme tokens used
 * by app/globals.css.
 *
 * Used by the /start skill (.claude/skills/start/SKILL.md) so the light/dark
 * token values are computed rather than eyeballed. Colour maths is Björn
 * Ottosson's sRGB -> OKLab conversion; the foreground pick is a WCAG contrast
 * comparison against white and black.
 *
 * Usage:
 *   node scripts/brand-theme.mjs "#1d4ed8"
 *   node scripts/brand-theme.mjs "#1d4ed8" --json
 *   node scripts/brand-theme.mjs "#1d4ed8" --email
 *
 * Output (default) is the exact `--token: value;` lines to paste into the
 * `:root` and `.dark` blocks of app/globals.css.
 *
 * `--email` prints plain hex instead, for the Supabase email templates in
 * setup/email-templates/. Email clients do not support oklch() or CSS custom
 * properties — Outlook still renders through Word — so those templates need
 * literal `#rrggbb`. The hex is the *same* colour as the app's light-mode
 * `--primary` (the clamped one, not the raw input), so the button in the email
 * matches the button in the app, and the clamping is what keeps text on it
 * readable when a brand colour is very light or very dark.
 */

function parseHex(input) {
  let hex = String(input).trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Not a valid hex colour: "${input}"`);
  }
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function srgbToOklch([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  );

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { L, C, h, linear: [lr, lg, lb] };
}

const contrast = (l1, l2) =>
  (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

const round = (n, p = 3) => Number(n.toFixed(p));
const oklch = (L, C, h) => `oklch(${round(L)} ${round(C)} ${round(h, 1)})`;

/** Clamp so a wildly saturated or near-black/white brand colour stays usable. */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function buildTheme(hex) {
  const rgb = parseHex(hex);
  const { L, C, h } = srgbToOklch(rgb);

  // Light mode: keep the brand's own character but hold lightness in a band
  // where white or black text can reach AA on the fill.
  const lightL = clamp(L, 0.45, 0.62);
  const lightC = clamp(C, 0.02, 0.2);

  // Dark mode: lift lightness and ease off chroma so the fill reads on a dark
  // surface without vibrating.
  const darkL = clamp(L + 0.15, 0.62, 0.78);
  const darkC = clamp(C * 0.9, 0.02, 0.18);

  const lightPrimary = { L: lightL, C: lightC, h };
  const darkPrimary = { L: darkL, C: darkC, h };

  // Pick the foreground against the *clamped* fill, not the raw input.
  const lightFgFinal = foregroundForFill(lightL, lightC, h);
  const darkFgFinal = foregroundForFill(darkL, darkC, h);

  // Chart ramp: hold the brand hue, fan out lightness/chroma so series stay
  // distinguishable. chart-3 shifts hue slightly for extra separation.
  const chartsLight = [
    oklch(clamp(lightL, 0.45, 0.6), lightC, h),
    oklch(clamp(lightL + 0.12, 0.5, 0.72), clamp(lightC * 0.85, 0.02, 0.18), h),
    oklch(clamp(lightL - 0.08, 0.35, 0.55), lightC, (h + 18) % 360),
    oklch(clamp(lightL + 0.22, 0.6, 0.82), clamp(lightC * 0.65, 0.02, 0.14), h),
    oklch(clamp(lightL + 0.32, 0.7, 0.9), clamp(lightC * 0.45, 0.02, 0.1), h),
  ];
  const chartsDark = [
    oklch(clamp(darkL, 0.55, 0.72), darkC, h),
    oklch(clamp(darkL + 0.1, 0.62, 0.8), clamp(darkC * 0.85, 0.02, 0.16), h),
    oklch(clamp(darkL - 0.1, 0.45, 0.62), darkC, (h + 18) % 360),
    oklch(clamp(darkL + 0.18, 0.7, 0.86), clamp(darkC * 0.65, 0.02, 0.13), h),
    oklch(clamp(darkL + 0.26, 0.78, 0.92), clamp(darkC * 0.45, 0.02, 0.09), h),
  ];

  return {
    input: hex,
    source: { L: round(L), C: round(C), h: round(h, 1) },
    light: {
      "--primary": oklch(lightPrimary.L, lightPrimary.C, lightPrimary.h),
      "--primary-foreground": lightFgFinal.value,
      "--ring": oklch(clamp(lightL + 0.1, 0.5, 0.75), lightC, h),
      "--chart-1": chartsLight[0],
      "--chart-2": chartsLight[1],
      "--chart-3": chartsLight[2],
      "--chart-4": chartsLight[3],
      "--chart-5": chartsLight[4],
      "--sidebar-primary": oklch(
        lightPrimary.L,
        lightPrimary.C,
        lightPrimary.h
      ),
      "--sidebar-primary-foreground": lightFgFinal.value,
      "--sidebar-ring": oklch(clamp(lightL + 0.1, 0.5, 0.75), lightC, h),
    },
    dark: {
      "--primary": oklch(darkPrimary.L, darkPrimary.C, darkPrimary.h),
      "--primary-foreground": darkFgFinal.value,
      "--ring": oklch(clamp(darkL - 0.12, 0.45, 0.68), darkC, h),
      "--chart-1": chartsDark[0],
      "--chart-2": chartsDark[1],
      "--chart-3": chartsDark[2],
      "--chart-4": chartsDark[3],
      "--chart-5": chartsDark[4],
      "--sidebar-primary": oklch(darkPrimary.L, darkPrimary.C, darkPrimary.h),
      "--sidebar-primary-foreground": darkFgFinal.value,
      "--sidebar-ring": oklch(clamp(darkL - 0.12, 0.45, 0.68), darkC, h),
    },
    contrast: {
      light: `${lightFgFinal.label} text, ~${lightFgFinal.ratio.toFixed(1)}:1`,
      dark: `${darkFgFinal.label} text, ~${darkFgFinal.ratio.toFixed(1)}:1`,
    },
  };
}

/** Inverse of srgbToOklch — OKLCh back to linear-light sRGB. */
function oklchToLinearSrgb(L, C, hDeg) {
  const hRad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(c, 0, 1));
}

/**
 * Pick the readable text colour for a fill, by real WCAG contrast.
 *
 * Converts the *final* (clamped) oklch fill back to linear sRGB and compares the
 * true relative luminance against white and black — an approximation from OKLab
 * lightness alone mis-ranks saturated mid-tones (crimson, teal) that sit near
 * the 4.5:1 boundary, which is exactly where the choice matters.
 */
function foregroundForFill(L, C, h) {
  const [lr, lg, lb] = oklchToLinearSrgb(L, C, h);
  const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const onWhite = contrast(lum, 1);
  const onBlack = contrast(lum, 0);
  return onBlack >= onWhite
    ? { value: "oklch(0.145 0 0)", ratio: onBlack, label: "near-black" }
    : { value: "oklch(0.985 0 0)", ratio: onWhite, label: "near-white" };
}

/** Linear-light sRGB channel back to gamma-encoded sRGB. */
const toGamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

/** OKLCh -> `#rrggbb`, for surfaces that can't parse oklch() (email clients). */
function oklchToHex(L, C, h) {
  return (
    "#" +
    oklchToLinearSrgb(L, C, h)
      .map((c) =>
        Math.round(clamp(toGamma(c), 0, 1) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

/**
 * Hex pair for the email templates: the button fill and readable text on it.
 *
 * Derived from the same clamped light-mode primary the app uses, so the email
 * and the app agree. The `.dark` variant is deliberately not offered — email
 * clients' dark modes rewrite colours unpredictably and a single fill that is
 * readable on both is more reliable than trying to serve two.
 */
function buildEmailColors(hex) {
  const theme = buildTheme(hex);
  const rgb = parseHex(hex);
  const { L, C, h } = srgbToOklch(rgb);

  // A neutral brand (black, white, pure grey) has no meaningful hue — atan2 on
  // a near-zero chroma returns noise, and the chroma floor in the clamp below
  // would then paint that noise into a visible tint, turning "our brand is
  // black" into a mauve button. Keep the template's existing neutral instead.
  if (C < 0.02) {
    return {
      input: theme.input,
      buttonBackground: "#111827",
      buttonText: "#ffffff",
      contrast: "near-white text, ~16.1:1",
      neutral: true,
    };
  }

  const lightL = clamp(L, 0.45, 0.62);
  const lightC = clamp(C, 0.02, 0.2);
  const fg = foregroundForFill(lightL, lightC, h);

  return {
    input: theme.input,
    buttonBackground: oklchToHex(lightL, lightC, h),
    buttonText: fg.label === "near-black" ? "#111827" : "#ffffff",
    contrast: `${fg.label} text, ~${fg.ratio.toFixed(1)}:1`,
    neutral: false,
  };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const asEmail = args.includes("--email");
  const hex = args.find((a) => !a.startsWith("--"));

  if (!hex) {
    console.error(
      'Usage: node scripts/brand-theme.mjs "#1d4ed8" [--json] [--email]\n' +
        "Prints the oklch() theme tokens for app/globals.css, or --email for\n" +
        "the hex pair used by setup/email-templates/."
    );
    process.exit(1);
  }

  if (asEmail) {
    let email;
    try {
      email = buildEmailColors(hex);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    if (asJson) {
      console.log(JSON.stringify(email, null, 2));
      return;
    }
    console.log(`brand ${email.input} -> email button colours`);
    console.log(`  background: ${email.buttonBackground}`);
    console.log(`  text:       ${email.buttonText}`);
    console.log(`  contrast:   ${email.contrast}`);
    return;
  }

  let theme;
  try {
    theme = buildTheme(hex);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(theme, null, 2));
    return;
  }

  const block = (tokens) =>
    Object.entries(tokens)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");

  console.log(
    `/* brand ${theme.input} -> oklch(L ${theme.source.L} C ${theme.source.C} h ${theme.source.h}) */`
  );
  console.log(`\n/* --- :root (light) --- */`);
  console.log(block(theme.light));
  console.log(`\n/* --- .dark --- */`);
  console.log(block(theme.dark));
  console.log(
    `\n/* contrast on primary: light = ${theme.contrast.light}; dark = ${theme.contrast.dark} */`
  );
}

main();
