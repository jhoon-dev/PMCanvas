# 데스크톱 서명·공증과 배포

정식 배포 명령은 커밋되지 않은 변경을 거절하고 공개 파일 검사·인증서 설정 검사를 먼저 수행합니다. 서명 실패를 오류로 처리하며 macOS는 공증도 필수입니다. 웹 배포와 마찬가지로 소스 커밋을 확정한 뒤 실행하세요.

빌드는 확정된 Git 커밋에서 파일을 읽어 격리된 임시 폴더에서 진행합니다. 생성된 `app/`의 변경은 배포에 포함되지 않으며, 완성된 ASAR를 해당 커밋의 원본·변환 결과와 독립적으로 비교합니다. 빌드 정보의 커밋·개발 빌드 여부도 검증합니다.

Windows는 실행 파일과 설치 파일의 유효한 Authenticode 서명·타임스탬프를 확인합니다. macOS는 두 아키텍처 앱의 `codesign --verify`, Gatekeeper 평가, 공증 티켓을 확인합니다. 이어 빌드 머신의 아키텍처에 해당하는 최종 앱을 격리된 프로필로 실행해 저장·복구·Excel 등 기존 기능을 검사합니다. 어느 단계든 실패하면 배포 목록을 만들지 않고 CI artifact 업로드도 중단됩니다. CI는 이후 선택한 플랫폼의 모든 아키텍처에서 별도 설치·업데이트·제거·재설치 검증을 수행합니다.

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

**Desktop verification and builds**는 푸시·PR에서 Windows·macOS 테스트·감사·화면·날짜/언어·개발 실행·패키징 후 실제 실행을 검사합니다. 수동 실행의 `platform`에서 `all`(기본), `mac`, `win`을 선택합니다. 선택한 플랫폼만 설치 파일 빌드·설치 검증·공개 대상이 됩니다. 푸시·PR의 기존 양쪽 OS 검증은 유지하며 서명 단계는 PR에서 실행하지 않습니다.

### Mac만 먼저 서명하고 자동 공개하기

1. GitHub **Settings → Environments → desktop-release**에서 `MAC_CSC_LINK`(Developer ID Application P12의 base64), `MAC_CSC_KEY_PASSWORD`를 등록합니다.
2. 공증에는 `APPLE_API_KEY_BASE64`·`APPLE_API_KEY_ID`·`APPLE_API_ISSUER` 또는 `APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID` 전체를 등록합니다. Apple 계정 ID 하나로는 서명·공증할 수 없습니다.
3. **Actions → Desktop verification and builds → Run workflow**에서 배포할 브랜치를 선택하고 `platform=mac`, `signed=true`, `unsigned=false`, `publish=true`, `release_run`은 비워 둡니다.
4. Mac ARM64·Intel DMG/ZIP이 서명·공증되고 두 Mac의 설치 검증이 통과하면 `desktop-v버전` GitHub Release가 자동 공개됩니다. Windows 인증서는 필요하지 않습니다.

CLI에서도 같은 실행을 시작할 수 있습니다.

```sh
gh workflow run desktop.yml --ref main -f platform=mac -f signed=true -f publish=true
```

Windows만 선택할 때는 `platform=win`, 모두 배포할 때는 `platform=all`입니다. `signed`와 `unsigned`를 동시에 켜면 오류로 중단합니다. 설치 파일만 확인하고 공개하지 않으려면 `publish=false`로 둡니다. 기본값은 빌드·공개 모두 꺼져 있습니다.

인증서 없는 설치 파일은 `signed=false`, `unsigned=true`를 선택합니다. 이 작업은 서명용 Environment·Secrets를 사용하지 않으며 선택한 플랫폼의 설치 파일을 별도 artifact로 보관합니다. 기존 두 플랫폼 동시 빌드는 `platform=all`로 유지됩니다.

같은 실행의 `install` 작업은 선택한 플랫폼의 새 Windows 또는 Apple Silicon·Intel Mac 환경에서 공개된 0.7.1 설치 파일의 고정 SHA-256을 검증하고 실제 설치 → 현재 버전 업데이트 → 제거 → 재설치를 수행합니다. Mac은 DMG를 마운트해 앱을 복사하며 Windows는 per-user NSIS를 실행합니다. 각 단계에서 설치 폴더 밖의 프로젝트·복구·시간대 설정 해시를 비교하고 설치된 앱을 실행해 한글 데이터·완료 기록·계층·기준 계획·언어와 시간대를 확인합니다. 서명 모드는 다운로드한 Windows 설치 파일·설치된 EXE의 서명·타임스탬프 또는 Mac DMG에서 설치한 앱·ZIP에서 추출한 앱의 서명·Gatekeeper·공증 티켓을 다시 확인합니다. 결과에는 모드·커밋·버전·실제 검증한 패키지 SHA-256을 기록합니다. 이 테스트는 CI 전용이며 기존 PC의 앱과 프로필을 제거하지 않습니다.

이 검사는 설치·업데이트·제거의 데이터 보존을 확인합니다. 서명 없는 파일에 대한 SmartScreen·Gatekeeper 신뢰 획득이나 사용자별 보안 정책 승인을 대신하지 않습니다.

`signed=true` 또는 `unsigned=true`에 `publish=true`를 함께 선택하면 선택한 플랫폼의 모든 설치 작업이 성공한 뒤 공개합니다. `release` 작업만 Release 쓰기 권한을 갖고, 원본 실행의 필수 작업 성공·커밋·버전·플랫폼·서명 모드·설치 패키지·체크섬·설치 결과를 재검사합니다. Mac만 선택해도 ARM64·Intel 두 설치 결과가 모두 필요하며, 서명 모드에서는 서명·공증 검증이 없는 기록이나 다른 파일의 해시를 거부합니다.

파일을 초안에 올린 뒤 GitHub의 파일 목록·크기·SHA-256을 확인하고 `desktop-v버전` 태그로 공개합니다. 공개된 동일 버전은 덮어쓰지 않습니다. 이미 공개한 0.7.2를 서명본으로 교체하지 않고 0.7.3 등 새 버전을 사용합니다. Mac만 공개하면 해당 릴리스에는 Mac 파일만 포함하며 Windows 사용자는 이전 Windows 설치 파일을 계속 이용합니다. 웹 릴리스와 태그도 분리합니다. 검증·공증 실패나 인증서 누락 시 새 버전은 공개하지 않습니다.

공증용 임시 P8 파일은 성공·실패와 관계없이 정리하고 빌드·설치·공개 artifact에 넣지 않습니다.

참고: [electron-builder v26 서명 설정](https://www.electron.build/v26/docs/features/code-signing/), [macOS 공증](https://www.electron.build/v26/docs/notarization/).

공개 단계만 실패한 경우 원본과 같은 `platform`·서명 모드, `publish=true`, `release_run=검증된_실행_ID`로 재시도합니다. Mac 서명본이면 `platform=mac`, `signed=true`, `unsigned=false`입니다. 빌드와 서명은 다시 하지 않고 원본 실행의 필수 빌드·설치 작업 성공을 API로 재확인한 뒤 원본 패키지·검증 기록을 사용합니다. 과거 두 플랫폼 서명 없는 실행은 기존처럼 `signed=false`, `unsigned=false`, `platform=all`로 복구할 수 있습니다. 초안은 Release 목록에서 ID로 검증합니다. 이미 공개했거나 원본 커밋이 다른 릴리스는 덮어쓰지 않습니다.
