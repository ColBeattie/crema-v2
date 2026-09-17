import { createClient } from "@supabase/supabase-js";

// Admin client with secret key for user management.
// This must ONLY be used in server-side code.
//
// The secret key env var is intentionally NOT prefixed with NEXT_PUBLIC_ (which
// would inline it into the client bundle). It also avoids any NEXT_ prefix to
// remove the one-typo footgun. SUPABASE_SECRET_KEY is the canonical name;
// NEXT_SUPABASE_SECRET_KEY is still read as a fallback for older deployments.
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing Supabase admin credentials");
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      // Required for `auth.admin.passkey.*` (list/delete a user's passkeys).
      // Calling those methods without this flag throws.
      experimental: { passkey: true },
    },
  });
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string; // Role now comes from app_metadata
  created_at: string;
  last_sign_in_at?: string;
}

export interface UserProfile {
  id: string;
  // Role removed - now stored in auth.users.app_metadata
  created_at: string;
  updated_at: string;
  // Add any other app-specific fields here (avatar, preferences, etc.)
  avatar_url?: string;
  display_name?: string;
}
