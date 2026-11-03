# PostgreSQL PM 관리 기능 검증

2026-11-03 Windows x64에서 실제 PostgreSQL 서버에 연결해 검증했습니다.

## 실행 환경과 결과

- PostgreSQL 18.6, Windows x64 네이티브 서버, Node.js v24.16.0.
- [EDB 공식 바이너리](https://www.enterprisedb.com/download-postgresql-binaries)를 임시 디렉터리에 풀어 별도 클러스터를 생성했습니다. Windows 서비스 등록이나 전역 PATH 변경은 하지 않았습니다.
- `127.0.0.1`의 임시 포트, SCRAM 비밀번호 인증, 전용 `pmcanvas_management_test` DB를 사용했습니다. 운영 DB에는 연결하지 않았습니다.
- PostgreSQL 통합 테스트 **23개 통과, 실패 0개, 건너뜀 0개**(24.77초).
- 실제 `pg_dump -Fc` → 별도 DB의 `pg_restore` 복원 테스트 **1개 통과, 실패 0개, 건너뜀 0개**(15.12초).
- 스키마 마이그레이션 1~15 적용 및 재실행을 확인했습니다. PM 관리 데이터는 기존 `pm_projects.planning` JSON에 보관하므로 이번 기능 때문에 새 마이그레이션은 필요하지 않습니다.

Docker Desktop은 기존 secrets-engine 소켓 오류로 시작하지 못해 네이티브 PostgreSQL로 검증했습니다. Docker 설정은 변경하지 않았습니다.

## 새 관리 기능에서 확인한 내용

- 공수 없는 상위 업무, 여러 선행 업무, 완료한 마일스톤을 저장하고 새 커넥션 풀에서 다시 읽어 문서 전체가 일치하는지 확인했습니다. 마일스톤에 체크 항목 행이 생성되지 않는 것도 SQL로 확인했습니다.
- 이슈·리스크의 확률·영향도·담당자·관련 업무·조치, 월별 투입 계획과 M/M 기준을 저장·재조회했습니다. 10근무일 × 8시간 ÷ 160시간 = 0.5 M/M를 확인했습니다.
- 주간보고 발행 사본을 저장하고 이후 공수·이슈 조치를 수정해도 기존 보고서가 유지되는지 확인했습니다.
- 저장소에서 편집자의 저장 권한을 확인했습니다. 실제 HTTP 요청과 PostgreSQL 저장소를 연결해 소유자 수정, 조회자 수정 거절(403), 이전 revision 저장 거절(409), 발행 보고서 변조·삭제 거절(400)을 확인했습니다.
- planning JSON 수정 이후 외래 키 오류(23503)를 의도적으로 발생시켜 업무 행·관리 데이터·revision·감사 이력이 함께 롤백되는지 확인했습니다.
- 보고서 발행은 감사 이력에 한 번 기록되고, 롤백한 조치는 기록되지 않는지 확인했습니다.
- DB 덤프를 다른 DB에 복원한 뒤 HTTP로 다시 조회해 마일스톤·여러 선행 업무·이슈·투입 계획·발행 보고서를 포함한 문서 전체가 일치하는지 확인했습니다. 기존 로그인·MFA·TLS SMTP 발송·공유 권한·이전 인증 무효화 검증도 통과했습니다.

기존 통합 테스트의 계층 업무 검증은 행 번호 대신 업무 ID를 찾도록 수정했습니다. 상위 업무의 기존 공수를 하위 업무로 분리하는 변환 뒤에도 의도한 업무를 검사하기 위한 변경입니다. 제품 코드의 추가 수정은 필요하지 않았습니다.

## 재실행

운영 DB와 분리한, 이름이 `_test`로 끝나는 DB의 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`를 환경 변수로 지정한 뒤 `web` 디렉터리에서 실행합니다. 통합 테스트는 전용 DB의 공용 설정 데이터도 수정합니다.

```powershell
$env:RUN_POSTGRES_TESTS = '1'
node --test test/postgres.integration.mjs

# pg_dump와 pg_restore가 현재 프로세스의 PATH에 있어야 합니다.
# 복원 테스트 계정에는 임시 DB 생성·삭제 권한도 필요합니다.
$env:RUN_RESTORE_TESTS = '1'
node --test test/restore.integration.mjs
```

검증 후 테스트 프로젝트 0개와 복원용 임시 DB 0개를 확인했고, 임시 서버를 종료했습니다. 검증용 임시 디렉터리 삭제는 자동 승인 검토에서 정책상 차단됐으며 상세 사유는 제공되지 않았습니다. 따라서 다운로드·종료한 클러스터·테스트 로그는 다음 위치에 남아 있습니다.

```text
%TEMP%\pmcanvas-pg-validation-11ea14d5dc7d4a0bbbfef53785fe350d
```
