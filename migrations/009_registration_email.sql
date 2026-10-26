ALTER TABLE pm_users ADD COLUMN email_verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE pm_users ADD COLUMN email_verified_at timestamptz;
UPDATE pm_users SET email_verification_required=true WHERE registration_pending;
ALTER TABLE pm_users ADD CONSTRAINT pm_users_email_verification CHECK (
 NOT email_verification_required OR (local_login AND NOT is_admin AND (registration_pending OR email_verified_at IS NOT NULL))
);

CREATE TABLE pm_email_verifications (
 user_id uuid PRIMARY KEY REFERENCES pm_users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE pm_approval_notifications (
 user_id uuid PRIMARY KEY REFERENCES pm_users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 lease uuid,
 available_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_approval_notifications_pending ON pm_approval_notifications(available_at) WHERE state IN ('pending','sending');
