"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Settings,
  BarChart3,
  LogOut,
  Menu,
  X,
  ShieldAlert,
  LifeBuoy,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { isSupportConfigured } from "@/lib/support";
import SupportBadge, { useSupportActionCount } from "./SupportBadge";
import Tooltip from "./Tooltip";

/** Where the rail's expanded/collapsed choice is remembered, per browser. */
export const SIDEBAR_EXPANDED_KEY = "sidebar-expanded";

/**
 * Fired on `window` when the rail is toggled, so `AuthLayout` can move the
 * main content's left margin in step. The two components are siblings, so
 * there is no shared parent to hold this state without lifting it into a
 * context — and a context provider re-rendering the whole app on a sidebar
 * toggle costs more than one event listener.
 */
export const SIDEBAR_TOGGLE_EVENT = "sidebarToggle";

/** Rail width in pixels, in each state. `AuthLayout` mirrors these. */
export const SIDEBAR_WIDTH_COLLAPSED = 80;
export const SIDEBAR_WIDTH_EXPANDED = 220;

/**
 * The persisted rail state, or `false` when it can't be read.
 *
 * Wrapped because touching `localStorage` *throws* — it does not return null —
 * in a browser configured to block site data. This runs in the initializer of
 * a component inside the root layout, so an unguarded read there is a white
 * screen for the whole app, not a sidebar that forgets its width.
 */
export function readSidebarExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  /**
   * The person's name, for the expanded rail. Empty when they haven't filled
   * it in on /profile yet, in which case the email is all we have.
   */
  const [userName, setUserName] = useState<string>("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportErrorVisible, setSupportErrorVisible] = useState(false);
  const supportErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * How many support requests are waiting on this user.
   *
   * Subscribed once here because this component owns every support entry
   * point. `null` = not known yet, which renders as no badge at all.
   *
   * Both entry points live inside menus that are closed by default (the
   * desktop account menu, the mobile drawer), so the badge is mirrored onto
   * the always-visible trigger of each — otherwise the number only appears to
   * someone who already went looking, which defeats the point of having it.
   * The copies are decorative; the spoken count stays on the support button.
   */
  const supportActionCount = useSupportActionCount();
  /**
   * Desktop rail: icon-only (collapsed) or icon + label (expanded).
   *
   * Read straight from localStorage in the initializer rather than in an
   * effect, so an expanded sidebar doesn't render collapsed for a frame and
   * visibly snap open on every navigation. That is safe here specifically
   * because `AuthLayout` renders a spinner until its async auth check resolves
   * — this component only ever mounts on the client, after hydration, so there
   * is no server-rendered markup for it to mismatch.
   *
   * Mobile is unaffected: the drawer is full-width and has its own toggle.
   */
  const [isExpanded, setIsExpanded] = useState(readSidebarExpanded);

  const checkIfAdmin = async () => {
    // Check admin status from user's app_metadata
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isUserAdmin = user?.app_metadata?.role === "admin";
      setIsAdmin(isUserAdmin);
    } catch {
      setIsAdmin(false);
    }
  };

  const loadUserInfo = async () => {
    try {
      // Load user's info
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || "");
        setUserName(
          [user.user_metadata?.first_name, user.user_metadata?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim()
        );

        // Load user's profile image
        if (user.user_metadata?.avatar_url) {
          setProfileImage(user.user_metadata.avatar_url);
        } else {
          // Try to load from storage as fallback
          const { data: files } = await supabase.storage
            .from("profiles")
            .list(`${user.id}`, {
              limit: 10,
              sortBy: { column: "created_at", order: "desc" },
            });

          if (files && files.length > 0) {
            const avatarFile = files.find((file) =>
              file.name.startsWith("avatar-")
            );
            if (avatarFile) {
              const {
                data: { publicUrl },
              } = supabase.storage
                .from("profiles")
                .getPublicUrl(`${user.id}/${avatarFile.name}`);
              setProfileImage(publicUrl);
            } else {
              setProfileImage(null);
            }
          } else {
            setProfileImage(null);
          }
        }
      }
    } catch {
      setProfileImage(null);
    }
  };

  useEffect(() => {
    checkIfAdmin();
    loadUserInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Listen for profile updates
    const handleProfileUpdate = () => {
      loadUserInfo();
    };

    window.addEventListener("profileUpdated", handleProfileUpdate);

    return () => {
      window.removeEventListener("profileUpdated", handleProfileUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll detection for hiding/showing app bar
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scrolling down and past threshold
        setIsScrollingDown(true);
      } else if (currentScrollY < lastScrollY) {
        // Scrolling up
        setIsScrollingDown(false);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${window.scrollY}px`;
      document.body.style.width = "100%";
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || "0") * -1);
      }
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
    };
  }, [isMobileMenuOpen]);

  /**
   * Expand or collapse the desktop rail.
   *
   * Persisted immediately so the choice survives a reload, and announced on
   * `window` so `AuthLayout` can shift the content margin at the same time.
   */
  const toggleExpanded = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      // Private mode / storage disabled: the rail still toggles, it just
      // doesn't remember. Not worth surfacing to the user.
    }
    window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT));
  };

  const getInitials = (email: string) => {
    if (!email) return "U";
    const parts = email.split("@")[0].split(".");
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  /**
   * Drop focus after a pointer click inside the account menu.
   *
   * The menu is held open by `group-hover` OR `group-focus-within`. Clicking an
   * item leaves that item focused, so `focus-within` keeps the menu open even
   * after the pointer moves away — it only closes once a click elsewhere blurs
   * it.
   *
   * Guarded on `detail > 0`, which is true for a real pointer click and 0 for
   * keyboard activation (Enter/Space). Blurring unconditionally would defeat
   * the point of `focus-within`, which exists so keyboard users can tab through
   * these items at all.
   */
  const blurOnPointerClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.detail > 0) e.currentTarget.blur();
  };

  const dismissSupportError = useCallback(() => {
    if (supportErrorTimer.current) clearTimeout(supportErrorTimer.current);
    setSupportErrorVisible(false);
  }, []);

  /**
   * Show the support failure notice, then fade it out on its own.
   *
   * The pending timer is held in a ref and cleared on every call, so a second
   * error can't inherit the first one's countdown and vanish early. The text is
   * left in state after the fade rather than nulled — clearing it mid-transition
   * would blank the box before it finished animating out.
   */
  const showSupportError = useCallback((text: string) => {
    if (supportErrorTimer.current) clearTimeout(supportErrorTimer.current);
    setSupportError(text);
    setSupportErrorVisible(true);
    supportErrorTimer.current = setTimeout(
      () => setSupportErrorVisible(false),
      6000
    );
  }, []);

  // Don't leave a timer pointing at a setState for an unmounted component.
  useEffect(() => {
    return () => {
      if (supportErrorTimer.current) clearTimeout(supportErrorTimer.current);
    };
  }, []);

  /**
   * Open the support panel.
   *
   * The entry point is always rendered, including on an unprovisioned clone of
   * the template — a visible button that explains what is missing is easier to
   * act on than a menu item that silently isn't there.
   *
   * Deliberately NOT `window.PTSupport?.open()`: the optional chain swallows
   * the most common failure — the SDK not having loaded, or having bailed out
   * on a missing installation key — and turns a diagnosable problem into a
   * button that appears to do nothing. Check explicitly and tell the user.
   */
  const openSupport = () => {
    if (!isSupportConfigured) {
      showSupportError(
        "Support isn't set up for this deployment: NEXT_PUBLIC_SUPPORT_INSTALLATION_KEY is not set. Add it to your environment and restart the server."
      );
      return;
    }
    if (!window.PTSupport) {
      showSupportError(
        "Support is still loading. Please try again in a moment."
      );
      return;
    }
    dismissSupportError();
    window.PTSupport.open();
  };

  const navItems = [
    {
      name: "Home",
      href: "/",
      icon: Home,
    },
    {
      name: "Table",
      href: "/table-template",
      icon: BarChart3,
    },
  ];

  const isItemActive = (item: any) => {
    if (item.href) {
      return pathname === item.href;
    }
    if (item.subItems) {
      // Check if current path starts with any of the sub-item paths
      return item.subItems.some(
        (subItem: any) =>
          pathname === subItem.href || pathname.startsWith(subItem.href + "/")
      );
    }
    return false;
  };

  return (
    <>
      {/* Mobile App Bar */}
      <div
        className={`
        md:hidden fixed top-0 left-0 right-0 z-40
        bg-card/80 backdrop-blur-lg
        border-b border-border/50
        transition-transform duration-300 ease-in-out
        ${isScrollingDown ? "-translate-y-full" : "translate-y-0"}
      `}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="relative flex items-center justify-center w-11 h-11 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={
              supportActionCount && supportActionCount > 0
                ? `Open menu, ${supportActionCount} support ${
                    supportActionCount === 1 ? "request needs" : "requests need"
                  } your attention`
                : "Open menu"
            }
          >
            <Menu className="h-6 w-6" />
            {/* Mirror of the badge on the support item inside the drawer. The
                count is in this button's aria-label above, so the badge itself
                is decorative and must not be announced twice. */}
            <SupportBadge
              count={supportActionCount}
              decorative
              className="absolute right-1 top-1"
            />
          </button>
          <h1 className="text-lg font-semibold text-foreground">Logo</h1>
          <div className="w-11 h-11" /> {/* Spacer for centering */}
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex fixed left-0 top-0 h-full bg-card border-r border-border shadow-sm z-50 transition-[width] duration-200 ease-out"
        style={{
          width: isExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED,
        }}
      >
        {/* No `overflow-hidden` here, however tempting during the width
            transition: the account menu is an absolutely positioned descendant
            that deliberately sits outside the rail, and would be clipped away.
            Labels carry `truncate` instead, so nothing spills. */}
        <div className="flex flex-col h-full w-full">
          <div className="px-2 py-4 border-b border-border">
            <h2
              className={`text-sm font-bold text-foreground truncate ${
                isExpanded ? "px-1 text-left" : "text-center"
              }`}
            >
              Logo
            </h2>
          </div>

          <nav className="flex-1 py-4 overflow-y-auto">
            <ul className="space-y-2 px-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isItemActive(item);

                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={`
                        flex rounded-lg transition-colors group
                        ${
                          isExpanded
                            ? "flex-row items-center gap-3 py-2.5 px-3"
                            : "flex-col items-center justify-center py-3 px-2"
                        }
                        ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }
                      `}
                    >
                      <Icon
                        className={`h-5 w-5 shrink-0 ${isExpanded ? "" : "mb-1"} ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
                      />
                      <span
                        className={`font-medium truncate ${
                          isExpanded ? "text-sm" : "text-xs text-center"
                        }`}
                      >
                        {item.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="py-4 border-t border-border">
            <div
              className={`flex flex-col space-y-3 ${
                isExpanded ? "items-stretch px-2" : "items-center"
              }`}
            >
              <div
                className={`relative group ${
                  isExpanded ? "flex items-center gap-3" : ""
                }`}
              >
                {/* Own positioning context so the badge sits on the avatar's
                    corner identically in both rail widths. */}
                <div className="relative shrink-0">
                  {/* Mirror of the badge on "Help & support" inside the account
                      menu, which is closed until hovered or focused.
                      Decorative: it must not read as "Profile, 3 requests…" —
                      the spoken count belongs on the support button the menu
                      reveals. */}
                  <SupportBadge
                    count={supportActionCount}
                    decorative
                    className="absolute -right-1 -top-1 z-10 pointer-events-none"
                  />
                  <Link
                    href="/profile"
                    onClick={blurOnPointerClick}
                    className={`
                    relative block w-10 h-10 rounded-full overflow-hidden transition-all
                    ${
                      pathname === "/profile"
                        ? "ring-2 ring-primary"
                        : "hover:ring-2 hover:ring-muted-foreground/50"
                    }
                  `}
                  >
                    {profileImage ? (
                      <Image
                        src={profileImage}
                        alt="Profile"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {getInitials(userEmail)}
                        </span>
                      </div>
                    )}
                  </Link>
                </div>

                {/* Only worth the width when there is width: the collapsed rail
                    is 80px, which truncates any real address to nothing. */}
                {isExpanded && (
                  <div className="min-w-0 flex-1">
                    {/* The person's name only — never the email address. An
                        email is an identifier, not a name, and the rail is a
                        surface other people read over your shoulder. Falls
                        back to a neutral label rather than the address when no
                        name is set; the email lives on /profile, one click
                        away through this menu. */}
                    <div className="text-xs font-medium text-foreground truncate">
                      {userName || "Account"}
                    </div>
                  </div>
                )}

                {/* Account menu — desktop only. Opens on hover AND on keyboard
                    focus (focus-within), so the items inside are reachable
                    without a pointer. Anchored to the bottom of the avatar so
                    it grows upward: the avatar sits at the bottom of the
                    viewport, and a centred menu would run off-screen. */}
                <div className="absolute left-full bottom-0 opacity-0 pointer-events-none transition-opacity z-50 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                  {/* Bridges the gap between avatar and menu so moving the
                      pointer across it doesn't close the menu. */}
                  <div className="absolute right-full bottom-0 w-2 h-full" />
                  <div className="ml-2 min-w-44 py-1 bg-card border border-border rounded-lg shadow-lg">
                    {/* Support — every user, always shown. If the installation
                        key is missing, openSupport() says so. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        blurOnPointerClick(e);
                        openSupport();
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-foreground hover:bg-muted transition-colors whitespace-nowrap"
                    >
                      <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        Help &amp; support
                      </span>
                      {/* Inside the button, so the count joins its accessible
                          name rather than being a bare red number. */}
                      <SupportBadge
                        count={supportActionCount}
                        className="ml-auto"
                      />
                    </button>

                    {/* AI Integration, Settings and Security stay admin-only.
                        AI Integration is gated on the same rule the server
                        enforces (lib/mcp/entitlement.ts: admins only) — hiding
                        it is presentation, not a boundary. */}
                    {isAdmin && (
                      <Link
                        href="/ai-integration"
                        onClick={blurOnPointerClick}
                        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted transition-colors whitespace-nowrap ${
                          pathname.startsWith("/ai-integration")
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        <Sparkles
                          className={`h-4 w-4 ${
                            pathname.startsWith("/ai-integration")
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        <span className="text-xs font-medium">
                          AI Integration
                        </span>
                      </Link>
                    )}

                    {isAdmin && (
                      <Link
                        href="/settings"
                        onClick={blurOnPointerClick}
                        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted transition-colors whitespace-nowrap ${
                          pathname === "/settings"
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        <Settings
                          className={`h-4 w-4 ${
                            pathname === "/settings"
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        <span className="text-xs font-medium">Settings</span>
                      </Link>
                    )}

                    {isAdmin && (
                      <Link
                        href="/admin/security"
                        onClick={blurOnPointerClick}
                        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted transition-colors whitespace-nowrap ${
                          pathname === "/admin/security"
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        <ShieldAlert
                          className={`h-4 w-4 ${
                            pathname === "/admin/security"
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        <span className="text-xs font-medium">Security</span>
                      </Link>
                    )}

                    <div className="my-1 h-px bg-border" />

                    <button
                      onClick={(e) => {
                        blurOnPointerClick(e);
                        handleLogout();
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-foreground hover:bg-muted hover:text-red-600 transition-colors whitespace-nowrap"
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="text-xs font-medium">Logout</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Expand / collapse. Last item in the rail, so it stays in the
                  same place in both states instead of moving as the nav
                  above it changes shape. `aria-expanded` is on the button
                  itself because it controls the rail it sits in.

                  The tooltip is the project's own (`ui.md` forbids the native
                  `title` one): it renders `fixed` and clamps itself to the
                  viewport, so it escapes the rail instead of being cut off by
                  it. `right` because the rail is pinned to the left edge —
                  any other side would open off-screen. */}
              <Tooltip
                content={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                position="right"
              >
                <button
                  type="button"
                  onClick={toggleExpanded}
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded ? "Collapse sidebar" : "Expand sidebar"
                  }
                  className={`flex items-center rounded-lg py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
                    isExpanded ? "w-full gap-3 px-3" : "justify-center px-2"
                  }`}
                >
                  {isExpanded ? (
                    <ChevronsLeft className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronsRight className="h-4 w-4 shrink-0" />
                  )}
                  {isExpanded && (
                    <span className="text-xs font-medium truncate">
                      Collapse
                    </span>
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile slide-in drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer */}
          <div
            className={`
            absolute top-0 left-0 h-full w-80 max-w-[85vw]
            bg-card
            shadow-xl
            transform transition-transform duration-300 ease-out
            flex flex-col
            ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
          `}
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingLeft: "env(safe-area-inset-left)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
              <h2 className="text-xl font-bold text-foreground">Logo</h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center w-11 h-11 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close menu"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Navigation - Scrollable middle section */}
            <nav className="flex-1 p-6 overflow-y-auto">
              <ul className="space-y-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isItemActive(item);

                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`
                          flex items-center gap-4 py-4 px-4 rounded-lg transition-colors
                          ${
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted"
                          }
                        `}
                      >
                        <Icon
                          className={`h-6 w-6 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <span className="text-lg font-medium">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Fixed bottom section - Always at screen bottom */}
            <div className="flex-shrink-0 p-6 border-t border-border bg-card">
              <ul className="space-y-2">
                {/* Profile */}
                <li>
                  <Link
                    href="/profile"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`
                      flex items-center gap-4 py-4 px-4 rounded-lg transition-colors
                      ${
                        pathname === "/profile"
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-muted"
                      }
                    `}
                  >
                    <div className="relative w-6 h-6 rounded-full overflow-hidden">
                      {profileImage ? (
                        <Image
                          src={profileImage}
                          alt="Profile"
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                          <span className="text-white text-xs font-medium">
                            {getInitials(userEmail)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="text-lg font-medium">Profile</span>
                      <div className="text-sm text-muted-foreground truncate">
                        {userEmail}
                      </div>
                    </div>
                  </Link>
                </li>

                {/* Support — above Settings, for every user, always shown. */}
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      openSupport();
                    }}
                    className="flex items-center gap-4 py-4 px-4 rounded-lg transition-colors text-foreground hover:bg-muted w-full"
                  >
                    <LifeBuoy className="h-6 w-6 text-muted-foreground" />
                    <span className="text-lg font-medium">
                      Help &amp; support
                    </span>
                    {/* Inside the button, so the count joins its accessible
                        name rather than being a bare red number. */}
                    <SupportBadge
                      count={supportActionCount}
                      className="ml-auto"
                    />
                  </button>
                </li>

                {/* AI Integration for admins — the mobile counterpart of the
                    entry in the desktop account menu. */}
                {isAdmin && (
                  <li>
                    <Link
                      href="/ai-integration"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`
                        flex items-center gap-4 py-4 px-4 rounded-lg transition-colors
                        ${
                          pathname.startsWith("/ai-integration")
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted"
                        }
                      `}
                    >
                      <Sparkles
                        className={`h-6 w-6 ${pathname.startsWith("/ai-integration") ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="text-lg font-medium">
                        AI Integration
                      </span>
                    </Link>
                  </li>
                )}

                {/* Settings for admins */}
                {isAdmin && (
                  <li>
                    <Link
                      href="/settings"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`
                        flex items-center gap-4 py-4 px-4 rounded-lg transition-colors
                        ${
                          pathname === "/settings"
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted"
                        }
                      `}
                    >
                      <Settings
                        className={`h-6 w-6 ${pathname === "/settings" ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="text-lg font-medium">Settings</span>
                    </Link>
                  </li>
                )}

                {/* Security for admins */}
                {isAdmin && (
                  <li>
                    <Link
                      href="/admin/security"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`
                        flex items-center gap-4 py-4 px-4 rounded-lg transition-colors
                        ${
                          pathname === "/admin/security"
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted"
                        }
                      `}
                    >
                      <ShieldAlert
                        className={`h-6 w-6 ${pathname === "/admin/security" ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="text-lg font-medium">Security</span>
                    </Link>
                  </li>
                )}

                {/* Logout */}
                <li>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-4 py-4 px-4 rounded-lg transition-colors text-red-600 hover:bg-red-50 w-full"
                  >
                    <LogOut className="h-6 w-6" />
                    <span className="text-lg font-medium">Logout</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Support failure notice. The SDK must never break the host page, but it
          must not fail silently either — a button that does nothing is the
          hardest kind of bug to report. Styled (not a native alert) per the UI
          rules, solid red, above the sidebar's z-50, and pinned bottom-right to
          match the toast on /profile. Stays inset from both edges on mobile so
          it can't run off-screen. */}
      <div
        className={`fixed bottom-4 right-4 left-4 md:left-auto md:max-w-sm z-[100] transition-all duration-300 ease-out ${
          supportErrorVisible && supportError
            ? "translate-y-0 opacity-100"
            : "translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
        {supportError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg bg-red-600 px-4 py-3 text-white shadow-lg"
          >
            <span className="text-sm font-medium flex-1">{supportError}</span>
            <button
              type="button"
              onClick={dismissSupportError}
              aria-label="Dismiss"
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
