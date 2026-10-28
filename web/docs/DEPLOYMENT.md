# 배포와 서버 설정

## 기본 Docker 설치

`npm run setup -- --email admin@example.com`은 비공개 .env·MFA 키와 인증 설정을 만들고 비밀번호를 무작위 생성합니다. 기존 .env는 덮어쓰지 않습니다. `npm run service:up`은 폴더 권한과 이전 키 사본을 확인한 뒤 앱·PostgreSQL 18·백업 작업 서비스를 기동합니다.

Linux에서는 호스트 실행 계정의 UID/GID를 감지해 앱과 백업 서비스에 동일하게 적용합니다. 직접 Compose를 실행하려면 PM_RUN_UID와 PM_RUN_GID를 `id -u`와 `id -g` 값으로 지정하세요. root 계정에서 운영 명령을 실행하면 기본 런타임은 1000:1000으로 두고 알려진 전용 폴더의 소유권을 준비합니다. 사용자 지정 ID는 0 이외의 숫자여야 합니다. 새로 만든 디렉터리는 0700, 비밀 파일은 0600이며 심볼릭 링크를 따라 권한을 바꾸지 않습니다. 사용자 지정 인증 비밀 파일도 해당 런타임 계정이 읽을 수 있도록 운영자가 권한을 맞추세요.

Windows Docker Desktop에서는 별도 UID 조정 없이 기본값을 사용합니다. Windows 파일 접근 권한은 운영 계정으로 제한하세요. `.env`, `config`, `backups`, `recovery-keys`는 Git과 설치 ZIP에 포함하지 않습니다.

DB 데이터는 pgdata 볼륨에 보관합니다. `docker compose down -v`는 이 볼륨을 지우므로 사용하지 마세요. .env의 DB 암호만 수정하면 이미 생성된 DB 계정 암호와 달라집니다. 초기 관리자 암호도 최초 생성용이며 기존 계정 비밀번호를 덮어쓰지 않습니다.

## HTTPS와 경로

PUBLIC_ORIGIN은 경로 없는 HTTPS 출처, BASE_PATH는 `/pmcanvas`처럼 지정합니다. 기본 Compose는 앱 포트를 호스트 127.0.0.1에만 공개하고 DB·백업 서비스의 포트는 공개하지 않습니다. deploy/apache-pmcanvas.conf 또는 deploy/nginx-pmcanvas.conf를 기존 HTTPS 가상 호스트에 적용하세요.

프록시는 X-Forwarded-For를 덮어써야 하며 TRUSTED_PROXIES에는 실제 직전 프록시 IP를 정확하게 지정합니다. 인증서와 기존 웹서버 설정은 앱이 변경하지 않습니다. 사설 CA는 certs에 두고 해당 컨테이너 경로를 설정하세요.

## 외부 PostgreSQL

전용 DB와 일반 앱 계정을 만들고 PGHOST·PGPORT·PGDATABASE·PGUSER·PGPASSWORD를 .env에 설정합니다. 기본 DB나 다른 앱의 DB는 공유하지 마세요.

```sh
docker compose -f compose.external.yml up -d --build
```

기본 PGSSLMODE는 verify-full이며 사설 CA는 PGSSLROOTCERT=/app/certs/root-ca.crt처럼 지정합니다. 외부 자동 백업은 별도 운영 계정과 backups 프로필이 필요합니다. [자동 백업·복원 점검 설정](OPERATIONS.md)을 참고하세요.

## Docker 없이 실행

고정 의존성을 `npm ci --ignore-scripts`로 설치하고 PostgreSQL·인증 키·출처·초기 관리자 설정을 준비한 뒤 npm start로 실행합니다. Docker용 기본 .env의 컨테이너 경로는 호스트 경로로 맞추세요. 직접 운영하는 백업 작업 서비스에는 서버 버전에 맞는 PostgreSQL 명령 도구가 필요합니다.

## 업데이트와 복원

업데이트 전에 npm run backup을 실행하고 .env·config·DB 볼륨을 보존합니다. 소스와 lockfile을 교체한 뒤 npm run service:up을 실행하면 미적용 마이그레이션이 순서대로 실행됩니다. 실패하면 해당 마이그레이션 트랜잭션을 롤백합니다.

### 루트 설치에서 web/ 구조로 이동하는 경우

0.21.0부터 웹 앱은 `web/`, 공통 코드는 `shared/`에 있습니다. 기존 설치에서는 소스를 교체하기 **전에** 이전 위치에서 DB 백업을 만드세요. `.env`, 실제 `config/`, `certs/`, `backups/`, `recovery-keys/`를 새 `web/` 아래로 보존하고, `.env`의 호스트 상대 경로가 있다면 확인합니다. 암호화 키를 새로 생성하거나 `setup`을 다시 실행하지 마세요. 키 복구본은 DB 덤프와 분리된 외부 저장소에 보관합니다.

기본 Compose 프로젝트는 `pmcanvas`, DB 볼륨은 `pmcanvas_pgdata`입니다. 기존 설치가 다른 프로젝트 이름을 사용했다면 동일한 이름을 명시하고, 시작 전에 `docker compose config --volumes`와 기존 DB 컨테이너의 마운트를 비교하세요. `down -v`는 실행하지 않습니다. 이후 `cd web`에서 `npm run service:up`을 실행합니다. 바인드 경로 변경 때문에 컨테이너는 재생성될 수 있지만 같은 DB 볼륨과 기존 설정·키를 사용해야 합니다.

갱신 후 상태·버전과 기존 계정·프로젝트·업무를 확인하고 백업 명령도 다시 점검하세요. 롤백이 필요하면 보존한 설정과 이전 이미지를 사용하고, DB 스키마가 바뀐 경우에는 위 복원 절차로 새 DB를 사용합니다.

복원 명령은 새 DB만 만들며 같은 이름의 DB가 있으면 중단합니다. 확인한 복원 DB를 사용하려면 .env의 APP_DATABASE를 새 이름으로 바꾸고 재기동합니다. 이전 DB는 남아 있습니다. 이전 스키마로 돌아가려면 업데이트 전 백업을 새 DB에 복원한 뒤 그 버전의 소스를 사용하세요.
