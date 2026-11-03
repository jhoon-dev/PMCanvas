# 데스크톱 서명·공증과 배포

개발자 **jhoon-dev** · 브랜드 **Toolmoa** · 제품명 **PM Canvas** · App ID **`app.toolmoa.pmcanvas`**.

## 공개 배포 정책

Windows는 **Microsoft Store MSIX만 배포**합니다. `npm run dist:win`으로 만든 제출용 MSIX는 Partner Center에 제출하며, 사용자는 Microsoft Store가 서명한 패키지를 설치합니다. 제출 전 unsigned MSIX를 사용자 다운로드로 공개하지 않습니다. [Windows Store 절차](WINDOWS-STORE.md)를 따르세요.

EXE 공개 배포와 모든 플랫폼의 무서명 설치 파일 공개는 종료했습니다. 기존 무서명 데스크톱 릴리스 0.7.1·0.7.2·0.8.0·0.8.1·0.8.2는 공개 배포를 해제했습니다. EXE 배포·무서명 배포용 npm 명령과 CI 작업을 제거했으며, 게시 스크립트와 CI 계획 검사는 이전 실행의 재시도에서도 Windows EXE·무서명 게시를 거부합니다.

macOS의 GitHub 배포는 Developer ID 서명·Apple 공증을 모두 검증한 파일만 허용합니다. Mac App Store는 별도 [MAS 절차](MAC-APP-STORE.md)를 사용합니다. 인증서가 없거나 공증에 실패하면 무서명 파일로 대체 게시하지 않습니다.

## Windows

```sh
cd desktop
npm ci
npm run release:check:win
npm run dist:win
```

Store용 환경 변수는 [Windows Store 문서](WINDOWS-STORE.md)에 따라 설정합니다. Store 배포를 위해 별도 Windows EXE 코드 서명 인증서를 구매할 필요는 없습니다.

`npm run pack`·`npm run dist:win:dev`는 로컬 개발과 이전 설치본의 데이터 보존 검증용입니다. 생성된 EXE를 GitHub Release나 사용자 다운로드에 올리지 않습니다. 앱의 파일 옵션 → 앱 정보에서 버전·개발자·브랜드·소스 커밋을 확인할 수 있습니다.

## macOS 서명·공증

인증서·개인 키·공증용 API 키와 비공개 설정은 [Mac 설정 가이드](MAC-SETUP.md)를 따릅니다. 개인 키·암호·P12·P8을 저장소나 공개 artifact에 포함하지 않습니다.

```sh
cd desktop
npm run release:check:mac
npm run dist:mac
```

빌드는 커밋된 파일만 격리된 폴더에 준비합니다. 공개 파일 검사·앱 허용 목록·ASAR 원본 비교·네이티브 실행 검증을 수행하며, Mac 앱은 codesign·Gatekeeper·공증 티켓 검증을 모두 통과해야 합니다. ARM64·Intel 설치·업데이트·제거·재설치 검증도 필요합니다.

## GitHub Actions

Windows 제출은 **Windows Store MSIX** 워크플로에서 `submission=true`를 사용합니다. 사용자 배포는 Store 심사·서명 이후에 이루어집니다.

Mac 서명 배포는 **Desktop verification and builds**에서 `platform=mac`, `signed=true`로 실행합니다. 먼저 `publish=false`로 확인하고, 검증 후 `publish=true`로 공개합니다. `unsigned` 선택지와 Windows EXE 게시 경로는 제공하지 않습니다.

```sh
gh workflow run desktop.yml --ref main -f platform=mac -f signed=true -f publish=true
```

공개만 재시도할 때도 `platform=mac`, `signed=true`, `publish=true`, `release_run=검증된_실행_ID`를 사용합니다. 원본 작업의 성공·소스 커밋·버전·설치 기록·파일 크기·SHA-256·서명·공증을 다시 검증합니다. 공개된 동일 버전이나 다른 커밋의 초안을 덮어쓰지 않습니다. 과거 무서명 실행의 재공개는 허용하지 않습니다.

이전 설치본은 공개 해제한 초안으로 보관합니다. CI는 고정 소스 커밋 `7c57c3d10129a761b61dfc5ae06f55e8103570b0`에서 **0.7.1 마이그레이션 검증 설치본을 일회용으로 재현**합니다. 당시 lockfile의 생산 의존성, 기존 앱 ID·프로필·설치 설정을 사용하고 패키지 원본·소스 커밋·생성 파일 SHA-256을 확인합니다. 재현한 설치본은 당시 공개 파일과 바이트 동일성을 주장하지 않으며, 러너 임시 폴더에만 두고 artifact로 공개하지 않습니다. 추가 토큰이나 저장소 쓰기 권한을 부여하지 않습니다.

웹 서버 배포 ZIP은 별도 제품·워크플로로 관리합니다.
