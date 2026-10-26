CREATE TABLE pm_auth_attempts(key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX ON pm_auth_attempts(expires_at);
CREATE TABLE pm_admin_mfa(user_id uuid PRIMARY KEY REFERENCES pm_users(id) ON DELETE CASCADE, secret text NOT NULL, recovery_hashes text[] NOT NULL, last_step bigint NOT NULL DEFAULT -1);
CREATE TABLE pm_security_events(id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid, kind text NOT NULL, ip_hash text, details jsonb NOT NULL DEFAULT '{}');
CREATE INDEX ON pm_security_events(at);

-- Existing administrator sessions must enroll in MFA after this update.
DELETE FROM pm_sessions WHERE user_id IN (SELECT id FROM pm_users WHERE is_admin);
