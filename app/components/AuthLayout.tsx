"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import Sidebar, {
  readSidebarExpanded,
  SIDEBAR_TOGGLE_EVENT,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "./Sidebar";
import SupportWidget from "./SupportWidget";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  /**
   * Mirrors the sidebar's own expanded/collapsed state so the main content's
   * left margin tracks the rail's width.
   *
   * The two are siblings, so the state is shared through localStorage plus a
   * window event rather than lifted into a context — a provider around the
   * whole app would re-render every page on a sidebar toggle. Read in the
   * initializer to avoid the content visibly sliding across on first paint;
   * safe because this branch never renders on the server (see below).
   */
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarExpanded);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const readSidebarState = useCallback(() => {
    setSidebarExpanded(readSidebarExpanded());
  }, []);

  useEffect(() => {
    readSidebarState();
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, readSidebarState);
    return () =>
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, readSidebarState);
  }, [readSidebarState]);

  // Auth routes where sidebar should not be shown
  const authRoutes = [
    "/auth/login",
    "/auth/verify-email",
    "/auth/reset-password",
    "/auth/set-password",
    "/auth/mfa-setup",
    "/auth/mfa-verify",
    "/auth/profile-setup",
  ];
  const isAuthRoute = authRoutes.includes(pathname);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);

      // Redirect to login if not authenticated and not on an auth route
      if (!user && !isAuthRoute && !pathname.startsWith("/api/")) {
        router.push("/auth/login");
      }
    };

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);

      // Tell the support SDK the user changed. Its action count is cached per
      // browser tab for an hour, so without this a second person signing in on
      // a shared machine briefly sees the first person's number. Only the two
      // events that actually change identity — not TOKEN_REFRESHED, which
      // fires on a timer and would turn this into polling. Optional-chained on
      // purpose: before the SDK has loaded (or when support isn't configured)
      // there is simply nothing to refresh.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        window.PTSupport?.refreshActionCount?.();
      }

      // Redirect to login if user logs out and not on an auth route
      if (!session?.user && !isAuthRoute && !pathname.startsWith("/api/")) {
        router.push("/auth/login");
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isAuthRoute, router]);

  // Show full-width layout for auth routes
  if (isAuthRoute) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  // Redirect to login if not authenticated
  if (isAuthenticated === false) {
    // Don't render anything while redirecting
    return null;
  }

  // Show loading state while checking auth
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show authenticated layout with sidebar
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main
        className="flex-1 overflow-y-auto transition-[margin] duration-200 ease-out md:ml-[var(--sidebar-width)]"
        style={
          {
            "--sidebar-width": `${
              sidebarExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED
            }px`,
          } as React.CSSProperties
        }
      >
        <div className="pt-20 pb-4 px-4 md:pt-6 md:pb-6 md:px-6 lg:pt-8 lg:pb-8 lg:px-8 mobile-safe-padding">
          {children}
        </div>
      </main>
      {/* Loaded here, in the authenticated branch only, so support is reachable
          from every page but never loads for a logged-out visitor. */}
      <SupportWidget />
    </div>
  );
}
