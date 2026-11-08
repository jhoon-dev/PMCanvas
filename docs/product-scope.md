# 제품 선택과 기능 범위

PM Canvas는 PM이 업무·일정·공수·완료 기록을 연결해 현황을 판단하는 도구입니다. 팀 협업은 웹, 개인의 독립적인 파일 관리는 데스크톱과 모바일에서 제공합니다. 계산·파일 호환성과 데이터 보존을 기능 확장보다 우선합니다.

| 사용 목적                           | 선택     | 데이터와 공유 방식                                |
| ----------------------------------- | -------- | ------------------------------------------------- |
| 팀의 공통 계획·완료 기록 관리       | 웹       | 설치한 서버에 저장하고 계정별로 프로젝트 공유     |
| PC에서 개인 계획·파일 관리          | 데스크톱 | 기기에서 오프라인 편집·저장, 프로젝트 파일로 전달 |
| 휴대폰에서 개인 계획·완료 기록 관리 | 모바일   | 기기에서 오프라인 편집·저장, 프로젝트 파일로 전달 |

팀의 같은 프로젝트를 여러 기기에서 확인·수정하려면 웹을 사용합니다. 데스크톱·모바일에 프로젝트 파일을 가져오면 독립 사본이 생깁니다. 사본의 변경은 서버나 다른 기기에 자동 반영되지 않으므로 팀원의 서버 입력 창구로 안내하지 않습니다.

## 현재 협업과 일정 범위

- 웹은 소유자·편집자·조회자로 프로젝트 접근을 관리합니다. 편집자는 프로젝트 전체를 수정합니다. 참여인력과 담당 계정을 연결하는 기능은 내 업무 표시를 위한 것으로, 자기 업무만 수정하도록 제한하는 권한은 아닙니다.
- 웹의 주기적 조회와 동시 수정 충돌 처리를 사용합니다. 실시간 push와 오프라인 앱의 서버 동기화는 지원하지 않습니다.
- 선행 관계는 완료 후 다음 근무일에 시작하는 FS입니다. 지연일(lag), SS·FF·SF와 자동 자원 최적화는 지원하지 않습니다.
- 공수 가중 진척률은 완료 항목의 예상 시간 기준입니다. 실제 투입시간은 수집하지 않습니다. 예상 완료일은 일정·가용시간·최근 완료 기록에 따른 추정입니다.

## 개발·배포 우선순위

1. 계산·검증 일치, 저장·복원, 가져오기·내보내기의 정확성과 회귀 방지.
2. 웹의 팀 운영 흐름과 오프라인 앱의 개인 계획 흐름을 각 목적에 맞게 개선.
3. 공통 모델·화면 재사용과 현재 배포 경로의 플랫폼별 검증.
4. 실제 사용에서 막힌 사례가 확인된 기능만 확장.

FS 확장은 표현할 수 없는 일정 사례, 세부 권한은 담당 업무만 수정해야 하는 팀 사례, 모바일 동기화는 서버 프로젝트를 휴대폰에서 갱신해야 하는 사례를 근거로 판단합니다. 데이터 모델·권한·충돌 처리·플랫폼별 검증에 미치는 영향을 먼저 정리하고 구현 범위를 정합니다. 현재 지원 범위와 향후 기능 약속을 구분합니다.

플랫폼·스토어·직접 배포 경로를 추가하기 전에는 서명, 업데이트, 복구와 실기기 검증을 반복 수행할 수 있는지 확인합니다. 검증한 환경과 실행하지 못한 검사는 릴리스 기록에 남깁니다. 기존 경로를 없애거나 새 기능의 출시 시점을 이 문서로 약속하지 않습니다.

## 예상 완료일을 읽는 방법

완료 기록이 부족하면 계획 속도와 실적 속도를 혼합하고 현황에 기록 부족을 표시합니다. 인력 화면에서 관측 속도와 예측에 적용한 속도를 비교할 수 있습니다. 혼합 비중은 통계적 신뢰도가 아닌 예측 안정화를 위한 규칙입니다. 상세 계산과 한계는 [공통 엔진 안내](../shared/README.md#예상-완료일)를 확인하세요.

## Product scope (English)

Use the web app for a shared team workspace. Desktop and mobile are independent offline tools for personal planning; imported project files are separate copies and do not synchronize with the server. Account-to-member links filter My Work and do not restrict editors to their own tasks. Dependencies currently support finish-to-start without lag.

Prioritize calculation correctness, data preservation and existing release verification. Extend dependencies, permissions or synchronization when concrete usage demonstrates a need and the data, conflict and platform implications have been assessed. Sparse completion records produce a labelled blend of planned and observed speed; this is a heuristic, not statistical confidence.
