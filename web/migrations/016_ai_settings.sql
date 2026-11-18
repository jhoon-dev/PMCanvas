CREATE TABLE pm_ai_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 model text NOT NULL,
 api_key_encrypted text,
 revision integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES pm_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
