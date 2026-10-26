CREATE TABLE pm_mail_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 config jsonb NOT NULL,
 password_encrypted text,
 revision integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES pm_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
