-- Run as the auth schema owner (or database administrator), after Auth migrations.
-- The backend's dedicated login can inspect only current session identifiers.
CREATE SCHEMA IF NOT EXISTS ridr_auth;
REVOKE ALL ON SCHEMA ridr_auth FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE VIEW ridr_auth.active_sessions WITH (security_barrier = true) AS
  SELECT s.id AS session_id, s.user_id
  FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND (s.not_after IS NULL OR s.not_after > now())
    AND NOT u.is_anonymous;
REVOKE ALL ON ridr_auth.active_sessions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ridr_auth TO ridr_auth_reader;
GRANT SELECT ON ridr_auth.active_sessions TO ridr_auth_reader;
