# 로컬 작업 폴더 관리

작업을 시작할 때 `git fetch origin`, `git status --short`, `git rev-list --left-right --count origin/main...HEAD`로 현재 변경과 원격 main과의 차이를 확인합니다. 오래된 로컬 main과의 커밋 차이만으로 미병합 여부를 판단하지 않습니다. 기존 수정은 보존하고, 새 작업은 최신 원격 main을 기준으로 `codex/` 브랜치에서 진행합니다. 사용 중인 다른 worktree나 브랜치는 일괄 삭제하지 않습니다.

- 재사용할 실행 소스는 `scripts/`에 둡니다. [매뉴얼 도구](../scripts/manuals/README.md)는 소스이며 `test-results/`의 일부가 아닙니다.
- 캡처 이미지·측정 결과·예제 생성물은 `test-results/`에 둡니다. 출시 문서에 채택한 이미지는 해당 `docs/manuals/` 버전 폴더에 복사해 보존합니다.
- 실행 로그는 `test-results/logs/`처럼 무시되는 하위 폴더에 저장합니다. 과거 로그도 이곳으로 옮길 수 있으며 공개 소스에 넣지 않습니다.
- 에뮬레이터의 다운로드·압축 해제본·AVD는 재생성할 수 있지만, 실행 중인 인스턴스가 없는지 확인한 후 정리합니다. APK·스크린샷·실패 로그 같은 검증 증거는 별도로 보존합니다. 필요하면 Android SDK 도구로 시스템 이미지와 AVD를 다시 만듭니다.
- `web/backups/`, `web/recovery-keys/`, 설정·서명 자료와 실제 프로젝트 파일은 생성물 정리 대상에서 제외합니다. DB 덤프 보관은 [운영 백업 정책](../web/docs/OPERATIONS.md#자동-db-백업)을 따릅니다.

루트 패키지의 버전은 개발 명령용 메타데이터입니다. 제품 버전은 `web/package.json`, `desktop/package.json`, `mobile/package.json`으로 관리합니다.
