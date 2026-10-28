ALTER TABLE pm_approval_notifications ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE pm_approval_notifications ADD COLUMN recipient_email text;
ALTER TABLE pm_approval_notifications DROP CONSTRAINT pm_approval_notifications_pkey;
ALTER TABLE pm_approval_notifications ALTER COLUMN recipient_id DROP NOT NULL;
ALTER TABLE pm_approval_notifications ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX pm_notification_user_recipient ON pm_approval_notifications(user_id,kind,recipient_id) WHERE recipient_id IS NOT NULL;
CREATE UNIQUE INDEX pm_notification_email_recipient ON pm_approval_notifications(user_id,kind,recipient_email) WHERE recipient_email IS NOT NULL;
ALTER TABLE pm_approval_notifications DROP CONSTRAINT pm_notification_recipient;
ALTER TABLE pm_approval_notifications ADD CONSTRAINT pm_notification_recipient CHECK (
 (recipient_id IS NOT NULL AND recipient_email IS NULL AND (kind='review' OR recipient_id=user_id)) OR
 (kind='review' AND recipient_id IS NULL AND recipient_email IS NOT NULL AND length(recipient_email) BETWEEN 3 AND 254)
);
ALTER TABLE pm_approval_notifications DROP CONSTRAINT pm_approval_notifications_state_check;
ALTER TABLE pm_approval_notifications ADD CONSTRAINT pm_approval_notifications_state_check CHECK (state IN ('pending','sending','sent','failed','cancelled'));
