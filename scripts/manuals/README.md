# 매뉴얼 캡처와 과거 화면 점검 도구

기존 `test-results/`에만 있던 16개 스크립트를 소스 폴더로 옮겼습니다. 어느 디렉터리에서 실행해도 저장소 루트를 기준으로 동작하며, 개인 PC의 캡처 출력 경로는 `test-results/manuals/`로 바꿨습니다. 웹·데스크톱·모바일 의존성을 각 제품 폴더에 설치해야 합니다.

## 현재 매뉴얼 캡처

```sh
npm run manuals:example
npm --prefix desktop run prepare:app
npm --prefix mobile run build
npm run manuals:capture -- test-results/manuals/example/PMCanvas-대규모-예제-YYYY-MM-DD.pmcanvas
```

예제 생성 명령이 출력하는 `file` 경로를 캡처 명령에 전달합니다. 예제는 가상 데이터이며 `test-results/manuals/example/` 안에만 생성합니다. 기존 결과는 재사용하며, `--refresh`를 전달하면 수정 여부를 확인한 뒤 갱신합니다. 사용자 Documents 폴더나 기존 앱 작업 공간에는 넣지 않습니다.

`capture-release-manuals.mjs`는 각 제품의 현재 `package.json` 버전과 현재 모바일 메뉴를 사용합니다. 임시 앱 프로필과 메모리 DB 서버로 캡처하며 기본 출력은 `test-results/manuals/release/`입니다. 두 번째 인수로 출력 폴더를 지정할 수 있습니다. 검토한 뒤 해당 버전 매뉴얼 폴더에 채택할 이미지만 복사하세요. 실제 사용자 데이터로 캡처한 이미지는 공개하지 않습니다.

## 과거 점검 도구

`capture-ui`, `capture-desktop`, `capture-colors`, `capture-installed-colors`, `capture-project-parity`, `capture-reverted-colors`, `capture-typography`, `check-typography-source`, `verify-mobile-color-revert`는 당시 화면·색상·메뉴를 점검한 도구입니다. 과거 선택자와 기대값을 보존했으므로 최신 앱에 실행하려면 해당 내용을 먼저 확인합니다. 설치 앱용 도구는 Windows의 사용자 설치 경로를 사용합니다.

다음 다섯 도구는 실제 로컬 데이터를 변경하는 과거 일회성 도구입니다. 일반 캡처에는 필요하지 않습니다. 소스의 대상·백업 경로를 확인한 뒤 `PMCANVAS_ALLOW_LOCAL_DATA_CHANGES=1`을 명시해야 실행됩니다.

- `correct-weekly-titles-desktop.mjs`: 기존 데스크톱 작업 공간과 예제 파일의 보고서 제목을 수정합니다.
- `open-large-example-desktop.mjs`: 기존 데스크톱 작업 공간에 예제를 추가합니다.
- `correct-weekly-titles-web.mjs`, `remove-example-prefix-web.mjs`: Docker `/app` 환경의 DB 데이터를 수정합니다.
- `import-large-example-web.mjs`: Docker `/app` 환경에서 예제를 기존 관리자 계정으로 추가합니다.

이 도구들이 참조하는 과거 `test-results/large-example-*.json`은 현재 예제 생성 명령의 출력과 구분합니다. 이 도구를 일괄 실행하거나 CI에 연결하지 않습니다.
