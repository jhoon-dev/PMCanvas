ALTER TABLE pm_users ADD COLUMN local_login boolean NOT NULL DEFAULT true;
CREATE TABLE pm_external_identities (
 provider_key text NOT NULL,
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 1024),
 user_id uuid NOT NULL REFERENCES pm_users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider_key,subject)
);
CREATE INDEX ON pm_external_identities(user_id);
CREATE TABLE pm_auth_transient (
 key text PRIMARY KEY,
 value jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX ON pm_auth_transient(expires_at);
