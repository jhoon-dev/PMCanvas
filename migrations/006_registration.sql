ALTER TABLE pm_users ADD COLUMN registration_pending boolean NOT NULL DEFAULT false;
ALTER TABLE pm_users ADD CONSTRAINT pm_users_registration_state
 CHECK (NOT registration_pending OR (NOT is_active AND NOT is_admin AND local_login));
