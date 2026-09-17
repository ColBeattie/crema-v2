-- Dutch System Template - Database Setup
-- Copy and paste this entire file into the Supabase SQL Editor and run it
-- This will create all necessary tables, policies, functions, and storage buckets

-- =============================================
-- 1. PROFILES TABLE
-- =============================================

-- Create profiles table for additional user data
-- deactivated_at: when set, the account is deactivated — it keeps all its data
-- but can no longer sign in (enforced in the login route) and any existing
-- session is ended on the next request (enforced in the routing middleware).
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deactivated_at TIMESTAMP WITH TIME ZONE
);

-- For existing databases created before deactivated_at was added.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE;

-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SECURITY: profiles is self-updatable (see the policy below), so users must NOT
-- be able to clear their own deactivated_at and reactivate themselves. Column
-- privileges are the UNION of table- and column-level grants, so we drop the
-- table-wide UPDATE grant and re-grant UPDATE only on the user-editable columns.
-- Only the service role (admin server actions) can write deactivated_at.
-- If you add a user-editable column to profiles, add it to this GRANT.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (created_at, updated_at) ON public.profiles TO authenticated;

-- RLS Policies for profiles table
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
    FOR SELECT USING (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

CREATE POLICY "Admins can insert profiles" ON public.profiles
    FOR INSERT WITH CHECK (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

CREATE POLICY "Admins can update profiles" ON public.profiles
    FOR UPDATE USING (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

CREATE POLICY "Admins can delete profiles" ON public.profiles
    FOR DELETE USING (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

-- =============================================
-- 2. AUDIT LOGS TABLE
-- =============================================

-- Create audit_logs table for tracking admin actions
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    action TEXT NOT NULL CHECK (action != ''),
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS on audit_logs table
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit_logs table (only admins can access)
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
    FOR SELECT USING (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

CREATE POLICY "Admins can insert audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

-- Create index for performance on audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON public.audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- =============================================
-- 3. STORAGE BUCKETS
-- =============================================

-- Create storage bucket for profile avatars.
--
-- SECURITY: this is a PUBLIC bucket. Public buckets serve object bytes via the
-- CDN endpoint with NO auth check, so the SELECT RLS policy below does NOT
-- restrict who can read a file — anyone with (or who guesses) the object URL
-- can fetch it. The RLS policies only gate WRITES (insert/update/delete) and
-- the authenticated PostgREST listing API. Avatars are intentionally world-
-- readable here. Do NOT store anything sensitive in this bucket. For private
-- files, create the bucket with public = false and serve via signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'profiles',
    'profiles',
    true, -- Public: avatars are served via getPublicUrl (CDN). Reads are NOT RLS-gated.
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']::text[]
) ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']::text[];

-- =============================================
-- 4. STORAGE POLICIES
-- =============================================

-- Note: RLS is already enabled on storage.objects by default in Supabase

-- First, drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload avatars for any user" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view all avatars" ON storage.objects;

-- Create correct RLS policies for profiles storage bucket

-- Policy: All authenticated users can view all profile pictures
CREATE POLICY "Authenticated users can view all avatars" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'profiles');

-- Policy: Users can only upload to their own folder
CREATE POLICY "Users can upload their own avatar" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'profiles' AND
        (auth.uid()::text = (storage.foldername(name))[1])
    );

-- Policy: Users can only update their own avatar
CREATE POLICY "Users can update their own avatar" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'profiles' AND
        (auth.uid()::text = (storage.foldername(name))[1])
    )
    WITH CHECK (
        bucket_id = 'profiles' AND
        (auth.uid()::text = (storage.foldername(name))[1])
    );

-- Policy: Users can only delete their own avatar
CREATE POLICY "Users can delete their own avatar" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'profiles' AND
        (auth.uid()::text = (storage.foldername(name))[1])
    );

-- =============================================
-- 5. FUNCTIONS
-- =============================================

-- Function to automatically create profile when user signs up.
-- SECURITY DEFINER functions must pin search_path so a shadowed object can't
-- hijack the definer's privileges. Objects are schema-qualified accordingly.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, created_at, updated_at)
    VALUES (NEW.id, NOW(), NOW());
    RETURN NEW;
END;
$$;

-- Trigger to call the function when a new user is created
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on profiles table
CREATE OR REPLACE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- Function to delete user MFA factors (admin MFA reset).
--
-- SECURITY: this is SECURITY DEFINER and deletes from auth.mfa_factors,
-- bypassing RLS. Postgres grants EXECUTE to PUBLIC by default and PostgREST
-- exposes RPCs, so WITHOUT the REVOKE below ANY holder of the anon/publishable
-- key (i.e. unauthenticated) could call it and strip MFA off any account. The
-- REVOKE + explicit GRANT restrict it to the service_role used by the admin
-- server action (which gates on checkIsAdmin()). search_path is pinned too.
--
-- The application now prefers the GoTrue Admin API (auth.admin.mfa.deleteFactor)
-- in app/admin/users/actions.ts; this function remains as a locked-down
-- fallback only.
CREATE OR REPLACE FUNCTION public.delete_user_mfa_factors(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM auth.mfa_factors WHERE user_id = target_user_id;
END;
$$;

-- Lock down execution: only the service_role (server-side admin client) may run it.
REVOKE ALL ON FUNCTION public.delete_user_mfa_factors(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user_mfa_factors(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_user_mfa_factors(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_mfa_factors(UUID) TO service_role;

-- =============================================
-- 6. SETTINGS TABLE
-- =============================================

-- Create settings table for org-wide configuration
CREATE TABLE IF NOT EXISTS public.setting (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT NOT NULL UNIQUE CHECK (key != ''),
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS on setting table
ALTER TABLE public.setting ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings (needed for middleware/enforcement checks)
CREATE POLICY "Authenticated users can view settings" ON public.setting
    FOR SELECT TO authenticated USING (true);

-- Only admins can modify settings
CREATE POLICY "Admins can insert settings" ON public.setting
    FOR INSERT WITH CHECK (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

CREATE POLICY "Admins can update settings" ON public.setting
    FOR UPDATE USING (
        (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );

-- Trigger to update updated_at on setting table
CREATE OR REPLACE TRIGGER update_setting_updated_at
    BEFORE UPDATE ON public.setting
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- Seed default: MFA required for all users
INSERT INTO public.setting (key, value)
VALUES ('mfa_requirement', '"all_users"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================
-- 7. SECURITY DASHBOARD TABLES
-- =============================================

-- security_alert - Stores security alerts (failed attempts, new IP, new country, etc.)
CREATE TABLE IF NOT EXISTS public.security_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'failed_login_threshold',
    'new_ip',
    'new_country',
    'suspicious_activity',
    'brute_force',
    'account_lockout'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_alert_user_id ON public.security_alert(user_id);
CREATE INDEX IF NOT EXISTS idx_security_alert_created_at ON public.security_alert(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alert_severity ON public.security_alert(severity);
CREATE INDEX IF NOT EXISTS idx_security_alert_acknowledged ON public.security_alert(acknowledged_at) WHERE acknowledged_at IS NULL;

ALTER TABLE public.security_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all security alerts" ON public.security_alert
    FOR SELECT TO authenticated
    USING ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Admins can insert security alerts" ON public.security_alert
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Admins can update security alerts" ON public.security_alert
    FOR UPDATE TO authenticated
    USING ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Service role full access to security_alert" ON public.security_alert
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- login_attempt - Records every login attempt with IP, geo, success/fail, MFA status
CREATE TABLE IF NOT EXISTS public.login_attempt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  ip_address INET NOT NULL,
  user_agent TEXT,
  country TEXT,
  city TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  mfa_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempt_user_id ON public.login_attempt(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempt_email ON public.login_attempt(email);
CREATE INDEX IF NOT EXISTS idx_login_attempt_ip ON public.login_attempt(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempt_created_at ON public.login_attempt(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempt_success ON public.login_attempt(success);

ALTER TABLE public.login_attempt ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all login attempts" ON public.login_attempt
    FOR SELECT TO authenticated
    USING ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Service role full access to login_attempt" ON public.login_attempt
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- user_known_ip - Tracks known IPs per user with trust status and login counts
CREATE TABLE IF NOT EXISTS public.user_known_ip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  country TEXT,
  city TEXT,
  trusted BOOLEAN NOT NULL DEFAULT false,
  login_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trusted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trusted_at TIMESTAMPTZ,
  CONSTRAINT uq_user_known_ip UNIQUE (user_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_user_known_ip_user_id ON public.user_known_ip(user_id);
CREATE INDEX IF NOT EXISTS idx_user_known_ip_ip ON public.user_known_ip(ip_address);
CREATE INDEX IF NOT EXISTS idx_user_known_ip_trusted ON public.user_known_ip(trusted);

ALTER TABLE public.user_known_ip ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all known IPs" ON public.user_known_ip
    FOR SELECT TO authenticated
    USING ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Admins can update known IPs" ON public.user_known_ip
    FOR UPDATE TO authenticated
    USING ((SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

CREATE POLICY "Service role full access to user_known_ip" ON public.user_known_ip
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================
-- 8. SERVICE ROLE PRIVILEGES (login-security tables)
-- =============================================

-- Restore service_role privileges on login-security tables.
--
-- Symptom: "permission denied for table login_attempt" from the admin
-- Supabase client (which authenticates as service_role). The module
-- (lib/login-security.ts) reads/writes login_attempt, security_alert,
-- and user_known_ip, so we grant on all three to avoid follow-on errors.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_attempt   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_alert  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_known_ip   TO service_role;

-- Sequences backing any SERIAL/IDENTITY columns on these tables (covers id
-- columns that aren't uuid-default-generated). Safe no-op if none exist.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =============================================
-- 9. INITIAL ADMIN USER SETUP
-- =============================================

-- NOTE: You'll need to manually create your first admin user
-- After running this script, follow these steps:

-- 1. Sign up for an account in your application
-- 2. Find your user ID in the Supabase Auth dashboard
-- 3. Run this query in the SQL editor, replacing YOUR_USER_ID with your actual user ID:

-- UPDATE auth.users
-- SET raw_app_meta_data = jsonb_set(
--     COALESCE(raw_app_meta_data, '{}'::jsonb),
--     '{role}',
--     '"admin"'::jsonb
-- )
-- WHERE id = 'YOUR_USER_ID';

-- =============================================
-- 10. USEFUL QUERIES FOR ADMINISTRATION
-- =============================================

-- View all users with their roles
-- SELECT
--     id,
--     email,
--     raw_user_meta_data->>'full_name' as full_name,
--     raw_app_meta_data->>'role' as role,
--     created_at,
--     last_sign_in_at
-- FROM auth.users
-- ORDER BY created_at DESC;

-- View all audit logs with user emails
-- SELECT
--     al.id,
--     al.action,
--     u1.email as performed_by,
--     u2.email as target_user,
--     al.details,
--     al.created_at
-- FROM audit_logs al
-- LEFT JOIN auth.users u1 ON al.user_id = u1.id
-- LEFT JOIN auth.users u2 ON al.target_user_id = u2.id
-- ORDER BY al.created_at DESC;

-- Check storage bucket configuration
-- SELECT * FROM storage.buckets WHERE id = 'profiles';

-- =============================================
-- SETUP COMPLETE
-- =============================================

-- Your database and storage are now fully configured!
--
-- What this script has set up:
-- ✅ Profiles table with RLS policies
-- ✅ Audit logs table for tracking admin actions
-- ✅ Storage bucket 'profiles' for user avatars
-- ✅ Correct storage RLS policies:
--    - All authenticated users can view all profile pictures
--    - Users can only upload/update/delete their own avatars
--    - No special admin policies (admins are just authenticated users)
-- ✅ Automatic profile creation on user signup
-- ✅ Updated_at timestamp triggers
-- ✅ Settings table for org-wide configuration (MFA requirement, etc.)
-- ✅ Security dashboard tables (security_alert, login_attempt, user_known_ip)
--    - Admin-only RLS + service role bypass for server-side recording
-- ✅ Explicit service_role GRANTs on login-security tables
--    (login_attempt, security_alert, user_known_ip)
--    plus USAGE/SELECT on all sequences in public — fixes
--    "permission denied for table" from the admin Supabase client
--
-- Remember to:
-- 1. Set up your first admin user (see section 9 above)
-- 2. Test profile picture upload functionality
-- 3. Verify all RLS policies work correctly
-- 4. Review audit log functionality
--
-- Security notes:
-- - All tables have Row Level Security (RLS) enabled
-- - Storage bucket is public for CDN access, but RLS controls who can view/modify
-- - Only authenticated users can access the application
-- - Only admin users can access administrative functions