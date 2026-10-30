# PM Canvas 0.21.6

[English](README.en.md) · 한국어

팀의 업무·일정·완료 기록을 관리하는 설치형 웹 앱입니다. 표에 업무를 입력하고, 간트 차트에서 일정을 조정하며, 여러 프로젝트의 내 업무를 모아 확인합니다.

Node.js API와 PostgreSQL 18을 사용합니다. 프론트엔드는 빌드 없이 실행되는 JavaScript ES 모듈이며, Docker Compose로 앱·DB·백업 서비스를 함께 운영합니다.

웹 제품은 저장소의 `web/`에서 실행합니다. 공통 코드는 형제 `shared/`에 있으며 Docker 빌드 컨텍스트는 저장소 루트입니다.

## 설치

Node.js 22.18 이상, 실행 중인 Docker와 Compose v2가 필요합니다.

```sh
npm run setup -- --email admin@example.com
npm run service:up
```

기본 주소는 [http://localhost:3000/pmcanvas/](http://localhost:3000/pmcanvas/)입니다. 초기 관리자 비밀번호는 생성된 비공개 `.env`의 `ADMIN_PASSWORD`를 확인하세요. 첫 관리자 로그인에서는 인증 앱 MFA를 등록하고 복구 코드를 별도로 보관합니다. 로컬 포트는 setup에 `--port 4180`, 운영 도메인은 `--origin https://pm.example.com`을 지정합니다.

Linux에서는 실행 계정의 UID/GID를 자동 감지합니다. `npm run service:up`을 권장하며, Docker Compose를 직접 실행할 때는 `.env`의 `PM_RUN_UID`·`PM_RUN_GID`를 폴더 소유자에 맞추세요. root로 설치해도 앱과 백업 서비스는 root로 실행하지 않습니다.

[상세 설치·외부 DB·HTTPS 설정](docs/DEPLOYMENT.md)

## 처음 사용하는 순서

1. 새 프로젝트를 만들고 **참여인력**에 팀원을 등록합니다.
2. **업무 · 일정**의 표에서 업무명·담당자·일정·공수를 입력하고 저장합니다. Excel처럼 여러 행을 붙여넣거나 간트 막대를 끌 수 있습니다.
3. **프로젝트 관리 → 공유**에서 계정을 초대하고 **내 업무에 담당 계정 연결**을 펼쳐 참여인력과 로그인 계정을 연결합니다.
4. **내 업무**에서 담당 업무를 누르고 완료한 항목을 체크합니다. **프로젝트 전체**로 전환하면 프로젝트의 다른 업무도 확인할 수 있습니다.

계정이 필요하면 로그인 화면에서 회원가입 → 이메일 인증 → 관리자 승인을 진행합니다. 메일을 보내려면 관리자가 SMTP를 설정해야 합니다.

빈 프로젝트에는 첫 업무 등록 안내가 표시됩니다. 업무 **상세** 편집에서는 이름·담당자·일정·체크리스트를 먼저 입력하고, **분류 · 선행 업무 · 메모**를 펼쳐 추가 설정을 수정합니다. 기존 선행 업무나 메모가 있으면 자동으로 펼쳐집니다. **업무 · 일정**의 검색 조건은 **필터 초기화**로 해제할 수 있으며 저장 전 표 입력도 그대로 유지됩니다.

운영 데이터 없이 전체 흐름을 체험하려면 [로컬 데모 안내](docs/DEMO.md)를 참고하세요.

## 주요 기능

로그인 화면과 상단의 언어 선택에서 한국어·영어를 전환합니다. 브라우저 언어를 기본으로 사용하며 선택을 보관합니다. 미저장 변경이나 열린 편집 화면이 있으면 전환을 막아 입력을 보호합니다. 업무명·메모·인력 정보는 번역하지 않으며, CSV·Excel의 화면 문구와 헤더만 선택 언어로 출력합니다.

| 기능                                      | 사용 위치·안내                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| 표 입력·WBS·간트·Excel 가져오기/내려받기  | 업무 · 일정 · [WBS](docs/WBS.md), [Excel](docs/EXCEL.md)                |
| 계층·기준 계획·선행 관계·과부하·임계 경로 | 업무 · 일정의 추가 옵션 · [계산 기준](docs/PLANNING.md)                 |
| 여러 프로젝트의 내 업무·프로젝트 공유     | 내 업무·프로젝트 관리 → 공유 · [운영 안내](docs/OPERATIONS.md)          |
| 가입 승인/거절·계정 관리                  | 계정 → 관리자 설정 → 사용자 · [회원가입](docs/REGISTRATION.md)          |
| SMTP·테스트 메일·승인 요청 수신 주소      | 관리자 설정 → 메일 · [메일 설정](docs/PASSWORD-RESET.md)                |
| OIDC·SAML·AD LDAPS                        | 컨피그 및 관리자 설정 → 인증·보안 · [인증 연결](docs/AUTHENTICATION.md) |
| 30일 업무·프로젝트 복구                   | 파일 → 휴지통 · [운영 안내](docs/OPERATIONS.md)                         |
| 자동 DB 백업·실제 복원 점검               | 관리자 설정 → 백업 · [백업과 복구](docs/OPERATIONS.md)                  |
| 동시 수정 비교·선택 병합                  | 저장 충돌 때 표시 · [업무·일정](docs/WBS.md)                            |
| 운영 실패 확인·이메일 알림                | 관리자 설정 → 인증·보안 → 운영 상태 · [운영 안내](docs/OPERATIONS.md)   |

관리자 메뉴는 사용자·메일·인증·보안·백업 네 영역으로 모았습니다. 잘 쓰지 않는 설정·관리 작업은 펼쳐서 사용합니다. 관리자 MFA, CSRF, 프로젝트별 권한, 동시 수정 충돌 검사와 감사 로그를 적용합니다. [보안 운영](docs/SECURITY.md)

## 운영

```sh
npm run service:status
npm run service:logs
npm run backup
npm run restore -- backups/파일.dump pmcanvas_restore_check
npm run service:stop
```

기본 자동 백업은 매일 03시 Asia/Seoul, 14일 보관, 별도 DB 복원 점검입니다. 관리자 화면에서 바꿀 수 있습니다. DB 덤프는 `backups/`, 암호화 키는 `config/secrets/mfa.key`에 따로 둡니다. **복원에는 둘 다 필요하며, 외부 보관 장소도 분리하세요.** 0.18의 `backups/keys` 사본은 service:up 시 무결성 확인 후 `recovery-keys/`로 옮깁니다. 키 원문을 덤프 폴더에 새로 복사하지 않습니다.

업데이트 전 수동 백업을 실행하고 `.env`·`config`·DB 볼륨을 보존하세요. 복원 명령은 새 DB에만 복원하며 운영 DB를 덮어쓰지 않습니다. JSON 백업은 프로젝트 이동용이며 전체 계정·권한·이력 복구에는 DB 덤프가 필요합니다.

JSON 백업에는 WBS 미확정 입력도 보관합니다. 불러오면 입력 원문을 수정 가능한 초안으로 복구하며, 내용을 확인한 뒤 저장하세요. 기존 프로젝트는 보존됩니다. 새 프로젝트 생성이 실패해도 초안을 유지하므로 다시 저장하거나 JSON으로 재백업할 수 있습니다.

참여인력은 업무 계획 정보이고 로그인 계정은 접근 권한 정보입니다. 편집자는 공유된 프로젝트 전체를 수정할 수 있습니다. 진척률은 완료 항목의 예상 공수로 가중하며 예상 완료일은 현재 계획과 기록에 따른 추정입니다. 자원 최적화·실시간 push는 지원하지 않습니다.

## 개발과 검증

```sh
npm ci --ignore-scripts
npm run format:check
npm run public:check
npm test
npx playwright install chromium --only-shell
npm run test:browser
npm run test:performance
```

실제 HTTP/SMTP 테스트는 `RUN_HTTP_TESTS=1 npm run test:http`, PostgreSQL 테스트는 별도 `_test` DB와 `RUN_POSTGRES_TESTS=1 npm run test:postgres`로 실행합니다. CI는 테스트 데이터로 실제 복원 후 로그인·MFA·메일 발송·업무·권한도 검증합니다. [개발 지침](CONTRIBUTING.md) · [검증 기록](docs/validation/) · [변경 이력](CHANGELOG.md) · [코드 리뷰 반영](docs/REVIEW.md)

공개 문서·설정 예제에는 예약 도메인을 사용합니다. 변경을 커밋한 뒤 `npm run release`를 실행하면 공개 파일과 ZIP 내부를 검사한 배포본을 `releases/`에 만듭니다. 실제 `.env`·인증/메일 설정·키·덤프는 포함하지 않습니다. [공개 파일과 배포 검사](docs/PUBLIC-FILES.md)
