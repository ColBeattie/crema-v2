import { NextRequest, NextResponse } from "next/server";

// Clears this caller's own Supabase auth cookies. Operates only on the cookies
// present on the incoming request (it can't affect anyone else), so it's safe
// to expose without auth. The real SSR cookie names are dynamic
// (`sb-<project-ref>-auth-token`, optionally chunked with `.0`, `.1`, …), so we
// match by prefix/substring rather than a hardcoded legacy list.
export async function GET(request: NextRequest) {
  const response = NextResponse.json({ message: "Cookies cleared" });

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") || cookie.name.includes("supabase")) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}
