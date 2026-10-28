# PM Canvas

웹과 데스크톱을 동등한 제품으로 분리한 저장소입니다.

| 경로       | 역할                                     | 실행·설치 안내                                                                      |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `web/`     | Node.js·PostgreSQL 기반 설치형 웹 앱     | [웹 README](web/README.md)                                                          |
| `desktop/` | Windows·macOS용 오프라인 앱              | [데스크톱 README](desktop/README.md)                                                |
| `shared/`  | 계산 엔진·프로젝트 검증·재사용 화면 모듈 | [공통 코드 안내](shared/README.md)                                                  |
| `.github/` | 제품별 CI·빌드 워크플로                  | [웹 검증](.github/workflows/ci.yml), [데스크톱 빌드](.github/workflows/desktop.yml) |

각 제품은 자체 `package.json`, 의존성, 실행 명령, 테스트와 배포 설정을 갖습니다. 최상위 `package.json`은 명령을 각 제품에 전달하는 용도이며 루트에서 의존성을 설치하지 않습니다.

## 웹

```sh
cd web
npm ci --ignore-scripts
npm run setup -- --email admin@example.com
npm run service:up
```

기존 환경설정·메일 설정·키·백업·운영 스크립트는 `web/` 안에 보존했습니다. Docker 빌드 컨텍스트는 저장소 루트이며 Compose 파일은 `web/`에 있습니다. Compose 프로젝트 이름은 기존 기본값인 `pmcanvas`로 유지합니다. 기존 설치를 갱신할 때는 [데이터를 보존하는 업그레이드 안내](web/docs/DEPLOYMENT.md)를 따르세요.

## 데스크톱

```sh
cd desktop
npm ci
npm start
```

Windows와 macOS는 동일한 소스를 사용하며 각 OS에서 설치 파일을 만듭니다. Windows에서 실제 앱의 저장·재시작·CSV 및 XLSX 입출력과 패키징된 EXE를 검증했습니다. 설치 파일 명령과 운영체제별 검증 범위는 [데스크톱 README](desktop/README.md)를 확인하세요.

## 개발

저장소 루트에서 사용할 수 있는 명령입니다.

| 명령                    | 대상                                    |
| ----------------------- | --------------------------------------- |
| `npm run web:start`     | 웹 서버                                 |
| `npm run desktop:start` | 데스크톱 앱                             |
| `npm run test:web`      | 웹 테스트                               |
| `npm run test:desktop`  | 공통 모델을 포함한 데스크톱 파일 테스트 |
| `npm run format:check`  | 양쪽 제품·공통 코드 포맷                |
| `npm run public:check`  | 전체 저장소의 공개 파일 검사            |
| `npm run release:web`   | 웹·공통 코드로 구성한 서버 배포 ZIP     |

화면·실제 Electron 통합 검증 도구는 `web/`의 Playwright 개발 의존성을 사용합니다. 데스크톱의 런타임·패키징은 웹 서버에 의존하지 않습니다.

기존 루트에서 실행하던 웹 명령과 상대 경로는 이제 `web/` 기준입니다. 웹 문서는 해당 폴더로 함께 이동했습니다. 루트 실행 별칭 외의 웹 관리 명령은 `cd web` 후 실행하세요.
