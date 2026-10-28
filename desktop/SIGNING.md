# 데스크톱 서명·공증과 배포

정식 배포 명령은 커밋되지 않은 변경을 거절하고 공개 파일 검사·인증서 설정 검사를 먼저 수행합니다. 서명 실패를 오류로 처리하며 macOS는 공증도 필수입니다. 웹 배포와 마찬가지로 소스 커밋을 확정한 뒤 실행하세요.

빌드는 확정된 Git 커밋에서 파일을 읽어 격리된 임시 폴더에서 진행합니다. 생성된 `app/`의 변경은 배포에 포함되지 않으며, 완성된 ASAR를 해당 커밋의 원본·변환 결과와 독립적으로 비교합니다. 빌드 정보의 커밋·개발 빌드 여부도 검증합니다.

Windows는 실행 파일과 설치 파일의 유효한 Authenticode 서명·타임스탬프를 확인합니다. macOS는 두 아키텍처 앱의 `codesign --verify`, Gatekeeper 평가, 공증 티켓을 확인합니다. 이어 빌드 머신의 아키텍처에 해당하는 최종 앱을 격리된 프로필로 실행해 저장·복구·Excel 등 기존 기능을 검사합니다. 어느 단계든 실패하면 배포 목록을 만들지 않고 CI artifact 업로드도 중단됩니다. 다른 아키텍처의 실제 실행과 설치·업데이트·제거는 별도 OS 검증이 필요합니다.

## 로컬 설정

`desktop/.env.example`을 `desktop/.env.signing`으로 복사하고 필요한 값만 입력합니다. `.env.signing`과 인증서·Apple API 키는 Git에서 제외됩니다. 인증서 원본은 저장소 밖에 보관하세요. 비밀번호·개인 키를 명령 인수나 공개 문서에 적지 않습니다.

| 대상            | 설정                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Windows         | `WIN_CSC_LINK`에 PFX 파일 경로나 base64 인증서, `WIN_CSC_KEY_PASSWORD`에 인증서 암호                                                |
| macOS 서명      | `CSC_LINK`에 Developer ID Application P12 경로나 base64 인증서, `CSC_KEY_PASSWORD`에 암호. 기존 키체인의 `CSC_NAME`도 지원          |
| macOS 공증 권장 | `APPLE_API_KEY`에 저장소 밖의 P8 파일 경로, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`를 모두 설정                                      |
| macOS 공증 대안 | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`를 모두 설정하거나 `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`을 모두 설정 |

Windows 인증서는 발급 기관에서, macOS 인증서·공증 권한은 Apple Developer 계정에서 준비해야 합니다. 이 프로젝트가 인증서를 발급하거나 결제하지 않습니다. 플랫폼에 맞는 실제 인증서가 없으면 정식 배포 검사는 중단됩니다.

Windows의 하드웨어 토큰·인증서 저장소에 설치된 인증서는 `WIN_CSC_SHA1`에 지문을 지정할 수 있습니다. 개인 키를 내보낼 수 없는 인증서에도 사용하며 해당 공급자의 드라이버·토큰 인증이 필요합니다. 자체 서명 인증서는 공개 배포용 발급자 신뢰를 제공하지 않습니다.

Apple 계정 아이디만으로는 서명할 수 없습니다. Apple Developer Program의 Developer ID Application 인증서와 개인 키, 공증용 앱 암호 또는 API 키가 필요합니다. 가입·본인 확인·약관·발급 비용과 계정 로그인은 계정 소유자가 처리해야 합니다. 인증서를 확보한 후 위 비공개 설정을 채우면 정식 빌드가 서명·공증·검증을 수행합니다. 계정 주소·인증서·암호·개인 키는 공개 저장소에 넣지 마세요.

각 운영체제의 `desktop/`에서 실행합니다.

```sh
# 먼저 변경사항을 검토해 커밋합니다.
npm run release:check:win
npm run dist:win

# macOS에서
npm run release:check:mac
npm run dist:mac
```

`dist/release-버전-win/` 또는 `dist/release-버전-mac/`에 서명된 설치 파일, 파일별 `.sha256`, `release-manifest.json`이 생깁니다. 목록에는 제품·버전·소스 커밋과 설치 파일의 SHA-256이 기록됩니다. 같은 출력 폴더에 기존 결과가 있으면 덮어쓰지 않습니다. 인증 정보는 생성된 빌드 설정과 목록에 기록하지 않습니다.

인증서 없는 로컬 기능 검증은 `npm run pack` 또는 `npm run dist:win:dev`를 사용합니다. 이는 정식 서명 배포가 아닙니다. 앱의 **파일 옵션 → 앱 정보**에서 버전·기준 커밋·개발 빌드 여부를 확인할 수 있습니다. 개발 빌드가 미커밋 소스를 사용하면 기준 커밋과 코드가 다를 수 있습니다.

## 인증서 없는 설치 파일

커밋된 소스의 임시 배포에는 Windows에서 `npm run dist:unsigned:win`, Mac에서 `npm run dist:unsigned:mac`을 실행합니다. 서명 인증 정보를 빌드 환경에서 제거하고 출력 폴더를 덮어쓰지 않습니다. 패키지 원본 검사와 실제 앱 실행을 통과하면 `dist/unsigned-버전-win/` 또는 `dist/unsigned-버전-mac/`에 설치 파일·SHA-256·`unsigned-manifest.json`을 기록합니다. 목록에 서명·공증이 없음을 명시합니다.

Mac은 실행에 필요한 임시 ad-hoc 서명만 적용합니다. 이는 Developer ID 서명이나 Apple 공증이 아니며 Gatekeeper의 신뢰를 제공하지 않습니다. 실제 실행 검사는 빌드 머신의 아키텍처를 대상으로 하며 다른 Mac 아키텍처의 실행·설치·업데이트·제거 검증은 별도입니다. Windows 역시 발급자 서명이 없으므로 배포 파일의 출처와 SHA-256을 확인하세요.

## GitHub Actions

`desktop-release` Environment를 만들고 필요하면 승인 규칙을 지정하세요. 다음 Secrets를 등록합니다.

- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
- macOS 서명: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`
- macOS 공증: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` 또는 Apple ID 방식의 세 변수

P8 원본은 `APPLE_API_KEY_BASE64`에 base64로 넣습니다. 워크플로가 macOS 임시 디렉터리에 현재 사용자 전용 파일로 준비합니다. 로컬 `APPLE_API_KEY`는 파일 경로를 사용합니다.

**Desktop verification and builds**는 푸시·PR에서 Windows·macOS 테스트·감사·화면·날짜/언어·개발 실행·패키징 후 실제 실행을 검사합니다. 수동 실행에서 `signed=true`를 선택하면 자동 검증 후 `desktop-release`의 서명 설정으로 양쪽 정식 배포 파일을 만듭니다. 서명 단계는 PR에서 실행하지 않습니다. 결과는 Actions artifact이며 GitHub Release 자동 공개는 하지 않습니다.

인증서 없는 설치 파일은 수동 실행의 `unsigned=true`를 선택합니다. 이 작업은 서명용 Environment·Secrets를 사용하지 않으며 Windows 설치 파일과 Mac ARM64·x64 DMG/ZIP을 별도 artifact로 보관합니다.

같은 실행의 `install` 작업은 새 Windows·Apple Silicon Mac·Intel Mac 환경에서 공개된 0.7.1 설치 파일의 고정 SHA-256을 검증하고 실제 설치 → 현재 버전 업데이트 → 제거 → 재설치를 수행합니다. Mac은 DMG를 마운트해 앱을 복사하며 Windows는 per-user NSIS를 실행합니다. 각 단계에서 설치 폴더 밖의 프로젝트·복구·시간대 설정 해시를 비교하고 설치된 앱을 실행해 한글 데이터·완료 기록·계층·기준 계획·언어와 시간대를 확인합니다. 결과는 `install-lifecycle-*` artifact입니다. 이 테스트는 CI 전용이며 기존 PC의 앱과 프로필을 제거하지 않습니다.

이 검사는 설치·업데이트·제거의 데이터 보존을 확인합니다. 서명 없는 파일에 대한 SmartScreen·Gatekeeper 신뢰 획득이나 사용자별 보안 정책 승인을 대신하지 않습니다. Release 공개 전 세 설치 작업의 성공과 체크섬을 확인하세요.

`unsigned=true`와 `publish=true`를 함께 선택하면 세 설치 작업이 모두 성공한 뒤 공개합니다. `release` 작업만 Release 쓰기 권한을 갖고, 동일 실행의 원본 커밋·다섯 설치 패키지·체크섬·세 설치 결과를 재검사합니다. 파일을 초안에 올린 뒤 GitHub의 크기·SHA-256을 확인하고 `desktop-v버전` 태그로 공개합니다. 공개된 동일 버전은 덮어쓰지 않으며 웹 릴리스와 태그를 분리합니다. 검증 실패 시 새 버전은 공개하지 않습니다. 수동 빌드의 기본값은 공개하지 않는 설정입니다.

서명된 실제 설치 파일로 기존 사용자 데이터 보존·설치·업데이트·제거와 OS 신뢰 확인까지 검증한 후 배포하세요. 자동 CI의 패키지 실행 검사는 시스템 설치·제거를 대체하지 않습니다.

참고: [electron-builder v26 서명 설정](https://www.electron.build/v26/docs/features/code-signing/), [macOS 공증](https://www.electron.build/v26/docs/notarization/).
