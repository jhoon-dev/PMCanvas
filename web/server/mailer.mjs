import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { emailAddress } from './security.mjs';
import { fail } from './errors.mjs';

export function mailAddress(value) {
  const address = emailAddress(value);
  if (/[<>,;:"\\()[\]]/.test(address))
    fail(400, 'INVALID_EMAIL', '이메일 주소 하나를 입력해 주세요.');
  return address;
}

export function mailConfig(raw, { directory = process.cwd(), password } = {}) {
  if (!raw || typeof raw.enabled !== 'boolean')
    throw Error('Mail configuration requires a boolean enabled flag.');
  if (!raw.enabled) return null;
  if (
    typeof raw.host !== 'string' ||
    !raw.host ||
    raw.host.length > 253 ||
    /[\s/@?#:]/.test(raw.host)
  )
    throw Error('Invalid SMTP host.');
  if (
    !Number.isInteger(raw.port) ||
    raw.port < 1 ||
    raw.port > 65535 ||
    typeof raw.secure !== 'boolean'
  )
    throw Error('SMTP port and secure flag are required.');
  const from = mailAddress(raw.from);
  let auth;
  if (raw.username || raw.passwordFile) {
    if (
      typeof raw.username !== 'string' ||
      !raw.username ||
      raw.username.length > 254 ||
      (typeof password !== 'string' && (typeof raw.passwordFile !== 'string' || !raw.passwordFile))
    )
      throw Error('SMTP username and passwordFile must be supplied together.');
    const pass =
      typeof password === 'string'
        ? password
        : fs.readFileSync(path.resolve(directory, raw.passwordFile), 'utf8').replace(/\r?\n$/, '');
    if (!pass || pass.length > 4096) throw Error('Invalid SMTP password file.');
    auth = { user: raw.username, pass };
  }
  return {
    from,
    transport: {
      host: raw.host,
      port: raw.port,
      secure: raw.secure,
      requireTLS: !raw.secure,
      tls: { rejectUnauthorized: true },
      ...(auth ? { auth } : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    },
  };
}
export function createMailer(config, { createTransport = nodemailer.createTransport } = {}) {
  if (!config) return null;
  const transport = createTransport(config.transport);
  const checkDelivery = (info) => {
    if (!info.accepted?.length || info.rejected?.length)
      throw (
        info.rejectedErrors?.[0] ||
        Object.assign(Error('SMTP recipient rejected'), { code: 'MAIL_REJECTED' })
      );
  };
  return {
    async sendReset({ to, url }) {
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] 비밀번호 재설정',
        text:
          '비밀번호 재설정을 요청하셨습니다.\n\n아래 링크에서 새 비밀번호를 설정하세요. 링크는 15분 동안 한 번만 사용할 수 있습니다.\n\n' +
          'Password reset: use the link below once within 15 minutes. If you did not request this, ignore this email. Your password stays unchanged until you complete the reset.\n\n' +
          url +
          '\n\n요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 링크에서 변경을 완료하기 전까지 유지됩니다.',
      });
      checkDelivery(info);
    },
    async sendVerification({ to, url }) {
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] 회원가입 이메일 인증',
        text:
          'PM Canvas 회원가입 이메일 인증을 요청하셨습니다.\n\n아래 링크에서 본인의 이름과 로그인 비밀번호를 설정해 이메일 인증을 완료하세요. 링크는 30분 동안 한 번만 사용할 수 있습니다. 인증 후 관리자 승인이 필요합니다.\n\n' +
          'Verify your email: use the link below once within 30 minutes to set your name and password. Administrator approval is required afterward. Opening the link alone does not activate the account. Ignore this email if you did not register.\n\n' +
          url +
          '\n\n직접 가입하지 않았다면 이 메일을 무시하세요. 링크를 열기만 해서는 계정이 인증되거나 활성화되지 않습니다.',
      });
      checkDelivery(info);
    },
    async sendReviewRequest({ to, url, name, email }) {
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] 회원가입 승인 요청',
        text:
          '이메일 인증을 완료한 가입 신청이 있습니다.\n\n신청자 이름: ' +
          String(name).replace(/[\x00-\x1f\x7f]/g, ' ') +
          '\n신청자 이메일: ' +
          mailAddress(email) +
          '\n\n아래 링크에서 관리자 계정으로 로그인한 뒤 신청자의 소속을 확인하고 가입을 승인해 주세요.\n\n' +
          'A verified registration awaits review. Sign in as an administrator using the link below, check the applicant and approve explicitly. Opening the link does not approve the request.\n\n' +
          url +
          '\n\n링크를 열거나 이 메일에 답장하는 것만으로는 승인되지 않습니다. 이미 처리한 신청이라면 이 알림을 무시하세요.',
      });
      checkDelivery(info);
    },
    async sendApproval({ to, url }) {
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] 회원가입이 승인되었습니다',
        text:
          'PM Canvas 회원가입이 승인되었습니다.\n\n이메일 인증 시 설정한 비밀번호로 로그인해 주세요.\n\n' +
          'Your registration has been approved. Sign in using the password you set during email verification. No password is included in this email.\n\n' +
          url +
          '\n\n이 메일에는 비밀번호가 포함되어 있지 않습니다. 비밀번호를 잊으셨다면 로그인 화면에서 비밀번호 찾기를 이용하세요.',
      });
      checkDelivery(info);
    },
    async sendTest(to) {
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] 테스트 메일',
        text: 'PM Canvas 관리자 화면에서 요청한 테스트 메일입니다.\n\n이 메일이 도착했다면 현재 SMTP 설정으로 메일을 전달할 수 있습니다.',
      });
      checkDelivery(info);
    },
    async sendOperationAlert({ to, kind, count, url }) {
      const labels = {
        backup: 'DB 백업 실패 / Database backup failed',
        restore: '복원 점검 실패 / Restore verification failed',
        mail: '메일 발송 실패 / Email delivery failed',
      };
      const info = await transport.sendMail({
        from: { name: 'PM Canvas', address: config.from },
        to: { address: mailAddress(to) },
        subject: '[PM Canvas] ' + (labels[kind] || '운영 알림 / Operation alert'),
        text:
          (labels[kind] || '운영 상태 확인 / Check operations') +
          '\n\n누적 발생 / Total occurrences: ' +
          Number(count) +
          '\n관리자 설정에서 상태를 확인해 주세요. / Review the status in administrator settings.\n\n' +
          url +
          '\n\n메일 발송 장애에서는 이 알림도 도착하지 않을 수 있습니다. 관리자 화면에서도 확인하세요. / During an SMTP outage, check the administrator screen directly.',
      });
      checkDelivery(info);
    },
    verify: () => transport.verify(),
    close: () => transport.close(),
  };
}
export const mailConfigFile = (env = process.env) =>
  env.MAIL_CONFIG_FILE || path.join(env.MAIL_CONFIG_DIR || 'config', 'mail.json');
export function loadMailer(env = process.env) {
  const file = mailConfigFile(env);
  if (!fs.existsSync(file)) {
    if (env.MAIL_CONFIG_FILE) throw Error('MAIL_CONFIG_FILE was not found.');
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw Error('Invalid mail configuration JSON.');
  }
  return createMailer(mailConfig(raw, { directory: path.dirname(path.resolve(file)) }));
}
