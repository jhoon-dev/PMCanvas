# 공통 코드

`web/`, `desktop/`, `mobile/`이 함께 사용하는 원본 코드입니다. 공통 코드는 어느 제품 폴더에도 의존하지 않습니다.

| 경로                                                                        | 내용                                  |
| --------------------------------------------------------------------------- | ------------------------------------- |
| `browser/engine.js`                                                         | 근무일·공수 가중 진척률·예상 완료일   |
| `browser/planning.js`                                                       | WBS 계층·기준 계획·선행 관계          |
| `browser/html.js`, `browser/i18n.js`, `browser/locales/`                    | 안전한 HTML 출력·언어                 |
| `browser/people-view.js`, `browser/project-editor.js`, `browser/view-ui.js` | 인력 화면·편집 모델·표현 도구         |
| `browser/reports.js`, `browser/styles.css`                                  | CSV 모델·공통 스타일                  |
| `model/project.mjs`, `model/errors.mjs`                                     | 프로젝트 검증·입력 정규화·공통 오류   |
| `assets.mjs`                                                                | 웹에 공개할 공통 브라우저 리소스 목록 |

웹은 기존 브라우저 URL을 유지하면서 허용된 공통 리소스를 직접 제공합니다. `web/public/`의 작은 재노출 모듈과 `web/server/`의 모델 재노출 모듈은 기존 내부 import 경로의 호환 계층입니다. 원본을 복제하지 않습니다.

`browser/wbs-model.js`와 `browser/excel-import-model.js`는 XLSX 열 연결·새 업무 추가·ID 갱신의 공통 모델입니다. `node/excel.mjs`와 `node/excel-import.mjs`는 양식·보고서 생성과 제한된 XLSX 파싱을 담당합니다. 각 제품이 고정 의존성을 주입하므로 공통 코드가 어느 제품의 node_modules에도 의존하지 않습니다. 데스크톱 준비 단계는 명시한 Node 모듈을 앱 내부로 복사하며, 이 모듈들은 브라우저 공개 허용 목록에 넣지 않습니다.

데스크톱은 패키징 준비 단계에서 이 폴더의 명시한 파일만 앱 내부로 복사합니다. 모바일은 Vite가 공통 브라우저·검증 모듈을 번들에 포함합니다. 웹의 서버·설정·DB·운영 의존성은 패키징하지 않습니다. 공통 코드의 수정은 이 폴더에서 진행하고 제품별 테스트를 실행하세요.
