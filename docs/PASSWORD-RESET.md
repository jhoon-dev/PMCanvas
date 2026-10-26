# 이메일 비밀번호 재설정 · 0.13.0

로그인 화면의 **비밀번호를 잊으셨나요? → 가입 이메일 입력 → 재설정 메일 보내기**를 사용합니다. 이메일 링크에서 새 비밀번호와 확인값을 입력한 뒤 다시 로그인하세요. 관리자 계정의 인증 앱·복구 코드는 유지됩니다. SSO·AD 전용 계정은 회사 인증 서비스에서 비밀번호를 변경하세요.

## SMTP 설정

실제 발송에는 운영자가 제공한 SMTP 서버와 계정이 필요합니다. 현재 작업 폴더에는 비활성 상태의 **config/mail.json**과 비밀번호를 넣을 빈 **config/secrets/smtp-password.txt**를 준비했습니다. 새 설치는 config/mail.example.json을 config/mail.json으로 복사하세요.

설정 파일의 enabled를 true로 바꾸고 host, port, secure, from, username을 채웁니다. 기본 예제는 587번·STARTTLS입니다. secure=false여도 반드시 TLS로 업그레이드하며 인증서를 검증합니다. 465번의 처음부터 TLS 방식은 secure=true로 설정하세요. 평문 SMTP·인증서 검증 생략은 지원하지 않습니다.

passwordFile은 mail.json을 기준으로 한 상대 경로입니다. 기본값 **secrets/smtp-password.txt**라면 **config/secrets/smtp-password.txt**를 텍스트 편집기로 만들고 SMTP 비밀번호 또는 발송 서비스의 앱 비밀번호를 한 줄로 저장하세요. 파일 권한은 운영 계정만 읽도록 제한합니다. 인증 없는 사내 TLS 릴레이는 username과 passwordFile을 모두 빈 문자열로 설정합니다.

from은 실제 발신 권한이 있는 이메일 주소를 지정하세요. SMTP 서비스의 발송 허용·발신 도메인 설정도 해당 서비스에서 준비해야 합니다. 사설 CA는 기존 NODE_EXTRA_CA_CERTS 설정으로 신뢰 인증서를 지정할 수 있습니다.

설정 예제:

    {
      "enabled": true,
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "from": "pmcanvas@example.com",
      "username": "pmcanvas@example.com",
      "passwordFile": "secrets/smtp-password.txt"
    }

**PUBLIC_ORIGIN은 수신자가 접속할 수 있는 앱의 실제 HTTPS 주소로 설정하세요.** localhost 링크는 수신자의 컴퓨터에서 같은 앱에 접속할 수 있을 때만 동작합니다. BASE_PATH는 링크에 자동 반영됩니다. 요청의 Host 헤더로 링크를 만들지 않습니다.

파일 변경 후 앱을 다시 기동합니다.

    npm run service:up
    docker compose exec app node scripts/check-mail.mjs

확인 명령은 SMTP 연결·TLS·인증만 검사하며 메일을 보내지 않습니다. Docker 없이 실행하면 **npm run mail:check**를 사용하세요. MAIL_CONFIG_FILE을 지정하면 다른 설정 파일도 사용할 수 있습니다. Docker 경로는 /app/config/mail.json과 같이 컨테이너 기준으로 지정합니다. 외부 DB 구성에서도 같은 설정을 사용합니다.

실제 비밀번호·운영 mail.json은 Git·설치 ZIP에서 제외됩니다. 비밀 파일을 예제 파일에 넣지 마세요.

## 링크와 계정 보호

- 무작위 256비트 토큰의 SHA-256 해시만 DB에 보관하고 15분 후 만료합니다. 새 링크를 발급하면 이전 링크는 무효화합니다.
- 토큰은 URL 프래그먼트에 넣어 서버 요청 URL에 포함되지 않게 하고, 화면이 읽는 즉시 주소창에서 제거합니다. Referrer-Policy도 no-referrer로 설정합니다. 새로고침으로 링크가 사라졌으면 이메일에서 다시 여세요.
- 비밀번호 변경·토큰 소비·세션 삭제를 한 DB 트랜잭션으로 처리합니다. 동시 요청도 한 번만 성공합니다. 정상 변경 뒤에는 자동 로그인하지 않습니다.
- 현재 비밀번호 해시와 토큰을 함께 묶어 이전 비밀번호의 링크를 사용할 수 없게 합니다. 비밀번호 변경·관리자 초기화·계정 비활성화도 링크를 폐기합니다.
- 관리자 MFA는 유지하고 이전 비밀번호에 묶인 MFA 로그인 요청은 무효화합니다. 비밀번호 재설정은 MFA 복구를 대신하지 않습니다.
- 이메일 존재·외부 인증·비활성·가입 대기 여부와 관계없이 같은 접수 응답을 보냅니다. 발송은 제한된 별도 비동기 작업으로 처리합니다. 외부·비활성·가입 대기 계정에는 메일을 보내지 않습니다.
- 요청은 이메일별 3회/시간, 검증된 IP별 10회/15분, 전체 100회/시간으로 제한합니다. 링크 사용도 IP·전체·토큰별 제한을 적용합니다. 성공한 재설정은 해당 계정의 기존 로그인 시도 제한을 해제합니다.
- 링크·비밀번호·SMTP 비밀번호는 앱 로그와 API 응답에 기록하지 않습니다. 메일 발송·실패·변경 완료는 보안 감사 로그에서 확인합니다.

발송 대기열은 현재 프로세스의 메모리에 보관합니다. 재기동·메일 장애로 수신하지 못했다면 다시 요청하세요. 발송 실패 시 해당 링크를 폐기합니다. 사용 가능한 설정이 없으면 발송 기능을 비활성으로 표시하며 성공했다고 안내하지 않습니다.

DB 복원 명령은 기존 재설정 링크도 폐기합니다. 007_password_reset 마이그레이션은 앱 시작 시 자동 적용합니다. 업데이트 전 DB를 백업하세요.

구현 참고: [OWASP 비밀번호 찾기 지침](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Nodemailer SMTP 설정](https://nodemailer.com/smtp).
