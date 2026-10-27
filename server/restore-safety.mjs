// Shared by the operator restore command and the isolated recovery rehearsal.
export const restoreCleanupSql =
  "DO $restore$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['pm_sessions','pm_auth_transient','pm_auth_attempts','pm_password_resets','pm_email_verifications'] LOOP IF to_regclass(t) IS NOT NULL THEN EXECUTE format('TRUNCATE %I',t); END IF; END LOOP; IF to_regclass('pm_admin_mfa') IS NOT NULL THEN EXECUTE 'UPDATE pm_admin_mfa SET recovery_hashes=ARRAY[]::text[]'; END IF; END $restore$;";
