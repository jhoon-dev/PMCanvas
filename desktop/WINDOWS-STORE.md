# Windows Microsoft Store 배포 — MSIX

Windows의 유일한 공개 배포 경로는 **MSIX → Partner Center → Microsoft Store**입니다. Mac은 Developer ID 서명·공증 후 GitHub Release를 사용합니다. Store는 제출된 MSIX를 심사한 뒤 서명을 제공하므로 Store 배포를 위해 Windows 코드 서명 인증서를 따로 구매할 필요가 없습니다. CI가 만드는 제출 파일은 아직 Store 서명이 없는 파일이며 사용자에게 직접 설치용으로 배포하지 않습니다. [Microsoft 배포 안내](https://learn.microsoft.com/en-us/windows/apps/publish/get-started)

## 1.9.1 재제출 대상 — 2026-11-09

2026-11-09 심사에서 1.9.0은 기본 Electron 타일 이미지(On Device Tiles)와 `unvirtualizedResources` 권한(10.6.3)으로 반려되었습니다. **기존 1.9.0 파일은 재제출하지 않습니다.**

1.9.1은 PM Canvas 고유 P·일정 막대 아이콘을 사용하고, `unvirtualizedResources` 및 파일 시스템 가상화 예외를 모두 제거합니다. Electron 실행용 `runFullTrust`만 유지합니다. 앱 버전은 **1.9.1**, MSIX **1.9.1.0**입니다. 새 파일은 소스·해시·네이티브 실행·MakeAppx 검증 결과를 `store-manifest.json`에 기록합니다.

[1.9.1 변경 및 데이터 보존 안내](../docs/manuals/desktop/1.9.1/README.ko.md)를 확인하세요. 기능별 상세 사용법과 예제 화면은 [1.9.0 매뉴얼](../docs/manuals/desktop/1.9.0/README.ko.md)을 이어서 사용합니다. 심사·게시는 [Partner Center](https://partner.microsoft.com/ko-kr/dashboard/products/9NV119XJGQ7J/overview)에서 별도로 확인합니다.

## 1. 앱 예약 후 설정할 값

1. Microsoft Partner Center 개발자 계정을 준비하고 요구되는 계정 확인·약관을 완료합니다.
2. 새 제품에서 Windows **MSIX** 앱을 만들고 앱 이름을 예약합니다.
3. 앱의 **Product management → Product identity**에서 아래 값을 그대로 복사합니다. 화면에 `Package/Identity/Name`, `Package/Identity/Publisher`, `Package/Properties/PublisherDisplayName`처럼 표시될 수 있습니다.
4. GitHub **Settings → Environments → desktop-store → Environment variables**에 등록합니다. 이 값들은 Store 패키지에 들어가는 공개 제품 ID이며 서명 키·비밀번호가 아닙니다. 계정 개인 정보가 포함될 수 있으므로 예제·소스에는 실제 값을 넣지 않습니다.

| GitHub Variable / 로컬 환경 변수  | Partner Center 값                         |
| --------------------------------- | ----------------------------------------- |
| `PM_STORE_IDENTITY_NAME`          | Package/Identity/Name                     |
| `PM_STORE_PUBLISHER`              | Package/Identity/Publisher — `CN=…` 전체  |
| `PM_STORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName   |
| `PM_STORE_PRODUCT_ID`             | Store product ID — Store 링크의 12자리 ID |

선택 변수 `PM_STORE_DISPLAY_NAME`에는 예약한 앱 표시 이름을 넣습니다. 기본값은 `PM Canvas`이며, 다른 이름으로 예약했다면 그 이름을 설정하세요. 이 값은 앱의 프로필 폴더명·파일 형식을 바꾸지 않습니다.

로컬에서는 `desktop/store.env.example`을 `.env.msix`로 복사해 채웁니다. `.env.msix`는 Git에서 제외됩니다. 아직 예약하지 않았다면 빈 상태로 두세요. 제출 빌드는 빈 값·예제 값·잘못된 ID를 거부합니다. 임의 ID의 테스트 파일을 실제 앱으로 제출하지 않습니다.

## 2. 빌드와 검증

**Actions → Windows Store MSIX**는 푸시·PR에서 Windows에 실제 MSIX 테스트 패키지를 만들어 설치합니다. 이 패키지는 실행 ID로 만든 별도 테스트 ID와 일회용 자체 서명 인증서를 사용하며 CI에만 등록합니다. 테스트 인증서·개인 키는 공개 artifact에 넣지 않습니다. 사용자 PC나 실제 Store 앱 ID에는 설치하지 않습니다.

검증 흐름은 마이그레이션 검증용 EXE 설치 → 한글 프로젝트·완료 기록·WBS 계층·기준 계획·언어·시간대 저장 → 등록된 MSIX로 전환 → MSIX 버전 업데이트 → 제거 → 재설치입니다. 실제 패키지 ID로 실행되는지, 복구·설정·프로젝트가 유지되는지, Store 업데이트 안내와 Excel 보조 프로세스가 동작하는지 확인합니다.

`unvirtualizedResources`와 가상화 예외를 선언하지 않습니다. 기본 MSIX 가상화를 유지합니다. [Microsoft 가상화 설명](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)

Store 버전의 설정·언어·자동 복구 프로필은 `%USERPROFILE%\PM Canvas\Profile`에 저장합니다. 이 위치는 AppData 가상화 밖에 있으므로 업데이트·앱 제거·재설치 후에도 유지됩니다. 프로젝트 파일은 사용자가 지정한 기존 위치에 남습니다.

최초 실행 시 새 프로필이 없으면 `%APPDATA%\pmcanvas-desktop` 또는 이전 `%APPDATA%\PM Canvas Desktop`의 작업·설정이 있는 프로필을 복사합니다. 원본을 이동하거나 삭제하지 않습니다. 캐시·실행 잠금은 제외하고, 임시 폴더로 완전히 복사한 뒤 새 프로필로 전환합니다. 복사 실패 시 부분 프로필로 시작하지 않습니다. 새 프로필이 있으면 재복사하지 않으므로 새 Store 작업을 이전 EXE 데이터로 덮어쓰지 않습니다.

기존 EXE에서 Store로 옮길 때는 프로젝트를 먼저 저장하고 기존 앱을 완전히 종료하세요. MSIX가 이전 NSIS 앱을 자동 제거하지는 않습니다. 전환 후에는 두 앱을 번갈아 사용하지 마세요. 서로 다른 프로필을 사용하며 이후 변경은 자동 동기화되지 않습니다. 이전 EXE 제거는 Store에서 데이터 확인 뒤 진행합니다.

앱 제거는 위 새 프로필과 기존 EXE 원본·프로젝트를 지우지 않습니다. 전체 데이터 삭제를 원하면 앱 종료 후 위 프로필 및 직접 저장한 파일을 사용자가 삭제합니다.

## 3. 제출용 파일 만들기

예약한 ID를 설정한 뒤 **Actions → Windows Store MSIX → Run workflow → submission=true**로 실행합니다. CI 설치 검증이 성공해야 실제 설정으로 제출 파일을 빌드합니다.

```sh
gh workflow run desktop-store.yml --ref main -f submission=true
```

완료 후 **PMCanvas-Windows-Store-submission** artifact를 받습니다.

- `PMCanvas-Desktop-버전-Windows-x64-Store.msix`
- 같은 이름의 `.sha256`
- 소스 커밋·Store ID·파일 해시·검증 결과를 담은 `store-manifest.json`

Windows x64에서 로컬 빌드도 가능합니다.

```sh
cd desktop
npm ci
npm run release:check:win
npm run dist:win
```

현재 고정된 electron-builder의 안정적인 unpacked 패키징과 체크섬이 고정된 Windows SDK MakeAppx를 사용합니다. MSIX를 단순히 확장자만 바꿔 만들지 않습니다. SDK의 manifest/pack 검증, MSIX 추출 후 전체 payload 비교, ASAR 원본 커밋 검사, 네이티브 앱 실행을 통과해야 제출 목록을 만듭니다. 기존 출력 폴더는 덮어쓰지 않습니다.

Store 패키지 버전은 앱의 세 필드 `[major, minor, patch]`에 Windows의 예약 필드 `0`만 붙인 `[major, minor, patch, 0]`입니다. 앱 `1.9.1`은 패키지 MSIX **1.9.1.0**이며 앱 정보·파일 버전·Store에서 같은 앞 세 숫자를 사용합니다. Store는 첫 숫자 0을 허용하지 않고 네 번째 숫자를 0으로 예약하므로, 각 필드를 65535 이하로 설정합니다. [Microsoft 패키지 버전 규칙](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

다른 파일을 다시 제출하려면 앱 버전도 함께 올리세요. CI 실행 번호로 패키지 버전을 바꾸지 않습니다. 이전 설정의 `PM_STORE_BUILD_NUMBER`가 0이 아니면 빌드를 거부합니다. 동일한 전체 패키지 이름에 다른 파일을 올리면 Partner Center가 거부합니다.

## 4. Partner Center 제출과 공개

1. 앱에 새 submission을 만들고 Packages에 검증된 **Store.msix** 파일을 올립니다.
2. 예약 ID·Publisher·표시 이름이 일치하는지 확인합니다. 불일치하면 Partner Center 값으로 설정을 고쳐 새 버전 패키지를 만듭니다.
3. 앱 설명·한국어/영어 스토어 문구·스크린샷·지원 정보·실제 데이터 처리에 맞는 개인정보처리방침 URL·연령 등급·배포 국가 등을 작성합니다.
4. 제한 기능 사용 사유에는 `runFullTrust`: 오프라인 Electron 데스크톱 앱 실행이라고 설명합니다. `unvirtualizedResources` 요청은 제거하고, 지원 URL에 `https://github.com/jhoon-dev/PMCanvas/issues`를 기재합니다. 기존 제출에서 등록한 권한 사용 사유도 갱신하세요.
5. 인증 참고 사항에 기본 아이콘 교체와 `unvirtualizedResources`·가상화 예외 제거를 명시하고, 새 패키지로 심사를 제출합니다. 연락처 추가만으로 기존 권한 거절이 해소되는 것은 아닙니다.
6. 승인·공개 후 실제 Store 설치본을 내려받아 파일 열기·저장·Excel·업데이트를 최종 확인합니다.

현재 CI는 **제출 파일 생성**까지 자동화합니다. Partner Center 계정/제품 예약과 심사 제출·공개는 계정 소유자가 진행합니다. 이 단계에서 Store 앱 등록·공개를 완료했다고 표시하지 않습니다. Microsoft의 심사 없이 GitHub Release에 미서명 MSIX를 설치용으로 공개하지 않습니다.

## 5. 업데이트와 호환 경로

Store에서 실행된 앱은 Electron의 실제 패키지 식별 상태로 채널을 구분합니다. **업데이트 확인**은 Microsoft Store 라이브러리로 안내하고 GitHub 설치 파일을 조회하지 않습니다. Mac과 기존 EXE는 기존 GitHub 버전 확인을 유지합니다.

Windows 공개 배포는 `dist:win` → Partner Center → Microsoft Store만 사용합니다. 기존 EXE·무서명 설치 파일은 공개 배포에서 제외했습니다. `dist:win:dev`와 이전 EXE는 개발·CI 마이그레이션 검증 전용이며 사용자 다운로드로 게시하지 않습니다.

## 6. 재제출 시 인증 참고 사항 예문

```text
This submission addresses certification policies On Device Tiles and 10.6.3.
All on-device tile and executable icons now use original PM Canvas artwork.
The unvirtualizedResources capability and all virtualization exemptions have been removed.
The package retains only runFullTrust to run the offline Electron desktop application.
User-selected project files remain in their existing locations. The Store profile is stored
under the user's home folder, outside AppData, without disabling MSIX virtualization.
Existing EXE profiles are copied once without modifying or deleting the originals.
Developer website: https://github.com/jhoon-dev/PMCanvas
Support: https://github.com/jhoon-dev/PMCanvas/issues
```
