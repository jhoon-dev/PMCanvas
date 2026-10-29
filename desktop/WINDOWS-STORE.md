# Windows Microsoft Store 배포 — MSIX

Windows의 기본 배포 경로는 **MSIX → Partner Center → Microsoft Store**입니다. Mac은 Developer ID 서명·공증 후 GitHub Release를 사용합니다. Store는 제출된 MSIX를 심사한 뒤 서명을 제공하므로 Store 배포를 위해 Windows 코드 서명 인증서를 따로 구매할 필요가 없습니다. CI가 만드는 제출 파일은 아직 Store 서명이 없는 파일이며 사용자에게 직접 설치용으로 배포하지 않습니다. [Microsoft 배포 안내](https://learn.microsoft.com/en-us/windows/apps/publish/get-started)

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

선택 변수 `PM_STORE_DISPLAY_NAME`에는 예약한 앱 표시 이름을 넣습니다. 기본값은 `PM Canvas Desktop`이며, 다른 이름으로 예약했다면 그 이름을 설정하세요. 이 값은 앱의 프로필 폴더명·파일 형식을 바꾸지 않습니다.

로컬에서는 `desktop/store.env.example`을 `.env.msix`로 복사해 채웁니다. `.env.msix`는 Git에서 제외됩니다. 아직 예약하지 않았다면 빈 상태로 두세요. 제출 빌드는 빈 값·예제 값·잘못된 ID를 거부합니다. 임의 ID의 테스트 파일을 실제 앱으로 제출하지 않습니다.

## 2. 빌드와 검증

**Actions → Windows Store MSIX**는 푸시·PR에서 Windows에 실제 MSIX 테스트 패키지를 만들어 설치합니다. 이 패키지는 실행 ID로 만든 별도 테스트 ID와 일회용 자체 서명 인증서를 사용하며 CI에만 등록합니다. 테스트 인증서·개인 키는 공개 artifact에 넣지 않습니다. 사용자 PC나 실제 Store 앱 ID에는 설치하지 않습니다.

검증 흐름은 기존 0.7.1 EXE 설치 → 한글 프로젝트·완료 기록·WBS 계층·기준 계획·언어·시간대 저장 → 등록된 MSIX로 전환 → MSIX 버전 업데이트 → 제거 → 재설치입니다. 실제 패키지 ID로 실행되는지, 복구·설정·프로젝트가 유지되는지, Store 업데이트 안내와 Excel 보조 프로세스가 동작하는지 확인합니다.

앱 데이터 보존을 위해 `runFullTrust` 및 `unvirtualizedResources` 제한 기능을 선언합니다. Windows 11에서는 기존 앱의 두 Roaming AppData 폴더만 가상화에서 제외하고, 이전 Windows에서는 파일 쓰기 가상화를 비활성화합니다. 레지스트리 가상화는 비활성화하지 않습니다. **Partner Center 제출 시 제한 기능 사용 이유를 설명하고 승인을 받아야 합니다.** 사용자 작업·복구·기존 EXE 데이터 보존이 이유이며, 승인 여부를 CI 테스트가 대신하지 않습니다. [Microsoft 가상화 설명](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)

프로젝트는 설치 폴더 밖에 저장합니다. 앱은 기존 파일·프로필을 자동 삭제하지 않습니다. 기존 EXE에서 Store로 옮길 때는 프로젝트를 먼저 저장하고 앱을 종료합니다. MSIX 설치가 기존 NSIS 앱을 자동 제거하지는 않습니다. 이전 EXE 제거는 Store 전환과 데이터 확인 뒤 진행하세요.

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

Store 패키지 버전은 앱의 세 필드 `[major, minor, patch]`를 네 필드 `[major+1, minor, patch, 0]`으로 변환합니다. 예를 들어 앱 `0.7.4`는 패키지 필드 `[1, 7, 4, 0]`입니다. 실제 manifest에는 점으로 연결해 기록합니다. Store의 첫 숫자 0 금지·네 번째 숫자 0 예약 규칙을 지키며 앱 정식 버전도 증가 순서를 유지합니다. [Microsoft 패키지 버전 규칙](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

## 4. Partner Center 제출과 공개

1. 앱에 새 submission을 만들고 Packages에 검증된 **Store.msix** 파일을 올립니다.
2. 예약 ID·Publisher·표시 이름이 일치하는지 확인합니다. 불일치하면 Partner Center 값으로 설정을 고쳐 새 버전 패키지를 만듭니다.
3. 앱 설명·한국어/영어 스토어 문구·스크린샷·지원 정보·실제 데이터 처리에 맞는 개인정보처리방침 URL·연령 등급·배포 국가 등을 작성합니다.
4. 제한 기능 사용 사유에 `runFullTrust`: Electron 데스크톱 앱 실행, `unvirtualizedResources`: 기존 EXE 프로필·사용자 복구 파일을 보존하고 재설치 시 계속 사용한다고 설명합니다.
5. 검토 후 인증 심사를 제출하고 결과를 확인합니다. Store 정책·계정 권한·제한 기능 승인이 필요합니다.
6. 승인·공개 후 실제 Store 설치본을 내려받아 파일 열기·저장·Excel·업데이트를 최종 확인합니다.

현재 CI는 **제출 파일 생성**까지 자동화합니다. Partner Center 계정/제품 예약과 심사 제출·공개는 계정 소유자가 진행합니다. 이 단계에서 Store 앱 등록·공개를 완료했다고 표시하지 않습니다. Microsoft의 심사 없이 GitHub Release에 미서명 MSIX를 설치용으로 공개하지 않습니다.

## 5. 업데이트와 호환 경로

Store에서 실행된 앱은 Electron의 실제 패키지 식별 상태로 채널을 구분합니다. **업데이트 확인**은 Microsoft Store 라이브러리로 안내하고 GitHub 설치 파일을 조회하지 않습니다. Mac과 기존 EXE는 기존 GitHub 버전 확인을 유지합니다.

기존 EXE의 설치 복구용 `dist:unsigned:win`, `dist:win:dev`와 별도 인증서를 사용하는 `dist:win:legacy`는 남아 있습니다. 새 Windows 기본 명령 `dist:win`과 기본 안내는 MSIX Store 경로입니다. 기존 공개 EXE 파일은 덮어쓰거나 제거하지 않습니다.
