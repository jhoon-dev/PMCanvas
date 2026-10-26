import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fail } from './errors.mjs';
import { digest } from './security.mjs';
import { cleanProject, projectChanges } from './project.mjs';
import { WorkspaceOperations } from './workspace-operations.mjs';
import { reviewRecipients } from './mail-settings.mjs';
import { migrationFiles } from './migrations.mjs';
export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isAdmin: !!u.is_admin,
  isActive: u.is_active !== false,
  localLogin: u.local_login !== false,
  registrationPending: !!u.registration_pending,
  emailVerified: !!u.email_verified_at,
  approvalMailStatus: u.approval_mail_status || null,
  reviewMailStatus: u.review_mail_status || null,
  registrationRejected: !!u.registration_rejected,
  rejectionReason: u.rejection_reason || '',
});

export { createPool } from './pg-pool.mjs';
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(726534001)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS pm_schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const { version, file } of migrationFiles()) {
      const { rows } = await client.query(
        'SELECT version FROM pm_schema_migrations WHERE version=$1',
        [version],
      );
      if (!rows.length) {
        await client.query(fs.readFileSync(file, 'utf8'));
        await client.query('INSERT INTO pm_schema_migrations(version) VALUES ($1)', [version]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export class PgRepository extends WorkspaceOperations {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  async transaction(fn, readOnly = false) {
    const c = await this.pool.connect();
    try {
      await c.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const value = await fn(c);
      await c.query('COMMIT');
      return value;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
  async reserveAttempt(key, limit, windowMs) {
    await this.pool.query('DELETE FROM pm_auth_attempts WHERE expires_at<now()');
    const { rowCount } = await this.pool.query(
      "INSERT INTO pm_auth_attempts(key,attempts,expires_at) VALUES ($1,1,now()+$3*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET attempts=pm_auth_attempts.attempts+1 WHERE pm_auth_attempts.attempts<$2 RETURNING key",
      [key, limit, windowMs],
    );
    if (!rowCount) fail(429, 'RATE_LIMIT', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  async clearAttempt(key) {
    await this.pool.query('DELETE FROM pm_auth_attempts WHERE key=$1', [key]);
  }
  async upgradeHash(id, oldHash, newHash) {
    const r = await this.pool.query(
      'UPDATE pm_users SET password_hash=$3 WHERE id=$1 AND password_hash=$2 AND is_active AND local_login RETURNING id',
      [id, oldHash, newHash],
    );
    if (!r.rowCount) fail(401, 'LOGIN_FAILED', '계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
  }
  async securityEvent({ actorId = null, kind, ip = null, details = {} }) {
    await this.pool.query("DELETE FROM pm_security_events WHERE at<now()-interval '90 days'");
    await this.pool.query(
      'INSERT INTO pm_security_events(actor_id,kind,ip_hash,details) VALUES ($1,$2,$3,$4::jsonb)',
      [actorId, kind, ip, JSON.stringify(details)],
    );
  }
  async securityEvents() {
    return (
      await this.pool.query(
        'SELECT id::text,at,actor_id AS "actorId",kind,ip_hash AS "ipHash",details FROM pm_security_events ORDER BY id DESC LIMIT 200',
      )
    ).rows;
  }
  async getMfa(id) {
    return (
      (await this.pool.query('SELECT * FROM pm_admin_mfa WHERE user_id=$1', [id])).rows[0] || null
    );
  }
  async reserveMfaChallenge(key) {
    return (
      (
        await this.pool.query(
          "UPDATE pm_auth_transient SET value=jsonb_set(value,'{attempts}',to_jsonb((value->>'attempts')::int+1)) WHERE key=$1 AND expires_at>now() AND (value->>'attempts')::int<5 RETURNING value",
          [key],
        )
      ).rows[0]?.value ?? null
    );
  }
  async completeMfa({ key, userId, passwordHash, step, recoveryHash, enrollment }) {
    return this.transaction(async (c) => {
      const user = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR UPDATE', [userId]))
        .rows[0];
      if (!user?.is_admin || !user.is_active || user.password_hash !== passwordHash)
        fail(401, 'MFA_EXPIRED', '계정 정보가 변경되었습니다.');
      const challenge = await c.query(
        'DELETE FROM pm_auth_transient WHERE key=$1 AND expires_at>now() RETURNING key',
        [key],
      );
      if (!challenge.rowCount) fail(401, 'MFA_EXPIRED', '인증 요청이 만료되었습니다.');
      let result;
      if (enrollment)
        result = await c.query(
          'INSERT INTO pm_admin_mfa(user_id,secret,recovery_hashes,last_step) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING RETURNING user_id',
          [userId, enrollment.secret, enrollment.recoveryHashes, step],
        );
      else if (step != null)
        result = await c.query(
          'UPDATE pm_admin_mfa SET last_step=$2 WHERE user_id=$1 AND last_step<$2 RETURNING user_id',
          [userId, step],
        );
      else
        result = await c.query(
          'UPDATE pm_admin_mfa SET recovery_hashes=array_remove(recovery_hashes,$2) WHERE user_id=$1 AND $2=ANY(recovery_hashes) RETURNING user_id',
          [userId, recoveryHash],
        );
      if (!result.rowCount)
        fail(
          401,
          'MFA_REPLAY',
          '이미 사용했거나 유효하지 않은 인증 코드입니다. 다음 코드를 사용해 주세요.',
        );
    });
  }
  async health() {
    await this.pool.query('SELECT 1');
  }
  async findUserByEmail(email) {
    return (
      (await this.pool.query('SELECT * FROM pm_users WHERE email=$1', [email])).rows[0] || null
    );
  }
  async countUsers() {
    return Number((await this.pool.query('SELECT count(*) AS n FROM pm_users')).rows[0].n);
  }
  async createUser({ email, name, passwordHash, isAdmin = false, registrationPending = false }) {
    try {
      const { rows } = await this.pool.query(
        'INSERT INTO pm_users(id,email,name,password_hash,is_admin,is_active,registration_pending,email_verification_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',
        [
          randomUUID(),
          email,
          name,
          passwordHash,
          isAdmin,
          !registrationPending,
          registrationPending,
        ],
      );
      return publicUser(rows[0]);
    } catch (error) {
      if (error.code === '23505') fail(409, 'EMAIL_EXISTS', '이미 등록된 이메일입니다.');
      throw error;
    }
  }
  async listUsers() {
    return (
      await this.pool.query(
        "SELECT u.id,u.email,u.name,u.is_admin,u.is_active,u.local_login,u.registration_pending,u.registration_rejected,u.rejection_reason,u.email_verified_at,n.state AS approval_mail_status,(SELECT r.state FROM pm_approval_notifications r LEFT JOIN pm_users a ON a.id=r.recipient_id WHERE r.user_id=u.id AND r.kind='review' AND r.state<>'cancelled' AND (r.recipient_email IS NOT NULL OR (a.is_admin AND a.is_active)) ORDER BY CASE WHEN r.state IN ('pending','sending') THEN 0 WHEN r.state='failed' THEN 1 ELSE 2 END LIMIT 1) AS review_mail_status FROM pm_users u LEFT JOIN pm_approval_notifications n ON n.user_id=u.id AND n.kind='approval' ORDER BY u.registration_pending DESC,u.created_at",
      )
    ).rows.map(publicUser);
  }
  async createSession({ hash, userId, csrf, expires, passwordHash }) {
    return this.transaction(async (c) => {
      const user = (
        await c.query(
          'SELECT password_hash,is_active,local_login FROM pm_users WHERE id=$1 FOR UPDATE',
          [userId],
        )
      ).rows[0];
      if (!user?.is_active || !user.local_login || user.password_hash !== passwordHash)
        fail(401, 'LOGIN_FAILED', '계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
      await c.query('DELETE FROM pm_sessions WHERE expires_at<now()');
      await c.query(
        'INSERT INTO pm_sessions(token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)',
        [hash, userId, csrf, expires],
      );
    });
  }
  async findSession(hash) {
    const { rows } = await this.pool.query(
      'SELECT u.*,s.csrf_token FROM pm_sessions s JOIN pm_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active',
      [hash],
    );
    return rows[0] ? { user: publicUser(rows[0]), csrf: rows[0].csrf_token } : null;
  }
  async deleteSession(hash) {
    await this.pool.query('DELETE FROM pm_sessions WHERE token_hash=$1', [hash]);
  }
  async changePassword(userId, expectedHash, passwordHash) {
    return this.transaction(async (c) => {
      const result = await c.query(
        'UPDATE pm_users SET password_hash=$3 WHERE id=$1 AND password_hash=$2 AND is_active AND local_login RETURNING id',
        [userId, expectedHash, passwordHash],
      );
      if (!result.rowCount)
        fail(409, 'ACCOUNT_CHANGED', '계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [userId]);
      await c.query('DELETE FROM pm_password_resets WHERE user_id=$1', [userId]);
      return { ok: true };
    });
  }
  async manageUser(actorId, targetId, { isActive, passwordHash }) {
    return this.transaction(async (c) => {
      const actor = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [
          actorId,
        ])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active)
        fail(403, 'FORBIDDEN', '관리자만 계정을 관리할 수 있습니다.');
      const target = (
        await c.query('SELECT * FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [targetId])
      ).rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND', '계정을 찾을 수 없습니다.');
      if (target.is_admin || actorId === targetId)
        fail(403, 'ADMIN_PROTECTED', '관리자 계정은 본인의 비밀번호 변경만 가능합니다.');
      if (passwordHash && !target.local_login)
        fail(400, 'EXTERNAL_PASSWORD', '외부 인증 계정의 비밀번호는 인증 서버에서 변경해 주세요.');
      if (isActive === true && target.registration_rejected)
        fail(409, 'REGISTRATION_REJECTED', '거절된 가입 신청은 활성화할 수 없습니다.');
      if (isActive === true && target.registration_pending && !target.email_verified_at)
        fail(409, 'EMAIL_UNVERIFIED', '이메일 인증을 완료한 계정만 승인할 수 있습니다.');
      const approving = isActive === true && target.registration_pending;
      const { rows } = await c.query(
        'UPDATE pm_users SET is_active=COALESCE($2,is_active),registration_pending=CASE WHEN $2 THEN false ELSE registration_pending END,password_hash=COALESCE($3,password_hash) WHERE id=$1 RETURNING *',
        [targetId, isActive ?? null, passwordHash ?? null],
      );
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [targetId]);
      if (passwordHash || isActive === false)
        await c.query('DELETE FROM pm_password_resets WHERE user_id=$1', [targetId]);
      if (approving) {
        await c.query(
          'INSERT INTO pm_approval_notifications(user_id,recipient_id) VALUES ($1,$1) ON CONFLICT DO NOTHING',
          [targetId],
        );
        rows[0].approval_mail_status = 'pending';
      }
      return publicUser(rows[0]);
    });
  }
  async issueEmailVerification({ userId, passwordHash, hash, expires }) {
    return this.transaction(async (c) => {
      const u = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (
        !u?.registration_pending ||
        !u.local_login ||
        u.email_verified_at ||
        u.password_hash !== passwordHash
      )
        return false;
      await c.query('DELETE FROM pm_email_verifications WHERE expires_at<now()');
      await c.query(
        'INSERT INTO pm_email_verifications(user_id,token_hash,password_hash,expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,password_hash=$3,expires_at=$4',
        [userId, hash, passwordHash, expires],
      );
      return true;
    });
  }
  async revokeEmailVerification(hash) {
    await this.pool.query('DELETE FROM pm_email_verifications WHERE token_hash=$1', [hash]);
  }
  async consumeEmailVerification(
    hash,
    { passwordHash, name, reviewRecipients: fallbackRecipients = [] },
  ) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(726534011)');
      const invalid = () =>
        fail(
          400,
          'VERIFICATION_INVALID',
          '유효하지 않거나 만료된 링크입니다. 인증 메일을 다시 요청해 주세요.',
        );
      const entry = (
        await c.query(
          'SELECT user_id FROM pm_email_verifications WHERE token_hash=$1 AND expires_at>now()',
          [hash],
        )
      ).rows[0];
      if (!entry) invalid();
      const u = (
        await c.query('SELECT * FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [entry.user_id])
      ).rows[0];
      const proof = (
        await c.query(
          'DELETE FROM pm_email_verifications WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() RETURNING password_hash',
          [entry.user_id, hash],
        )
      ).rows[0];
      if (
        !proof ||
        !u?.registration_pending ||
        !u.local_login ||
        u.email_verified_at ||
        proof.password_hash !== u.password_hash
      )
        invalid();
      // The mailbox owner chooses credentials, including after an unsolicited pre-registration.
      await c.query(
        'UPDATE pm_users SET email_verified_at=now(),password_hash=$2,name=$3 WHERE id=$1',
        [u.id, passwordHash, name],
      );
      await this.syncReviewNotifications(c, fallbackRecipients);
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [u.id]);
      await c.query('DELETE FROM pm_auth_attempts WHERE key=$1', [digest('local:' + u.email)]);
      return { id: u.id };
    });
  }
  async syncReviewNotifications(c, fallbackRecipients = []) {
    const saved = (await c.query('SELECT config FROM pm_mail_settings WHERE id=true')).rows[0];
    const recipients = reviewRecipients(saved ? saved.config.reviewRecipients : fallbackRecipients);
    await c.query(
      "UPDATE pm_approval_notifications n SET state='cancelled',lease=NULL,updated_at=now() WHERE n.kind='review' AND n.state IN ('pending','sending','failed') AND NOT ((cardinality($1::text[])>0 AND n.recipient_email IS NOT NULL AND n.recipient_email=ANY($1)) OR (cardinality($1::text[])=0 AND n.recipient_id IS NOT NULL AND EXISTS (SELECT 1 FROM pm_users a WHERE a.id=n.recipient_id AND a.is_admin AND a.is_active)))",
      [recipients],
    );
    if (recipients.length)
      await c.query(
        "INSERT INTO pm_approval_notifications(user_id,kind,recipient_email) SELECT u.id,'review',r.email FROM pm_users u CROSS JOIN unnest($1::text[]) AS r(email) WHERE u.registration_pending AND u.email_verified_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pm_approval_notifications d LEFT JOIN pm_users a ON a.id=d.recipient_id WHERE d.user_id=u.id AND d.kind='review' AND d.state='sent' AND COALESCE(d.recipient_email,a.email)=r.email) ON CONFLICT DO NOTHING",
        [recipients],
      );
    else
      await c.query(
        "INSERT INTO pm_approval_notifications(user_id,kind,recipient_id) SELECT u.id,'review',a.id FROM pm_users u CROSS JOIN pm_users a WHERE u.registration_pending AND u.email_verified_at IS NOT NULL AND a.is_admin AND a.is_active AND NOT EXISTS (SELECT 1 FROM pm_approval_notifications d LEFT JOIN pm_users da ON da.id=d.recipient_id WHERE d.user_id=u.id AND d.kind='review' AND d.state='sent' AND COALESCE(d.recipient_email,da.email)=a.email) ON CONFLICT DO NOTHING",
      );
    await c.query(
      "UPDATE pm_approval_notifications n SET state='pending',attempts=0,lease=NULL,available_at=now(),updated_at=now() WHERE n.kind='review' AND n.state='cancelled' AND NOT EXISTS (SELECT 1 FROM pm_approval_notifications d LEFT JOIN pm_users da ON da.id=d.recipient_id LEFT JOIN pm_users na ON na.id=n.recipient_id WHERE d.user_id=n.user_id AND d.kind='review' AND d.state='sent' AND COALESCE(d.recipient_email,da.email)=COALESCE(n.recipient_email,na.email)) AND EXISTS (SELECT 1 FROM pm_users u WHERE u.id=n.user_id AND u.registration_pending AND u.email_verified_at IS NOT NULL) AND ((cardinality($1::text[])>0 AND n.recipient_email IS NOT NULL AND n.recipient_email=ANY($1)) OR (cardinality($1::text[])=0 AND n.recipient_id IS NOT NULL AND EXISTS (SELECT 1 FROM pm_users a WHERE a.id=n.recipient_id AND a.is_admin AND a.is_active)))",
      [recipients],
    );
  }
  async claimApprovalNotification(fallbackRecipients = []) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(726534011)');
      await this.syncReviewNotifications(c, fallbackRecipients);
      const row = (
        await c.query(
          "SELECT n.id,n.user_id,n.kind,n.recipient_id,COALESCE(n.recipient_email,a.email) AS email,u.name AS applicant_name,u.email AS applicant_email FROM pm_approval_notifications n JOIN pm_users u ON u.id=n.user_id LEFT JOIN pm_users a ON a.id=n.recipient_id WHERE u.email_verified_at IS NOT NULL AND ((n.kind='approval' AND u.is_active AND NOT u.registration_pending AND a.is_active) OR (n.kind='review' AND u.registration_pending AND (n.recipient_email IS NOT NULL OR (a.is_admin AND a.is_active)))) AND n.state IN ('pending','sending') AND n.available_at<=now() ORDER BY n.available_at FOR UPDATE OF n SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      const lease = randomUUID();
      await c.query(
        "UPDATE pm_approval_notifications SET state='sending',attempts=attempts+1,lease=$2,available_at=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
        [row.id, lease],
      );
      return {
        userId: row.user_id,
        email: row.email,
        lease,
        kind: row.kind,
        recipientId: row.recipient_id,
        applicantName: row.applicant_name,
        applicantEmail: row.applicant_email,
      };
    });
  }
  async finishApprovalNotification(userId, lease, sent) {
    await this.pool.query(
      "UPDATE pm_approval_notifications SET state=CASE WHEN $3 THEN 'sent' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,lease=NULL,available_at=now()+interval '1 minute',updated_at=now() WHERE user_id=$1 AND lease=$2 AND state='sending'",
      [userId, lease, sent],
    );
  }
  async retryApprovalNotification(actorId, targetId, kind = 'approval') {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(726534011)');
      const actor = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [
          actorId,
        ])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const u = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [targetId]))
        .rows[0];
      if (
        !['approval', 'review'].includes(kind) ||
        !u?.email_verified_at ||
        (kind === 'review' ? !u.registration_pending : !u.is_active || u.registration_pending)
      )
        fail(
          409,
          'NOTICE_UNAVAILABLE',
          '현재 가입 상태에서는 안내 메일을 다시 요청할 수 없습니다.',
        );
      const r = await c.query(
        "UPDATE pm_approval_notifications SET state='pending',attempts=0,lease=NULL,available_at=now(),updated_at=now() WHERE user_id=$1 AND kind=$2 AND state='failed' AND (recipient_email IS NOT NULL OR EXISTS (SELECT 1 FROM pm_users a WHERE a.id=recipient_id AND a.is_active AND ($2='approval' OR a.is_admin))) RETURNING user_id",
        [targetId, kind],
      );
      if (!r.rowCount)
        fail(409, 'NOTICE_UNAVAILABLE', '발송에 실패한 안내 메일만 다시 요청할 수 있습니다.');
    });
  }
  async getMailSettings() {
    return (
      (
        await this.pool.query(
          'SELECT config,password_encrypted,revision FROM pm_mail_settings WHERE id=true',
        )
      ).rows[0] || null
    );
  }
  async saveMailSettings(actorId, { config, passwordEncrypted, revision }) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(726534011)');
      const actor = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR NO KEY UPDATE', [
          actorId,
        ])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      await c.query('SELECT pg_advisory_xact_lock(726534008)');
      const old = (await c.query('SELECT revision FROM pm_mail_settings WHERE id=true FOR UPDATE'))
        .rows[0];
      if ((old?.revision || 0) !== revision)
        fail(
          409,
          'MAIL_CONFLICT',
          '다른 관리자가 메일 설정을 변경했습니다. 최신 설정을 다시 확인해 주세요.',
        );
      await c.query(
        'INSERT INTO pm_mail_settings(id,config,password_encrypted,revision,updated_by) VALUES (true,$1::jsonb,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET config=$1::jsonb,password_encrypted=$2,revision=$3,updated_by=$4,updated_at=now()',
        [JSON.stringify(config), passwordEncrypted, revision + 1, actorId],
      );
      await this.syncReviewNotifications(c);
    });
  }
  async issuePasswordReset({ userId, passwordHash, hash, expires }) {
    return this.transaction(async (c) => {
      const user = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR UPDATE', [userId]))
        .rows[0];
      if (
        !user?.is_active ||
        !user.local_login ||
        user.registration_pending ||
        user.password_hash !== passwordHash
      )
        return false;
      await c.query('DELETE FROM pm_password_resets WHERE expires_at<now()');
      await c.query(
        'INSERT INTO pm_password_resets(user_id,token_hash,password_hash,expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,password_hash=$3,expires_at=$4',
        [userId, hash, passwordHash, expires],
      );
      return true;
    });
  }
  async revokePasswordReset(hash) {
    await this.pool.query('DELETE FROM pm_password_resets WHERE token_hash=$1', [hash]);
  }
  async consumePasswordReset(hash, passwordHash) {
    return this.transaction(async (c) => {
      const invalid = () =>
        fail(
          400,
          'RESET_INVALID',
          '유효하지 않거나 만료된 링크입니다. 비밀번호 재설정을 다시 요청해 주세요.',
        );
      const entry = (
        await c.query(
          'SELECT user_id FROM pm_password_resets WHERE token_hash=$1 AND expires_at>now()',
          [hash],
        )
      ).rows[0];
      if (!entry) invalid();
      const user = (await c.query('SELECT * FROM pm_users WHERE id=$1 FOR UPDATE', [entry.user_id]))
        .rows[0];
      const reset = (
        await c.query(
          'DELETE FROM pm_password_resets WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() RETURNING password_hash',
          [entry.user_id, hash],
        )
      ).rows[0];
      if (
        !reset ||
        !user?.is_active ||
        !user.local_login ||
        user.registration_pending ||
        reset.password_hash !== user.password_hash
      )
        invalid();
      await c.query('UPDATE pm_users SET password_hash=$2 WHERE id=$1', [user.id, passwordHash]);
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [user.id]);
      await c.query('DELETE FROM pm_auth_attempts WHERE key=$1', [digest('local:' + user.email)]);
      return { id: user.id };
    });
  }
  async putTransient(key, value, ttlMs = 600000) {
    await this.pool.query('DELETE FROM pm_auth_transient WHERE expires_at<now()');
    await this.pool.query(
      "INSERT INTO pm_auth_transient(key,value,expires_at) VALUES ($1,$2,now()+$3*interval '1 millisecond')",
      [key, JSON.stringify(value), ttlMs],
    );
  }
  async getTransient(key) {
    return (
      (
        await this.pool.query(
          'SELECT value FROM pm_auth_transient WHERE key=$1 AND expires_at>now()',
          [key],
        )
      ).rows[0]?.value ?? null
    );
  }
  async takeTransient(key, browserHash = null) {
    return (
      (
        await this.pool.query(
          "DELETE FROM pm_auth_transient WHERE key=$1 AND expires_at>now() AND ($2::text IS NULL OR value->>'browserHash'=$2) RETURNING value",
          [key, browserHash],
        )
      ).rows[0]?.value ?? null
    );
  }
  async externalSession({ providerKey, subject, email, name, autoProvision, hash, csrf, expires }) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        providerKey + '|' + subject,
      ]);
      let row = (
        await c.query(
          'SELECT u.* FROM pm_external_identities i JOIN pm_users u ON u.id=i.user_id WHERE i.provider_key=$1 AND i.subject=$2 FOR UPDATE OF u',
          [providerKey, subject],
        )
      ).rows[0];
      if (!row) {
        if (!autoProvision)
          fail(403, 'IDENTITY_UNLINKED', '관리자에게 외부 계정 연결을 요청해 주세요.');
        // Matching email alone never grants access to an existing local account.
        if ((await c.query('SELECT id FROM pm_users WHERE email=$1', [email])).rowCount)
          fail(
            409,
            'IDENTITY_UNLINKED',
            '같은 이메일의 계정이 있습니다. 관리자에게 외부 계정 연결을 요청해 주세요.',
          );
        row = (
          await c.query(
            "INSERT INTO pm_users(id,email,name,password_hash,local_login) VALUES ($1,$2,$3,'',false) RETURNING *",
            [randomUUID(), email, name],
          )
        ).rows[0];
        await c.query(
          'INSERT INTO pm_external_identities(provider_key,subject,user_id) VALUES ($1,$2,$3)',
          [providerKey, subject, row.id],
        );
      }
      if (row.is_admin) fail(403, 'ADMIN_PROTECTED', '관리자 계정은 로컬 로그인을 사용해 주세요.');
      if (!row.is_active) fail(403, 'ACCOUNT_DISABLED', '비활성화된 계정입니다.');
      await c.query('DELETE FROM pm_sessions WHERE expires_at<now()');
      await c.query(
        'INSERT INTO pm_sessions(token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)',
        [hash, row.id, csrf, expires],
      );
      return publicUser(row);
    });
  }
  async linkIdentity(actorId, { providerKey, subject, email }) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        providerKey + '|' + subject,
      ]);
      const actor = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR UPDATE', [actorId])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const target = (await c.query('SELECT * FROM pm_users WHERE email=$1', [email])).rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND', '먼저 연결할 사용자 계정을 생성해 주세요.');
      if (target.is_admin)
        fail(403, 'ADMIN_PROTECTED', '비상 복구용 관리자 계정은 외부 인증에 연결하지 않습니다.');
      if (
        (
          await c.query(
            'SELECT user_id FROM pm_external_identities WHERE provider_key=$1 AND subject=$2',
            [providerKey, subject],
          )
        ).rowCount
      )
        fail(409, 'IDENTITY_EXISTS', '이미 연결된 외부 계정입니다.');
      await c.query(
        'INSERT INTO pm_external_identities(provider_key,subject,user_id) VALUES ($1,$2,$3)',
        [providerKey, subject, target.id],
      );
      return { ok: true };
    });
  }
  async listIdentities() {
    return (
      await this.pool.query(
        'SELECT i.provider_key AS "providerKey",i.subject,u.email,u.name FROM pm_external_identities i JOIN pm_users u ON u.id=i.user_id ORDER BY i.created_at',
      )
    ).rows;
  }
  async unlinkIdentity(actorId, providerKey, subject) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        providerKey + '|' + subject,
      ]);
      const actor = (
        await c.query('SELECT is_admin,is_active FROM pm_users WHERE id=$1 FOR UPDATE', [actorId])
      ).rows[0];
      if (!actor?.is_admin || !actor.is_active) fail(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
      const row = (
        await c.query(
          'DELETE FROM pm_external_identities WHERE provider_key=$1 AND subject=$2 RETURNING user_id',
          [providerKey, subject],
        )
      ).rows[0];
      if (!row) fail(404, 'IDENTITY_NOT_FOUND', '외부 계정 연결을 찾을 수 없습니다.');
      await c.query('DELETE FROM pm_sessions WHERE user_id=$1', [row.user_id]);
      return { ok: true };
    });
  }
  async access(c, userId, id, required = 'viewer', lock = false) {
    if (lock) await c.query('SELECT id FROM pm_projects WHERE id=$1 FOR UPDATE', [id]);
    const { rows } = await c.query(
      'SELECT p.*,a.role FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id WHERE p.id=$1 AND a.user_id=$2 AND p.deleted_at IS NULL',
      [id, userId],
    );
    const row = rows[0];
    if (!row) fail(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    if (
      (required === 'owner' && row.role !== 'owner') ||
      (required === 'editor' && row.role === 'viewer')
    )
      fail(403, 'FORBIDDEN', '이 작업을 수행할 권한이 없습니다.');
    return row;
  }
  async hydrate(c, row) {
    const id = row.id;
    const members = (
      await c.query(
        'SELECT id,name,role,grade,hours,allocation FROM pm_members WHERE project_id=$1 ORDER BY position',
        [id],
      )
    ).rows.map((m) => ({ ...m, hours: Number(m.hours), allocation: Number(m.allocation) }));
    const tasks = (
      await c.query(
        "SELECT id,name,phase,coalesce(owner_id,'') AS owner,to_char(start_date,'YYYY-MM-DD') AS start,to_char(end_date,'YYYY-MM-DD') AS end,coalesce(predecessor_id,'') AS predecessor,memo FROM pm_tasks WHERE project_id=$1 ORDER BY position",
        [id],
      )
    ).rows;
    const items = (
      await c.query(
        'SELECT id,task_id,title,hours,to_char(done_date,\'YYYY-MM-DD\') AS "doneDate" FROM pm_task_items WHERE project_id=$1 ORDER BY position',
        [id],
      )
    ).rows;
    for (const t of tasks) {
      const parent = Object.hasOwn(row.planning?.parents || {}, t.id)
        ? row.planning.parents[t.id]
        : null;
      if (parent) t.parentId = parent;
    }
    const byTask = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks) t.items = [];
    for (const i of items) {
      const { task_id, ...item } = i;
      byTask.get(task_id).items.push({ ...item, hours: Number(item.hours) });
    }
    return {
      ...(row.planning?.baseline ? { baseline: row.planning.baseline } : {}),
      id,
      name: row.name,
      description: row.description,
      demo: row.demo,
      holidays: row.holidays,
      members,
      tasks,
      createdAt: new Date(row.created_at).toISOString().slice(0, 10),
      _revision: row.revision,
      _role: row.role,
    };
  }
  async listProjects(userId) {
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        'SELECT p.*,a.role FROM pm_projects p JOIN pm_project_access a ON a.project_id=p.id WHERE a.user_id=$1 AND p.deleted_at IS NULL ORDER BY p.created_at,p.id',
        [userId],
      );
      const docs = [];
      for (const row of rows) docs.push(await this.hydrate(c, row));
      return docs;
    }, true);
  }
  async getProject(userId, id) {
    return this.transaction(async (c) => this.hydrate(c, await this.access(c, userId, id)), true);
  }
  async writeDocument(c, id, p) {
    await c.query('UPDATE pm_projects SET planning=$2::jsonb WHERE id=$1', [
      id,
      JSON.stringify({
        parents: Object.fromEntries(
          p.tasks.filter((t) => t.parentId).map((t) => [t.id, t.parentId]),
        ),
        baseline: p.baseline ?? null,
      }),
    ]);
    await c.query('DELETE FROM pm_tasks WHERE project_id=$1', [id]);
    await c.query('DELETE FROM pm_members WHERE project_id=$1', [id]);
    await c.query(
      'INSERT INTO pm_members(project_id,id,position,name,role,grade,hours,allocation) SELECT $1,id,position,name,role,grade,hours,allocation FROM jsonb_to_recordset($2::jsonb) AS m(id text,position integer,name text,role text,grade text,hours numeric,allocation numeric)',
      [id, JSON.stringify(p.members.map((m, position) => ({ ...m, position })))],
    );
    await c.query(
      'DELETE FROM pm_member_accounts WHERE project_id=$1 AND member_id NOT IN (SELECT id FROM pm_members WHERE project_id=$1)',
      [id],
    );
    await c.query(
      'INSERT INTO pm_tasks(project_id,id,position,name,phase,owner_id,start_date,end_date,predecessor_id,memo) SELECT $1,id,position,name,phase,nullif(owner,\'\'),start::date,"end"::date,nullif(predecessor,\'\'),memo FROM jsonb_to_recordset($2::jsonb) AS t(id text,position integer,name text,phase text,owner text,start text,"end" text,predecessor text,memo text)',
      [id, JSON.stringify(p.tasks.map((t, position) => ({ ...t, position })))],
    );
    await c.query(
      'INSERT INTO pm_task_items(project_id,id,task_id,position,title,hours,done_date) SELECT $1,id,"taskId",position,title,hours,"doneDate"::date FROM jsonb_to_recordset($2::jsonb) AS i(id text,"taskId" text,position integer,title text,hours numeric,"doneDate" text)',
      [
        id,
        JSON.stringify(
          p.tasks.flatMap((t) => t.items.map((i, position) => ({ ...i, taskId: t.id, position }))),
        ),
      ],
    );
  }
  async event(c, id, actor, revision, type, changes) {
    await c.query(
      'INSERT INTO pm_project_events(project_id,actor_id,revision,event_type,changes) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [id, actor, revision, type, JSON.stringify(changes)],
    );
  }
  async createProject(userId, id, p) {
    return this.transaction(async (c) => {
      await c.query('SELECT id FROM pm_users WHERE id=$1 FOR UPDATE', [userId]);
      const existing = (await c.query('SELECT * FROM pm_projects WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (existing) {
        const row = await this.access(c, userId, id, 'owner');
        const doc = await this.hydrate(c, row);
        if (JSON.stringify(cleanProject(doc)) !== JSON.stringify(p))
          fail(
            409,
            'CREATE_CONFLICT',
            '이미 저장된 프로젝트와 내용이 다릅니다. 서버 내용을 다시 읽어 주세요.',
          );
        return doc;
      }
      const count = Number(
        (await c.query('SELECT count(*) AS n FROM pm_project_access WHERE user_id=$1', [userId]))
          .rows[0].n,
      );
      if (count >= 100) fail(400, 'PROJECT_LIMIT', '계정당 프로젝트는 100개까지 지원합니다.');
      const { rows } = await c.query(
        'INSERT INTO pm_projects(id,name,description,holidays,demo) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *',
        [id, p.name, p.description, JSON.stringify(p.holidays), p.demo],
      );
      await c.query(
        "INSERT INTO pm_project_access(project_id,user_id,role) VALUES ($1,$2,'owner')",
        [id, userId],
      );
      await this.writeDocument(c, id, p);
      await this.event(c, id, userId, 1, 'project.created', projectChanges(null, p));
      return this.hydrate(c, {
        ...rows[0],
        planning: {
          parents: Object.fromEntries(
            p.tasks.filter((t) => t.parentId).map((t) => [t.id, t.parentId]),
          ),
          baseline: p.baseline ?? null,
        },
        role: 'owner',
      });
    });
  }
  async updateProject(userId, id, p, revision) {
    return this.transaction(async (c) => {
      const row = await this.access(c, userId, id, 'editor', true);
      if (row.revision !== revision)
        fail(
          409,
          'REVISION_CONFLICT',
          '다른 사용자가 먼저 수정했습니다. JSON 백업 후 서버 내용을 다시 읽어 주세요.',
        );
      const before = await this.hydrate(c, row),
        changes = projectChanges(cleanProject(before), p);
      if (!changes.length) return before;
      const { rows } = await c.query(
        'UPDATE pm_projects SET name=$2,description=$3,holidays=$4::jsonb,demo=$5,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
        [id, p.name, p.description, JSON.stringify(p.holidays), p.demo],
      );
      await this.captureDeletedTasks(c, id, userId, before, p);
      await this.writeDocument(c, id, p);
      await this.event(c, id, userId, rows[0].revision, 'project.updated', changes);
      return this.hydrate(c, {
        ...rows[0],
        planning: {
          parents: Object.fromEntries(
            p.tasks.filter((t) => t.parentId).map((t) => [t.id, t.parentId]),
          ),
          baseline: p.baseline ?? null,
        },
        role: row.role,
      });
    });
  }
  async listAccess(userId, id) {
    return this.transaction(async (c) => {
      await this.access(c, userId, id, 'owner');
      return (
        await c.query(
          'SELECT a.user_id AS id,u.email,u.name,a.role FROM pm_project_access a JOIN pm_users u ON u.id=a.user_id WHERE a.project_id=$1 ORDER BY a.role,u.name',
          [id],
        )
      ).rows;
    }, true);
  }
  async grantAccess(userId, id, email, role) {
    return this.transaction(async (c) => {
      const project = await this.access(c, userId, id, 'owner', true);
      const target = (await c.query('SELECT id FROM pm_users WHERE email=$1', [email])).rows[0];
      if (!target)
        fail(
          404,
          'USER_NOT_FOUND',
          '등록된 계정이 없습니다. 관리자에게 계정 생성을 요청해 주세요.',
        );
      const old = (
        await c.query('SELECT role FROM pm_project_access WHERE project_id=$1 AND user_id=$2', [
          id,
          target.id,
        ])
      ).rows[0]?.role;
      if (old === 'owner') fail(409, 'OWNER_IMMUTABLE', '소유자의 권한은 변경할 수 없습니다.');
      await c.query(
        'INSERT INTO pm_project_access(project_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role',
        [id, target.id, role],
      );
      await this.event(c, id, userId, project.revision, 'access.granted', [
        { email, before: old || null, after: role },
      ]);
      return { ok: true };
    });
  }
  async revokeAccess(userId, id, targetId) {
    return this.transaction(async (c) => {
      const project = await this.access(c, userId, id, 'owner', true);
      const old = (
        await c.query('SELECT role FROM pm_project_access WHERE project_id=$1 AND user_id=$2', [
          id,
          targetId,
        ])
      ).rows[0];
      if (!old) fail(404, 'NOT_FOUND', '접근 권한을 찾을 수 없습니다.');
      if (old.role === 'owner') fail(409, 'OWNER_IMMUTABLE', '소유자의 권한은 삭제할 수 없습니다.');
      await c.query('DELETE FROM pm_project_access WHERE project_id=$1 AND user_id=$2', [
        id,
        targetId,
      ]);
      await c.query('DELETE FROM pm_member_accounts WHERE project_id=$1 AND user_id=$2', [
        id,
        targetId,
      ]);
      await this.event(c, id, userId, project.revision, 'access.revoked', [
        { userId: targetId, before: old.role, after: null },
      ]);
      return { ok: true };
    });
  }
  async listEvents(userId, id) {
    return this.transaction(async (c) => {
      await this.access(c, userId, id);
      return (
        await c.query(
          'SELECT e.id::text,e.revision,e.event_type AS type,e.changes,e.created_at AS at,u.name AS actor FROM pm_project_events e JOIN pm_users u ON u.id=e.actor_id WHERE e.project_id=$1 ORDER BY e.id DESC LIMIT 100',
          [id],
        )
      ).rows;
    }, true);
  }
}
