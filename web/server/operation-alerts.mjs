import { randomUUID } from 'node:crypto';
import { reviewRecipients } from './mail-settings.mjs';
import { fail } from './errors.mjs';
import { mailFailureCategories, mailDeliveryMethods } from './mail-failures.mjs';
export const alertKinds = ['backup', 'restore', 'mail'];
export async function recordFailure(pool, kind) {
  if (!alertKinds.includes(kind)) throw Error('Invalid operation alert kind.');
  await pool.query(
    `INSERT INTO pm_operation_alerts(kind) VALUES($1)
    ON CONFLICT(kind) DO UPDATE SET occurrences=pm_operation_alerts.occurrences+1,last_at=now(),
    attempts=CASE WHEN pm_operation_alerts.acknowledged=pm_operation_alerts.occurrences THEN 0 ELSE pm_operation_alerts.attempts END`,
    [kind],
  );
}
export function alertConfig(body) {
  if (
    !body ||
    typeof body.enabled !== 'boolean' ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    fail(400, 'INVALID_ALERT_SETTINGS', '알림 설정을 확인해 주세요.');
  return {
    enabled: body.enabled,
    recipients: reviewRecipients(body.recipients),
    revision: body.revision,
  };
}
export class AlertRepository {
  constructor(pool) {
    this.pool = pool;
  }
  recordOperationFailure(kind) {
    return recordFailure(this.pool, kind);
  }
  async recordMailFailure({ category, method, responseCode }) {
    if (
      !mailFailureCategories.includes(category) ||
      !mailDeliveryMethods.includes(method) ||
      (responseCode !== null &&
        (!Number.isInteger(responseCode) || responseCode < 400 || responseCode > 599))
    )
      throw Error('Invalid mail failure classification.');
    return this.transaction(async (c) => {
      await c.query(
        `INSERT INTO pm_mail_failures(category) VALUES($1) ON CONFLICT(category) DO UPDATE SET occurrences=pm_mail_failures.occurrences+1,last_at=now()`,
        [category],
      );
      if (category !== 'recipient') await recordFailure(c, 'mail');
      await c.query("DELETE FROM pm_security_events WHERE at<now()-interval '90 days'");
      await c.query(
        "INSERT INTO pm_security_events(kind,details) VALUES ('mail.delivery.failed',$1::jsonb)",
        [JSON.stringify({ category, method, responseCode })],
      );
    });
  }
  async operationAlerts() {
    const settings = (
      await this.pool.query(
        'SELECT enabled,recipients,revision FROM pm_alert_settings WHERE id=true',
      )
    ).rows[0];
    const alerts = (
      await this.pool.query(
        'SELECT kind,occurrences::integer,first_at AS "firstAt",last_at AS "lastAt",acknowledged::integer,notified::integer,attempts FROM pm_operation_alerts ORDER BY last_at DESC',
      )
    ).rows;
    const mailFailures = (
      await this.pool.query(
        'SELECT category,occurrences::integer,first_at AS "firstAt",last_at AS "lastAt" FROM pm_mail_failures ORDER BY category',
      )
    ).rows;
    return { settings, alerts, mailFailures };
  }
  async saveAlertSettings(actorId, body) {
    const b = alertConfig(body);
    const r = await this.pool.query(
      `UPDATE pm_alert_settings SET enabled=$2,recipients=$3,revision=revision+1 WHERE id=true AND revision=$4 AND EXISTS(SELECT 1 FROM pm_users WHERE id=$1 AND is_admin AND is_active) RETURNING id`,
      [actorId, b.enabled, b.recipients, b.revision],
    );
    if (!r.rowCount)
      fail(409, 'ALERT_CONFLICT', '알림 설정이 변경되었거나 권한이 없습니다. 다시 열어 주세요.');
    return this.operationAlerts();
  }
  async acknowledgeAlert(actorId, kind, count) {
    if (!alertKinds.includes(kind) || !Number.isSafeInteger(count) || count < 1)
      fail(400, 'INVALID_ALERT', '알림을 확인해 주세요.');
    await this.pool.query(
      `UPDATE pm_operation_alerts SET acknowledged=greatest(acknowledged,least(occurrences,$3)),attempts=0 WHERE kind=$2 AND EXISTS(SELECT 1 FROM pm_users WHERE id=$1 AND is_admin AND is_active)`,
      [actorId, kind, count],
    );
    return this.operationAlerts();
  }
  async claimOperationAlert() {
    const lease = randomUUID();
    const r = await this.pool.query(
      `UPDATE pm_operation_alerts SET lease=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1
      WHERE kind=(SELECT kind FROM pm_operation_alerts WHERE occurrences>greatest(acknowledged,notified) AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND attempts<3 AND EXISTS(SELECT 1 FROM pm_alert_settings WHERE id=true AND enabled) ORDER BY last_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING kind,occurrences::integer,last_at AS "lastAt",lease`,
      [lease],
    );
    if (!r.rowCount) return null;
    const settings = (await this.operationAlerts()).settings;
    const recipients = settings.recipients.length
      ? settings.recipients
      : (
          await this.pool.query(
            'SELECT email FROM pm_users WHERE is_admin AND is_active ORDER BY id LIMIT 10',
          )
        ).rows.map((u) => u.email);
    return { ...r.rows[0], recipients };
  }
  async finishOperationAlert(job, sent) {
    await this.pool.query(
      `UPDATE pm_operation_alerts SET notified=CASE WHEN $3 THEN greatest(notified,$4) ELSE notified END,lease=NULL,lease_until=NULL,next_at=now()+interval '1 hour',attempts=CASE WHEN $3 THEN 0 ELSE attempts END WHERE kind=$1 AND lease=$2`,
      [job.kind, job.lease, sent, job.occurrences],
    );
  }
}
export class OperationAlerts {
  constructor({ repo, mailer, origin, basePath = '', logger = console }) {
    Object.assign(this, { repo, mailer, origin, basePath, logger });
  }
  async tick() {
    if (this.running) return this.running;
    this.running = this.deliver()
      .catch(() => this.logger.error('Operation alert delivery unavailable.'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  async deliver() {
    if (!(await this.mailer.enabled())) return;
    for (let i = 0; i < 3; i++) {
      const job = await this.repo.claimOperationAlert();
      if (!job) return;
      let sent = false;
      try {
        const url = new URL((this.basePath || '') + '/', this.origin);
        url.hash = 'operation-alerts';
        // Each recipient is sent independently: no administrator address disclosure.
        for (const to of job.recipients)
          await this.mailer.sendOperationAlert({
            to,
            kind: job.kind,
            count: job.occurrences,
            url: url.href,
          });
        sent = job.recipients.length > 0;
      } catch {
        /* SMTP failure is retained in the UI; never enqueue mail about this failure. */
      }
      await this.repo.finishOperationAlert(job, sent);
    }
  }
  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60000);
    this.timer.unref();
  }
  async close() {
    clearInterval(this.timer);
    await this.running;
  }
}
