# PM Canvas 새 ID 심사 준비 — 2026-11-02

새 앱은 **app.toolmoa.pmcanvas / Apple ID 6829387538**입니다. 이전 iOS Guideline 2.1 요청의 여섯 항목을 반영해 iOS·macOS 심사 메모 초안을 App Store Connect에 저장했습니다. 두 메모 모두 4,000자 이내이며 실물 기기 정보·실제 QA 결과·영상 링크는 `[PENDING]`으로 남겼습니다. 촬영을 마친 뒤 실제 값으로 교체해야 합니다.

| 플랫폼      | 설치할 빌드      | TestFlight 상태         | 심사 준비                     |
| ----------- | ---------------- | ----------------------- | ----------------------------- |
| iPhone·iPad | **0.1.0 (20.1)** | 내부 그룹에서 테스트 중 | 빌드 연결·심사 메모 초안 저장 |
| Mac         | **0.8.3 (60)**   | 내부 그룹에서 테스트 중 | 빌드 연결·심사 메모 초안 저장 |

[PM Canvas Release QA 그룹](https://appstoreconnect.apple.com/teams/69a6de82-6b38-47e3-e053-5b8c7c11a4d1/apps/6829387538/testflight/groups/5f4e0774-5b45-458f-b238-8bdda76ddea7/builds)에 빌드 2개·내부 테스터 1명이 있습니다. 확인 시 테스터 상태는 **초대됨**, 설치·세션 기록은 미표시였습니다. 각 기기에서 초대받은 계정으로 초대를 수락하고 설치합니다. 테스트 내용도 플랫폼별로 저장했습니다. 기존 빌드가 준비돼 있어 이번 작업에서 중복 빌드를 만들거나 초대를 다시 발송하지 않았습니다.

## 사용할 자료

- [기기별 설치·촬영 순서](recording-guide.ko.md)
- [iOS 영문 심사 메모](ios-review-notes.txt) · [Mac 영문 심사 메모](macos-review-notes.txt)
- [iOS TestFlight 테스트 내용](testflight-what-to-test-ios.txt) · [Mac TestFlight 테스트 내용](testflight-what-to-test-macos.txt)
- [실물 기기 결과표](physical-device-results.csv): 실제로 확인하기 전에는 `NOT_TESTED`를 유지합니다.

## 촬영 후 제출 전

1. 실제 기기 모델·정확한 OS·테스트 날짜·빌드 번호와 단계별 성공/실패를 결과표에 기록합니다.
2. 영상이 앱 실행부터 주요 흐름까지 포함하는지 확인하고 재생 가능한 첨부 또는 심사자 접근 가능 링크를 준비합니다.
3. 메모 1번에 실제 결과·영상 링크를 넣고 준비 중 문구를 제거합니다. 메모 길이는 다시 확인합니다.
4. 제출할 빌드와 테스트·영상 빌드가 같은지 확인합니다. 실패 수정으로 빌드가 바뀌면 해당 빌드를 다시 검증합니다.
5. 실물 QA와 영상 확보 후 App Review에 제출합니다. 현재 두 플랫폼은 **제출 준비 중**입니다.

앱 코드·서명 설정·가격·배포 지역·계정 연락처는 이번 준비 작업에서 변경하지 않았습니다. 저장 확인은 App Store Connect의 메모 값·비활성화된 저장 버튼, TestFlight 그룹의 두 빌드 `테스트 중` 상태로 수행했습니다. 서명·업로드 성공은 아래 기존 실행을 확인했습니다.

- [iOS 서명·Apple 검증·업로드](https://github.com/jhoon-dev/PMCanvas/actions/runs/41296552107)
- [Mac 서명·Apple 검증·업로드](https://github.com/jhoon-dev/PMCanvas/actions/runs/41293690010)
