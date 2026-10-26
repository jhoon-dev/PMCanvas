# 개발과 검증

Node.js 22.18 이상에서 `npm ci --ignore-scripts`로 고정 의존성을 설치합니다.

```sh
npm run format
npm run format:check
npm test
```

포맷은 고정 버전 Prettier로 통일합니다. 기능 변경과 전체 포맷 변경은 별도 커밋으로 작성하세요. 대규모 포맷 커밋을 blame에서 제외하려면 다음을 실행합니다.

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

프론트엔드는 빌드 없이 ES 모듈을 사용합니다. 대시보드는 `public/dashboard-view.js`, WBS 화면과 서버 연결은 `public/wbs-view.js`, WBS 표·간트·초안 편집은 `public/wbs-workspace.js`에 둡니다. 대시보드 렌더러는 프로젝트·계산 결과·보고일을 명시적으로 받으며 전역 선택 프로젝트를 읽지 않습니다. `app.js`는 화면 선택과 공유 상태 연결을 담당합니다.

공통 아이콘·날짜 도구·인력 표시 등은 `view-ui.js`, 공통 다이얼로그와 HTML 이스케이프는 `info-dialog.js`와 `html.js`에 둡니다. 계정·메일·백업·내 업무의 기능별 화면은 `public/*-ui.js`에 있습니다. 사용자 입력을 HTML 문자열에 넣을 때는 escapeHtml을 적용하세요. 새 브라우저 모듈은 server/http.mjs의 정적 파일 허용 목록에도 등록하고 하위 경로 HTTP 테스트를 갱신해야 합니다.

로그인·가입·이메일 인증·재설정·MFA·외부 로그인 UI와 해당 임시 상태는 `auth-ui.js`에서 관리합니다. 인증 후 사용자·프로젝트·초안을 교체하는 작업은 app.js의 콜백을 통해 수행합니다. 토큰은 URL에서 읽은 뒤 제거하며 저장소에 쓰지 않습니다. `daily-view.js`는 업무 체크 화면·필터·완료 기록 처리를, `people-view.js`는 인력 화면과 추가·수정 양식을 담당합니다. 프로젝트·보고일·필터는 명시적으로 전달하고 공통 필터를 CSV/Excel 출력에서도 재사용합니다.

DB 변경은 migrations/에 연속 번호의 `NNN_description.sql` 파일을 추가합니다. 서버가 번호 순서로 발견하고 트랜잭션·advisory lock 안에서 미적용 파일만 실행합니다. 기존 마이그레이션은 수정하지 않습니다. 파일 누락·중복·잘못된 이름은 기동 실패로 알려줍니다.

실제 HTTP·TLS SMTP 검증은 RUN_HTTP_TESTS=1로, 실제 PostgreSQL 검증은 이름이 _test로 끝나는 별도 DB와 RUN_POSTGRES_TESTS=1로 실행합니다. CI는 포맷·단위/요청·HTTP/SMTP·PostgreSQL·의존성 감사·실제 백업 복원·CodeQL을 검사합니다.

운영 계정이나 외부 수신자를 테스트에 사용하지 마세요. test/support/mail-admin-preview.mjs는 RUN_MAIL_ADMIN_PREVIEW=1로만 시작되는 일회용 메모리 저장소·loopback SMTP 환경이며 10분 후 종료됩니다.
