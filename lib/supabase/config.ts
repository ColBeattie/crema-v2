export function validateEnvVars() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return {
      isValid: false,
      error:
        "Supabase environment variables are not configured. Please check SETUP.md for instructions.",
    };
  }

  // Check if the URL is a valid URL (not the placeholder)
  if (url === "your_supabase_project_url" || !url.includes("supabase.co")) {
    return {
      isValid: false,
      error:
        "Please replace the placeholder Supabase URL with your actual project URL.",
    };
  }

  // Check if the publishable key is valid (supports both old JWT and new key formats)
  if (
    publishableKey === "your_supabase_publishable_key" ||
    publishableKey === "your-publishable-key-here" ||
    (!publishableKey.startsWith("eyJ") &&
      !publishableKey.startsWith("sb_publishable_"))
  ) {
    return {
      isValid: false,
      error:
        "Please replace the placeholder Supabase publishable key with your actual project key.",
    };
  }

  try {
    new URL(url);
  } catch {
    return {
      isValid: false,
      error:
        "Invalid Supabase URL format. Please check your NEXT_PUBLIC_SUPABASE_URL.",
    };
  }

  return { isValid: true, error: null };
}
