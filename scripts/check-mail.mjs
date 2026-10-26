import { loadMailer } from '../server/mailer.mjs';
const mailer = loadMailer();
if (!mailer) {
  console.error('이메일 발송이 비활성입니다. config/mail.json을 설정하세요.');
  process.exitCode = 1;
} else
  try {
    await mailer.verify();
    console.log('SMTP 연결·TLS·인증 확인 완료. 메일은 발송하지 않았습니다.');
  } catch {
    console.error('SMTP 연결·인증 실패. 서버 주소·포트·발신 계정·비밀번호 파일을 확인하세요.');
    process.exitCode = 1;
  } finally {
    mailer.close();
  }
