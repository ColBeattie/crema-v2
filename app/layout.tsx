import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthLayout from "./components/AuthLayout";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { COMPANY_NAME, APP_DESCRIPTION } from "@/lib/company";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: COMPANY_NAME,
  description: APP_DESCRIPTION,
  // Shown as the app name by the browser/OS (install prompts, task switchers).
  applicationName: COMPANY_NAME,
  // Link previews — WhatsApp, Slack, iMessage etc. read these, not <title>.
  // Add an `images` entry (1200x630) plus a `metadataBase` once a logo exists.
  openGraph: {
    type: "website",
    siteName: COMPANY_NAME,
    title: COMPANY_NAME,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: COMPANY_NAME,
    description: APP_DESCRIPTION,
  },
  // This is a private application surface — it must never appear in search
  // results. Set here on the root layout so every route inherits it; do NOT
  // set `robots` in an individual page's metadata, since that replaces this
  // default for that route rather than merging with it. The matching
  // `X-Robots-Tag` response header lives in next.config.ts and covers the
  // non-HTML responses (API, downloads) that a meta tag can't reach.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Applies the dark class before first paint based on the OS preference (no
// flash, no React 19 "script while rendering" warning since this is in the
// server-rendered HTML). The app follows the OS — there is no manual toggle, so
// we deliberately do NOT read localStorage (a stale value could otherwise pin
// the theme and ignore the OS). Add localStorage handling here and in the
// provider together if/when you add a toggle.
const THEME_INIT_SCRIPT = `(function(){try{var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Pre-paint theme application. Inline at the top of <body> so it runs
            before content renders (no flash). Server-rendered, so no React 19
            "script while rendering" warning. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <AuthLayout>{children}</AuthLayout>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
