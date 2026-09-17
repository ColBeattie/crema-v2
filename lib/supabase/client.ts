import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Passkey support is still experimental in supabase-js and has to be
      // opted into explicitly. Without this, auth.registerPasskey /
      // auth.signInWithPasskey / auth.passkey.* are not available.
      auth: {
        experimental: { passkey: true },
      },
      cookies: {
        get(name: string) {
          // Check if running in browser
          if (typeof document === "undefined") {
            return undefined;
          }
          // Get cookie value from document.cookie
          const cookies = document.cookie.split("; ");
          const cookie = cookies.find((c) => c.startsWith(`${name}=`));
          return cookie ? decodeURIComponent(cookie.split("=")[1]) : undefined;
        },
        set(name: string, value: string, options?: any) {
          // Check if running in browser
          if (typeof document === "undefined") {
            return;
          }
          // Set cookie with size-conscious options
          const maxAge = options?.maxAge ?? 60 * 60 * 24 * 7; // 7 days
          const path = options?.path ?? "/";
          const sameSite = options?.sameSite ?? "lax";
          const secure =
            typeof window !== "undefined" &&
            window.location.protocol === "https:";

          // Only set non-empty values
          if (value && value.length > 0) {
            document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
          }
        },
        remove(name: string, options?: any) {
          // Check if running in browser
          if (typeof document === "undefined") {
            return;
          }
          // Remove cookie by setting Max-Age to 0
          const path = options?.path ?? "/";
          document.cookie = `${name}=; Max-Age=0; Path=${path}`;
        },
      },
    }
  );
}
