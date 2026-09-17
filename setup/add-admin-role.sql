-- Update user's raw_app_meta_data to add admin role
-- Replace 'YOUR_USER_ID' with your actual user ID from the auth.users table

-- First, find your user ID (if you don't know it)
-- You can run this query to list all users and their emails:
SELECT id, email, raw_app_meta_data
FROM auth.users;

-- Then update the specific user with admin role
-- Replace the UUID below with your actual user ID
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
    COALESCE(raw_app_meta_data, '{}'::jsonb),
    '{role}',
    '"admin"'
)
WHERE id = 'YOUR_USER_ID';

-- Verify the update
SELECT id, email, raw_app_meta_data
FROM auth.users
WHERE id = 'YOUR_USER_ID';