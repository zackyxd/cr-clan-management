-- Drop all tables in the public schema
-- This is safe for development - use carefully!

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Permissions are automatically granted to the user running this script
