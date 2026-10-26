ALTER TABLE pm_users ADD COLUMN registration_rejected boolean NOT NULL DEFAULT false;
ALTER TABLE pm_users ADD COLUMN rejection_reason text NOT NULL DEFAULT '' CHECK (length(rejection_reason)<=500);
ALTER TABLE pm_users DROP CONSTRAINT pm_users_email_verification;
ALTER TABLE pm_users ADD CONSTRAINT pm_users_email_verification CHECK (
 NOT email_verification_required OR (local_login AND NOT is_admin AND (registration_pending OR registration_rejected OR email_verified_at IS NOT NULL))
);
ALTER TABLE pm_users ADD CONSTRAINT pm_registration_rejected CHECK (NOT registration_rejected OR (NOT registration_pending AND NOT is_active AND NOT is_admin AND local_login));
ALTER TABLE pm_projects ADD COLUMN deleted_at timestamptz;
CREATE TABLE pm_member_accounts (
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 member_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES pm_users(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,member_id), UNIQUE(project_id,user_id)
);
CREATE INDEX pm_member_accounts_user ON pm_member_accounts(user_id);
CREATE TABLE pm_deleted_tasks (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
 document jsonb NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),
 deleted_by uuid REFERENCES pm_users(id) ON DELETE SET NULL
);
CREATE INDEX pm_deleted_tasks_project ON pm_deleted_tasks(project_id,deleted_at);
CREATE TABLE pm_backup_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT true,
 hour integer NOT NULL DEFAULT 3 CHECK (hour BETWEEN 0 AND 23),
 retention_days integer NOT NULL DEFAULT 14 CHECK (retention_days BETWEEN 1 AND 365),
 verify_restore boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 0,
 next_run_at timestamptz NOT NULL DEFAULT now(),
 requested boolean NOT NULL DEFAULT false,
 lease_id uuid, lease_until timestamptz, worker_seen_at timestamptz,
 updated_by uuid REFERENCES pm_users(id) ON DELETE SET NULL
);
INSERT INTO pm_backup_settings(id) VALUES(true);
CREATE TABLE pm_backup_runs (
 id uuid PRIMARY KEY,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 state text NOT NULL CHECK (state IN ('running','success','failed')),
 filename text, bytes bigint, verified boolean NOT NULL DEFAULT false,
 message text NOT NULL DEFAULT ''
);
