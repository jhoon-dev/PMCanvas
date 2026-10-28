# 개발과 검증

Node.js 22.18 이상에서 `npm ci --ignore-scripts`로 고정 의존성을 설치합니다.

```sh
npm run format
npm run format:check
npm run public:check
npm test
```

포맷은 고정 버전 Prettier로 통일합니다. 기능 변경과 전체 포맷 변경은 별도 커밋으로 작성하세요. 대규모 포맷 커밋을 blame에서 제외하려면 다음을 실행합니다.

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

웹 제품의 작업 디렉터리는 web/입니다. 계산·검증과 재사용 화면의 원본은 형제 shared/에 있으며 public/과 server/의 재노출 모듈은 기존 import 경로를 유지합니다. 공통 코드 변경은 shared/에서 진행하세요.

프론트엔드는 빌드 없이 ES 모듈을 사용합니다. 대시보드는 `public/dashboard-view.js`, WBS 화면과 서버 연결은 `public/wbs-view.js`, WBS 표·간트·초안 편집은 `public/wbs-workspace.js`에 둡니다. 대시보드 렌더러는 프로젝트·계산 결과·보고일을 명시적으로 받으며 전역 선택 프로젝트를 읽지 않습니다. `app.js`는 화면 선택과 공유 상태 연결을 담당합니다.

공통 아이콘·날짜 도구·인력 표시 등은 `view-ui.js`, 공통 다이얼로그와 HTML 이스케이프는 `info-dialog.js`와 `html.js`에 둡니다. 계정·메일·백업·내 업무의 기능별 화면은 `public/*-ui.js`에 있습니다. 사용자 입력을 HTML 문자열에 넣을 때는 escapeHtml을 적용하세요. 새 브라우저 모듈은 server/http.mjs의 정적 파일 허용 목록에도 등록하고 하위 경로 HTTP 테스트를 갱신해야 합니다.

로그인·가입·이메일 인증·재설정·MFA·외부 로그인 UI와 해당 임시 상태는 `auth-ui.js`에서 관리합니다. 인증 후 사용자·프로젝트·초안을 교체하는 작업은 app.js의 콜백을 통해 수행합니다. 토큰은 URL에서 읽은 뒤 제거하며 저장소에 쓰지 않습니다. `daily-view.js`는 업무 체크 화면·필터·완료 기록 처리를, `people-view.js`는 인력 화면과 추가·수정 양식을 담당합니다. 프로젝트·보고일·필터는 명시적으로 전달하고 공통 필터를 CSV/Excel 출력에서도 재사용합니다.

프로젝트·인력·업무 상세 편집과 삭제 보호는 `project-editor.js`에서, 완료 내역·CSV/Excel·JSON 입출력은 `report-ui.js`에서 관리합니다. 계정과 관리자·메일·백업 화면 연결은 `admin-ui.js`, 공유는 `sharing-ui.js`, 외부 인증 연결·감사 조회는 `security-ui.js`, 도움말은 `help-ui.js`에 둡니다. 현재 사용자·프로젝트·보고일은 getter로 받고 상태 교체·저장은 app.js 콜백에 맡깁니다. 이벤트는 해당 기능 모듈이 등록하며 app.js는 화면 이동과 공통 상태를 연결합니다.

DB 변경은 migrations/에 연속 번호의 `NNN_description.sql` 파일을 추가합니다. 서버가 번호 순서로 발견하고 트랜잭션·advisory lock 안에서 미적용 파일만 실행합니다. 기존 마이그레이션은 수정하지 않습니다. 파일 누락·중복·잘못된 이름은 기동 실패로 알려줍니다.

메일 실패 분류는 `server/mail-failures.mjs`에서 관리합니다. 현지화된 오류 문구로 분류하지 말고 구조화된 코드·SMTP 명령·상태를 확인하세요. 불명확한 수신 거부를 운영 알림에서 제외하지 않습니다. 진단 기록에는 원문 오류나 주소를 전달하지 않습니다. `recordMailFailure`는 집계·운영 알림·감사 기록을 함께 커밋하며, 알림 발송 실패를 재귀 집계하지 않습니다. 백업은 `backupStages`의 단계 코드로 진행하고 표시 이름과 실패 종류를 구분합니다.

실제 HTTP·TLS SMTP 검증은 RUN_HTTP_TESTS=1로, 실제 PostgreSQL 검증은 이름이 _test로 끝나는 별도 DB와 RUN_POSTGRES_TESTS=1로 실행합니다. CI는 포맷·단위/요청·HTTP/SMTP·PostgreSQL·의존성 감사·실제 백업 복원·CodeQL을 검사합니다.

`RUN_RESTORE_TESTS=1 npm run test:restore`는 로컬 전용 `_test` DB 접속과 PostgreSQL 18의 pg_dump·pg_restore, CREATEDB 권한이 필요합니다. CI는 백업 이미지 안에서 실행합니다. 테스트는 무작위 이름의 원본·복원 DB를 새로 만들고 테스트 계정·메모리 암호화 키·loopback TLS SMTP 수신함만 사용합니다. 복원 후 세션·인증 요청·복구 코드 무효화, 관리자 로그인과 기존 MFA, 암호화된 SMTP 비밀번호를 통한 실제 발송, 업무 완료 기록과 조회자 수정 차단을 확인합니다. 자신이 만든 DB와 임시 덤프만 정리합니다. 운영 자격 증명이나 실제 메일 주소로 실행하지 마세요.

프로젝트 목록 동기화는 `server/workspace-sync.mjs`와 `public/workspace-cache.js`에서 관리합니다. 요약·선택 상세·변경된 내 업무를 한 스냅샷에서 읽고, 캐시 키에 revision·역할·담당 계정을 포함합니다. 접근이 회수된 프로젝트와 계정 전환 시 이전 캐시를 제거해야 합니다. `report-clock.js`는 오늘 날짜와 과거 조회일을 분리하고, 편집 중에는 자동 조회일 전환을 보류합니다.

비동기 프로젝트·내 업무 응답은 공통 `WorkspaceReadGate`로 요청 순서·계정·쓰기 세대를 확인한 후 반영합니다. 새 조회 경로에도 같은 검사를 적용하세요. JSON 백업의 `_wbsPendingCells`는 업무·열·문자열 값·중복·크기 제한을 확인한 뒤 브라우저 WBS 초안에만 복구합니다. 서버 프로젝트에는 확정된 데이터만 전달하며, 미확정 입력이 있는 초안은 기존 셀 검증을 통과해야 저장할 수 있습니다.

`npm run test:browser`는 고정 버전 Playwright로 가입·메일 인증·MFA 승인·업무·완료·파일 다운로드·운영 알림·충돌·언어·모바일·500개 업무를 검증합니다. 먼저 `npx playwright install chromium --only-shell`을 실행하세요. 전용 서버는 4193/4192 포트에서만 실행되는 MemoryRepository·TLS SMTP 수신함입니다. 실패 리포트는 playwright-report/, trace와 스크린샷은 test-results/에 있으며 운영 인증 정보를 넣지 마세요. [Playwright 서버 설정](https://playwright.dev/docs/test-webserver), [CI 안내](https://playwright.dev/docs/ci)를 따릅니다.

`npm run test:performance`는 500개 업무·20명·50개 상위 업무의 HTML 생성·검색·모델 편집·간트 이동을 각 5회 측정해 중앙값을 출력합니다. 네트워크·DB·브라우저 페인트 시간을 포함하지 않습니다. 숫자에 환경 의존성이 있으므로 동작 검증과 함께 비교하고 CI에 좁은 절대 시간 한도를 두지 않습니다.

브라우저 CI는 ubuntu-24.04 이미지에 이미 설치된 Chrome을 `PM_BROWSER_CHANNEL=chrome`으로 실행하고 실제 버전을 로그에 기록합니다. 매 실행마다 브라우저·OS 패키지를 설치하는 대기를 줄입니다. 로컬 기본은 Playwright의 Chromium입니다. [러너 포함 소프트웨어](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [Playwright Chrome 채널](https://playwright.dev/docs/browsers)을 참고하세요.

UI 문구는 사용자 데이터를 붙이기 **전에** `ui('화면 문구')`로 변환합니다. 업무명·메모·이메일·ID·인력 정보에는 ui를 적용하지 말고 HTML 이스케이프만 하세요. 번역은 public/locales/en.js에 있으며 새 언어는 지원 목록과 별도 사전으로 확장합니다. 날짜 값은 ISO 형식, 업무 계산 기준은 기존 설정을 유지합니다. 서버 Excel은 요청별 언어를 명시적으로 받아 처리하므로 다른 요청의 언어를 바꾸지 않습니다.

충돌 모델은 project-merge.js, 비교 다이얼로그는 conflict-ui.js에 둡니다. 운영 알림은 operation-alerts.mjs와 alerts-ui.js가 담당합니다. 새 실패에는 고정 분류만 저장하고 SMTP 원문 오류·계정 비밀을 알림에 넣지 않습니다. 알림 발송 자체의 실패를 재귀적으로 기록하지 마세요.

운영 계정이나 외부 수신자를 테스트에 사용하지 마세요. test/support/mail-admin-preview.mjs는 RUN_MAIL_ADMIN_PREVIEW=1로만 시작되는 일회용 메모리 저장소·loopback SMTP 환경이며 10분 후 종료됩니다.

공개 문서·컨피그 예제·프록시 예제에는 예약 도메인과 loopback/문서 전용 IP를 사용합니다. 실제 연결 정보는 Git에서 제외된 `.env`와 `config`에 보관합니다. 공개 파일 검사는 추적 파일과 새 공개 파일을 검사하며, 의심한 비밀값 원문은 CI 로그에 출력하지 않습니다. 배포본은 변경을 커밋한 뒤 `npm run release`로 만들고 ZIP 검사까지 통과해야 합니다. [검사 범위와 배포 절차](docs/PUBLIC-FILES.md)
