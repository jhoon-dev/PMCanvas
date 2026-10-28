CREATE TABLE pm_password_resets (
 user_id uuid PRIMARY KEY REFERENCES pm_users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX ON pm_password_resets(expires_at);
