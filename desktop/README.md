# PM Canvas Desktop 0.2.0

형제 shared/ 폴더의 계산·검증 코드를 사용하는 Windows·macOS용 오프라인 앱의 개발 초기 버전입니다. 사용자 PC에는 Node.js·Docker·PostgreSQL 설치가 필요하지 않습니다.

## 사용 범위

- 프로젝트 현황: 공수 가중 진척률, 계획 진척률, 예상 완료일, 지연 업무.
- 업무 · 일정: 업무·담당자·시작/종료일·선행 업무·세부 체크리스트, 조회용 간트.
- 완료 체크: 보고 기준일에 실제 완료 기록. 미래 날짜 입력 제한.
- 참여인력: 이름·역할·등급·하루 근무시간·투입률.
- 보고서: 기준일별 업무 현황, 기간·담당자별 완료 기록 조회와 Excel(.xlsx)·CSV 저장.
- Excel: 입력 양식 저장, 시트·열 연결, 오류 미리보기 후 새 업무 추가 또는 ID로 기존 업무 갱신.
- 파일: 새 프로젝트, 열기, 저장, 다른 이름으로 저장, 웹 JSON 가져오기/내보내기.
- 입력 적용 시 복구 사본 저장. 재시작 시 미저장 작업 복구와 최근 문서 다시 열기.
- 종료·새 문서·열기 시 미저장 변경 보호. 외부 파일 변경은 덮어쓰기 차단.

파일 하나가 프로젝트 하나입니다. `.pmcanvas`는 기존 `pm-canvas-project` 버전 1 JSON 형식을 사용합니다. 웹에서 백업한 JSON은 원본을 덮어쓰지 않도록 새 문서로 가져옵니다. 웹으로 옮길 때는 **파일 옵션 → 웹 JSON 내보내기** 후 웹 버전에서 불러옵니다.

웹의 WBS 계층·기준 계획은 파일에서 보존하지만 데스크톱의 전용 편집 UI는 아직 없습니다. 웹에 미확정 WBS 입력이 있으면 웹에서 먼저 저장한 후 다시 백업해야 합니다. 계정·권한 정보는 가져오지 않습니다.

보고서 화면에서 **파일 형식**을 Excel 또는 CSV로 선택하고 저장하세요. Excel 업무 현황에는 WBS·세부 작업·간트가 포함됩니다. 완료 기록은 조회 기간과 담당자를 반영합니다. 날짜·공수·진척률은 Excel 데이터 형식이며 사용자 입력은 수식이 아닌 문자열로 저장합니다. CSV의 UTF-8 BOM과 수식 주입 방지도 유지합니다. 입력창에서 적용한 미저장 변경도 포함하지만 프로젝트 파일의 저장 상태는 바꾸지 않습니다.

**파일 옵션 → Excel 입력 양식 저장**에서 양식을 만들고 WBS 시트에 입력하세요. 담당자는 현재 프로젝트의 참여인력을 사용합니다. **Excel 가져오기**에서 파일·시트·열을 연결하고 **미리보기 → 프로젝트에 적용**을 누릅니다. 적용 전에는 문서를 바꾸지 않으며, 적용 후에도 프로젝트 파일은 별도로 저장해야 합니다. 원본 Excel 파일은 덮어쓰지 않습니다. 기존 업무 갱신은 내보낸 업무 ID를 사용하고, 생략한 업무·완료 기록·변경하지 않은 세부 작업을 보존합니다.

가져오기는 XLSX 4MB·시트 12개·머리글 포함 501행·40열까지 지원합니다. 수식·오류 셀·매크로·내장 개체·외부 연결·DTD·손상된 체크섬은 거절합니다. 압축 해제 총량은 32MB이며 파일 처리는 제한된 별도 프로세스에서 수행합니다. 오래된 미리보기와 문서 revision이 바뀐 결과는 적용할 수 없습니다. 전체 프로젝트 이동·백업에는 기존 JSON/PM Canvas 파일을 사용하세요.

로그인·회원가입·공유·동시 편집·메일·SSO·서버 운영 기능은 포함하지 않습니다. 자동 업데이트·파일 연결·다중 창은 후속 범위입니다. 복구 사본은 별도 백업을 대신하지 않습니다. 입력창에서 아직 적용하지 않은 텍스트는 복구 대상이 아닙니다.

## 개발 실행

Node.js 22.18 이상을 사용합니다. 최초 설치에는 npm 저장소와 Electron 다운로드 서버에 접속할 수 있어야 합니다.

```sh
cd desktop
npm ci
npm start
```

`package-lock.json`에 고정한 의존성을 설치합니다. 최초 실행 시 Electron 바이너리가 추가로 다운로드될 수 있습니다.

## 검증

```sh
# desktop/에서
npm test

# 아래 두 검증은 web/ 폴더의 npm ci도 필요합니다.
npm run test:renderer
npm run test:app

# Windows 패키징 후, 패키지에 들어간 ASAR로 동일한 실제 앱 검증
npm run test:app -- dist/win-unpacked/resources/app.asar

# Windows에 실제로 설치한 EXE 검증 (PowerShell, 별도 임시 사용자 데이터 사용)
npm run test:app -- --installed "$env:LOCALAPPDATA\Programs\PM Canvas Desktop\PM Canvas Desktop.exe"
```

화면 검증에는 Playwright Chromium이 필요합니다. 최초 한 번 web/에서 `npx playwright install chromium --only-shell`로 설치합니다. 파일·복구·스키마·계산 검증은 Electron 없이 실행됩니다. 실제 앱 검증은 Electron으로 네이티브 창·격리된 브리지·파일 저장·재시작을 확인합니다.

0.1.x 당시 Windows 검증: 파일·보고서 테스트 11개, 화면 통합 테스트(1440px·1000px), 실제 Electron 앱의 저장·CSV 저장/취소·재시작, 개발용 NSIS 설치 파일 생성과 패키지 파일 구성 검사를 통과했습니다. 사용자별 재설치 마법사·설치 후 자동 실행·기존 프로젝트 복원과 실제 설치된 EXE의 동일 기능 검증도 통과했습니다. 설치된 파일·버전·레지스트리·바탕 화면/시작 메뉴 바로가기와 원본 프로젝트/복구 파일의 SHA-256 보존을 확인했습니다. 제거와 macOS 실행 검증은 아직 완료하지 않았습니다.

Windows 설치·제거 상태를 반복 확인하는 읽기 전용 검증 도구입니다. 설치와 제거는 별도로 실행하며, 이 스크립트는 기존 앱을 설치하거나 제거하지 않습니다. `Baseline`은 첫 설치·제거 전에 한 번 실행하고, 검증 도중에는 덮어쓰지 마세요. 자동화 프로세스와 실제 탐색기에서 동일한 HKCU 조회 결과가 달랐던 환경을 확인했으므로, 자동화 환경에서는 설치 프로그램과 아래 진단 프로그램을 일반 Windows 파일 탐색기에서 실행한 결과를 사용합니다.

```powershell
# desktop/에서. 필요한 경우 보존할 프로젝트 파일을 명시합니다.
.\test\windows-install-check.ps1 -Mode Baseline -PreserveFile 'C:\Projects\Project.pmcanvas'
.\test\windows-install-check.ps1 -Mode Installed
# Windows에서 앱 제거를 완료한 뒤
.\test\windows-install-check.ps1 -Mode Removed
```

실제 사용자 환경의 등록 정보와 데이터 보존을 확인하려면, 설치 빌드가 내려받은 NSIS 컴파일러로 `test/registry-check.nsi`를 컴파일합니다. 예를 들어 기본 캐시를 사용하는 Windows 환경에서는 다음과 같습니다.

```powershell
# desktop/test/에서. PROJECT_FILE은 보존할 파일이며 진단은 읽기만 합니다.
$nsisCompiler = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -Recurse -Filter makensis.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
& $nsisCompiler /V2 '/DPROJECT_FILE=C:\Projects\Project.pmcanvas' registry-check.nsi
```

생성된 `desktop/test-results/PMCanvas-Registry-Check.exe`를 **일반 파일 탐색기에서** 실행하면 같은 폴더에 `windows-desktop-registry.txt`가 생성됩니다. 자동화 도구의 실행 명령으로 진단 EXE를 시작하면 검사 환경의 차이가 그대로 남을 수 있습니다. 생성된 보고서는 10분 이내에 다음과 같이 사용합니다.

```powershell
# desktop/에서. Installed 또는 Removed에 실제 상태를 지정합니다.
.\test\windows-install-check.ps1 -Mode Removed -RegistryEvidence .\test-results\windows-desktop-registry.txt
```

기본 설치 위치를 바꿨다면 모든 명령에 동일한 `-InstallDirectory`를 전달하세요. 결과 JSON은 `desktop/test-results/`에 저장합니다. `Installed`는 빌드한 ASAR와 설치본을 비교하므로 먼저 동일 버전의 Windows 빌드가 필요합니다. 별도 출력 폴더의 빌드를 비교할 때는 `-ExpectedArchive`로 해당 `resources/app.asar` 경로를 지정합니다. `--installed` 앱 테스트는 임시 사용자 데이터 경로가 적용되었는지 확인한 뒤 테스트 문서를 만들며, 실제 사용자 프로젝트를 수정하지 않습니다.

## 설치 파일 빌드

제거 중 작업 경로가 설치 폴더를 잠그지 않도록 `build/installer.nsh`에서 임시 폴더로 변경합니다. 등록 정보와 바로가기 정리는 electron-builder의 표준 제거 프로그램이 수행하며, 프로젝트·복구 데이터 삭제는 비활성화했습니다. 검사 환경의 차이를 등록 정리 결함으로 오인해 추가했던 별도 정리 도우미는 제거했습니다.

각 운영체제에서 해당 명령을 실행합니다.

| 환경               | 명령                   | 결과                                       |
| ------------------ | ---------------------- | ------------------------------------------ |
| Windows x64        | `npm run dist:win`     | 사용자별 NSIS 설치 프로그램 `.exe`         |
| Windows x64 개발용 | `npm run dist:win:dev` | 서명·실행 파일 리소스 편집을 생략한 `.exe` |
| macOS              | `npm run dist:mac`     | Apple Silicon·Intel용 `.dmg`와 `.zip`      |
| 현재 OS 압축 전 앱 | `npm run pack`         | 패키징된 앱 디렉터리                       |

결과는 `desktop/dist/`에 생성됩니다. `dist:win:dev`는 실행 파일 리소스 편집 도구를 풀 때 심볼릭 링크 권한이 없는 Windows PC에서도 개발용 설치 파일을 만들기 위한 명령입니다. 정식 배포용 서명·아이콘·버전 리소스 적용에는 `dist:win`을 사용하세요.

저장소의 **Desktop builds** 워크플로를 수동 실행하면 Windows·macOS 각각 파일·화면·실제 앱 테스트 후 패키징합니다. 워크플로 자체와 macOS 빌드는 이 PC에서 실행하지 않았습니다.

배포본은 앱 파일 허용 목록만 포함하며 웹 서버의 환경설정·키·백업·운영 데이터·계정 의존성을 포함하지 않습니다. 기본 아이콘을 사용합니다.

정식 배포 전 Windows 코드 서명, macOS Developer ID 서명·공증, 두 운영체제의 설치·업데이트·제거 검증이 필요합니다. 빌드 워크플로는 서명 없는 개발 검증용입니다. 기존 웹 버전의 배포 ZIP과 별도 제품으로 관리합니다.

## 구조

- `scripts/prepare.mjs`: shared/의 명시한 공통 모듈만 `app/`에 준비.
- `ui/`: 다섯 화면과 편집창. 계산 엔진과 인력·업무 편집 모델 재사용.
- `main.mjs`: 네이티브 창·메뉴·파일 대화상자·종료 보호.
- `preload.cjs`: 화면에 필요한 제한된 문서 API만 노출.
- `document.mjs`: 검증·파일 저장·복구·외부 수정 검사.
- `reports.mjs`: 보고서 조건 검증·공통 집계·CSV 생성. 파일 경로는 네이티브 저장창에서 선택.
- `assets.mjs`: 앱 프로토콜의 공개 리소스 허용 목록.
- `test/`: 파일 테스트·화면 통합 테스트·실제 Electron 통합 테스트.

렌더러는 Node.js 접근 없이 sandbox·context isolation 상태로 실행합니다. 앱은 포트를 열지 않으며 외부 콘텐츠·새 창·권한 요청을 차단합니다. 복구 데이터는 Electron의 사용자별 앱 데이터 폴더에 저장됩니다. 개발 통합 테스트에서만 `PMCANVAS_DESKTOP_DATA`로 임시 경로를 지정할 수 있으며 패키지에서는 무시합니다.

## 0.2.0 검증 · 2026-10-28

파일·모델·XLSX 테스트 15개, 1440px·1000px 화면 테스트, Electron 개발 실행과 패키징된 Windows EXE의 XLSX 저장·양식·미리보기 가져오기·원본 보존·저장·재시작을 확인했습니다. 테스트는 임시 사용자 데이터와 문서만 사용했습니다. 웹과 공통 코드 테스트도 함께 실행했습니다. 빌드 도구 업데이트 후 전체 의존성 감사 결과는 0건입니다. 개발용 Windows x64 설치 파일은 dist/excel-0.2.0/에 있습니다. 새 설치 파일의 시스템 설치·제거와 macOS 실행은 이번 검증에 포함하지 않습니다.

앱 소스 파일은 패키지에 명시한 파일만 포함합니다. 빌드 후 `node test/package-safety.mjs dist/excel-0.2.0/win-unpacked/resources/app.asar`로 필수 모듈·허용 목록·개발 의존성 제외를 검사할 수 있습니다.
