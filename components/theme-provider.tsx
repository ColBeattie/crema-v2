"use client";

import * as React from "react";

/**
 * Theme sync (light / dark) for Tailwind's class strategy.
 *
 * The app follows the OS preference. The initial `.dark` class is applied
 * before paint by the inline script in app/layout.tsx; this provider keeps it
 * in sync if the OS preference changes while the app is open. It also re-applies
 * on mount, so it self-heals after an HMR update without a full reload.
 *
 * There is intentionally no localStorage override and no manual toggle — a
 * stale stored value was previously pinning the theme and ignoring the OS. If
 * you add a toggle later, reintroduce the override here AND in
 * THEME_INIT_SCRIPT (app/layout.tsx) together.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const root = document.documentElement;
      root.classList.toggle("dark", mql.matches);
      root.style.colorScheme = mql.matches ? "dark" : "light";
    };

    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  return <>{children}</>;
}
