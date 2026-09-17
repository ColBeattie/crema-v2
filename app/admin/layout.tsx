import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Admin routes are per-request auth-gated (cookies + getUser) and must never be
// statically prerendered at build time. Forcing dynamic rendering prevents Next
// from attempting a static shell, which otherwise crashes when the Supabase
// client is constructed during the prerender pass.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Check if user is authenticated
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  // Check if user has admin role from app_metadata
  if (user.app_metadata?.role !== "admin") {
    redirect("/");
  }

  return <>{children}</>;
}
