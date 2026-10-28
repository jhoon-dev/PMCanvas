# 데스크톱 서명·공증과 배포

정식 배포 명령은 커밋되지 않은 변경을 거절하고 공개 파일 검사·인증서 설정 검사를 먼저 수행합니다. 서명 실패를 오류로 처리하며 macOS는 공증도 필수입니다. 웹 배포와 마찬가지로 소스 커밋을 확정한 뒤 실행하세요.

## 로컬 설정

`desktop/.env.example`을 `desktop/.env.signing`으로 복사하고 필요한 값만 입력합니다. `.env.signing`과 인증서·Apple API 키는 Git에서 제외됩니다. 인증서 원본은 저장소 밖에 보관하세요. 비밀번호·개인 키를 명령 인수나 공개 문서에 적지 않습니다.

| 대상            | 설정                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Windows         | `WIN_CSC_LINK`에 PFX 파일 경로나 base64 인증서, `WIN_CSC_KEY_PASSWORD`에 인증서 암호                                                |
| macOS 서명      | `CSC_LINK`에 Developer ID Application P12 경로나 base64 인증서, `CSC_KEY_PASSWORD`에 암호. 기존 키체인의 `CSC_NAME`도 지원          |
| macOS 공증 권장 | `APPLE_API_KEY`에 저장소 밖의 P8 파일 경로, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`를 모두 설정                                      |
| macOS 공증 대안 | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`를 모두 설정하거나 `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`을 모두 설정 |

Windows 인증서는 발급 기관에서, macOS 인증서·공증 권한은 Apple Developer 계정에서 준비해야 합니다. 이 프로젝트가 인증서를 발급하거나 결제하지 않습니다. 플랫폼에 맞는 실제 인증서가 없으면 정식 배포 검사는 중단됩니다.

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

## GitHub Actions

`desktop-release` Environment를 만들고 필요하면 승인 규칙을 지정하세요. 다음 Secrets를 등록합니다.

- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
- macOS 서명: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`
- macOS 공증: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` 또는 Apple ID 방식의 세 변수

P8 원본은 `APPLE_API_KEY_BASE64`에 base64로 넣습니다. 워크플로가 macOS 임시 디렉터리에 현재 사용자 전용 파일로 준비합니다. 로컬 `APPLE_API_KEY`는 파일 경로를 사용합니다.

**Desktop verification and builds**는 푸시·PR에서 Windows·macOS 테스트·감사·화면·날짜/언어·개발 실행·패키징 후 실제 실행을 검사합니다. 수동 실행에서 `signed=true`를 선택하면 자동 검증 후 `desktop-release`의 서명 설정으로 양쪽 정식 배포 파일을 만듭니다. 서명 단계는 PR에서 실행하지 않습니다. 결과는 Actions artifact이며 GitHub Release 자동 공개는 하지 않습니다.

서명된 실제 설치 파일로 기존 사용자 데이터 보존·설치·업데이트·제거와 OS 신뢰 확인까지 검증한 후 배포하세요. 자동 CI의 패키지 실행 검사는 시스템 설치·제거를 대체하지 않습니다.

참고: [electron-builder v26 서명 설정](https://www.electron.build/v26/docs/features/code-signing/), [macOS 공증](https://www.electron.build/v26/docs/notarization/).
