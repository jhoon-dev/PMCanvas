ALTER TABLE pm_approval_notifications ADD COLUMN kind text NOT NULL DEFAULT 'approval' CHECK (kind IN ('approval','review'));
ALTER TABLE pm_approval_notifications ADD COLUMN recipient_id uuid REFERENCES pm_users(id) ON DELETE CASCADE;
UPDATE pm_approval_notifications SET recipient_id=user_id;
ALTER TABLE pm_approval_notifications ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE pm_approval_notifications DROP CONSTRAINT pm_approval_notifications_pkey;
ALTER TABLE pm_approval_notifications ADD PRIMARY KEY (user_id,kind,recipient_id);
ALTER TABLE pm_approval_notifications ADD CONSTRAINT pm_notification_recipient CHECK (kind='review' OR recipient_id=user_id);

-- Include already verified applications still waiting for approval on upgrade.
INSERT INTO pm_approval_notifications(user_id,kind,recipient_id)
SELECT applicant.id,'review',admin.id FROM pm_users applicant CROSS JOIN pm_users admin
WHERE applicant.registration_pending AND applicant.email_verified_at IS NOT NULL AND admin.is_admin AND admin.is_active
ON CONFLICT DO NOTHING;
