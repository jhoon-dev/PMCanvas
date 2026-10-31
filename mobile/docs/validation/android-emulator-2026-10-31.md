# Android 에뮬레이터 검증 — 2026-10-31

## 최종 실행

**실제 Android 15 앱에서 전체 12단계가 통과했습니다.** 설치한 APK의 WebView와 Android 시스템 UI를 함께 사용했으며, 브라우저 에뮬레이션 결과와 구분합니다.

- 앱 ID: `dev.jhoon.pmcanvas`, 버전 0.1.0, 최소 API 24 / target API 36
- 검증 APK: `android/app/build/outputs/apk/debug/app-debug.apk` (4,256,530 bytes)
- SHA-256: `f2595b4db15662780595ec15dba20de2ad7700b8fcfd97c5b7bbcd045bb769cb`
- Android 네이티브 12단계, 모델·저장소 8개, Android Chromium·iPhone WebKit 브라우저 시나리오 8개 통과
- [단계별 결과 JSON](android-emulator-2026-10-31/results.json)

| 실제 앱 검증 항목                                     | 결과 |
| ----------------------------------------------------- | ---- |
| Android 부팅 완료 확인, APK 설치·실행                 | 통과 |
| 프로젝트 저장 직후 강제 종료·재실행 후 복원           | 통과 |
| 인력 생성·역할·근무시간·투입률 수정                   | 통과 |
| 업무 생성·이름 수정, 2h + 6h 세부 작업                | 통과 |
| 완료 체크, 25% 가중 진척률, 검색·담당자 필터          | 통과 |
| 네트워크 요청 오프라인 상태의 실행 취소·다시 실행     | 통과 |
| Android 뒤로 가기로 미저장 편집 취소·목록 복귀        | 통과 |
| 완료 기록 변경 후 강제 종료·재실행·25% 복원           | 통과 |
| 프로젝트·CSV 공유 시트, 내보낸 파일 내용 검사         | 통과 |
| Android 파일 선택기로 내보낸 파일을 사본으로 가져오기 | 통과 |
| 삭제 취소, 업무·인력·사본 삭제, 원본 ID·진척률 보존   | 통과 |

앱의 uncaught JavaScript 예외는 없었습니다. 결과 JSON의 콘솔 기록에는 기본 favicon 요청의 404와 테스트에서 공유 시트를 닫아 발생한 공유 취소 메시지가 남아 있습니다.

검증 화면: [프로젝트 현황](android-emulator-2026-10-31/overview.png), [Android 공유 시트](android-emulator-2026-10-31/sharesheet.png), [파일 선택기](android-emulator-2026-10-31/document-picker.png).

## 실행 환경과 부팅 문제 조치

- Android Emulator 37.3.6 Canary, WHPX, Android 15 / API 35 AOSP x86_64 이미지
- 전용 AVD `PMCanvasAOSP35`, 콘솔 포트 5566
- 가상 CPU 1개, RAM 3072MB, 720×1280 / 320dpi, SwiftShader, Vulkan 비활성화
- 부팅 애니메이션과 스냅샷 복원을 끈 상태로 검사
- 이 호스트에서 측정한 TSC 주파수 3187184kHz로 초기 보정을 지정하고 TSC 시계를 사용

기존 실행에서는 TSC 보정 실패, 시계 불안정, System UI 응답 지연을 관찰했습니다. 전용 AVD와 타이머 설정을 적용했으며, Emulator 37.3.6은 별도 진단 폴더에 설치했습니다. 이 버전에는 Windows의 전력 제한에 따른 부팅 지연/ANR 수정도 포함돼 있습니다. [Android 공식 수정 내역](https://developer.android.com/studio/releases/fixed-bugs/emulator/37)

ANR 덤프에서는 System UI 시작 스레드가 실행 약 2.5초에 CPU 대기 약 33초를 기록했습니다. 가상 CPU 4개도 비교했으나 시작 지연이 개선되지 않아 단일 CPU 설정을 사용했습니다. 테스트 AVD의 시스템 하드웨어 시간 제한 배수 5를 설정하고 Android 런타임을 재시작해 느린 호스트에서 시스템 시작을 기다리게 했습니다. 실제 부팅 완료 신호를 확인하며 기능 테스트는 동작별 60초 제한을 사용합니다. 이 결과는 표준 시스템 ANR 기한이나 실기기 성능을 통과했다는 의미가 아닙니다. [Android의 시간 제한 배수 정의](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/os/Build.java)

호스트로 전송하는 전체 verbose 로그 스트림은 `-logcat '*:S'`로 줄였습니다. Android 내부 로그는 ADB로 계속 확인합니다.

재부팅 검증 중 시스템 앱의 `verify` 상태가 확인돼 다음 5개 패키지를 `cmd package compile -m speed -f`로 사전 컴파일했습니다. 명령 5개가 모두 `Success`를 반환했고, `dumpsys package dexopt`에서 System UI·통신·미디어 제공자의 `status=speed`, `reason=cmdline`을 확인했습니다.

- System UI
- 통신 서비스 (TeleService)
- 미디어 제공자 (MediaProvider)
- 파일 선택기 (DocumentsUI)
- 권한 관리자 (PermissionController)

이 설정과 최적화는 테스트용 AVD에 적용했습니다. 가상기기 데이터와 SDK 실행 파일은 저장소의 ignored 진단 폴더에 있으며, 소스 배포물에 포함하지 않습니다.

## 앱에서 수정한 문제

1. 키보드가 닫히면서 편집 창이 커져 저장·삭제·취소 버튼의 첫 탭이 무시되는 경우를 수정했습니다. Android에서는 버튼 동작이 실행될 때까지 입력 포커스를 유지합니다.
2. 밝은 화면에서 상태 표시줄 글자가 흰색으로 보이는 문제를 SystemBars의 style 설정을 `LIGHT`로 바꿨습니다.
3. Android 파일 선택기에서 `.pmcanvas` 파일이 비활성화되는 문제를 수정했습니다. `application/octet-stream`을 선택 가능한 형식에 포함하고 기존 JSON·프로젝트 형식 검사와 8MB 제한을 유지합니다.
4. 강제 종료 후 Chromium의 IndexedDB가 `missing start of fragmented record` 손상 로그와 함께 빈 저장소로 복구되는 현상을 확인했습니다. 저장·삭제의 쓰기 트랜잭션에 `durability: 'strict'`를 지정해 디스크 반영을 확인한 뒤 저장 완료를 표시하도록 수정했습니다. 새 프로젝트 저장 직후의 강제 종료·복원과 완료 체크 후 복원을 네이티브 시나리오에 포함했습니다. [Chromium의 IndexedDB durability 설명](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed)

테스트에서는 주말에도 유효한 근무일을 사용하도록 날짜 데이터를 수정했습니다. 네이티브 자동화는 실제 WebView와 Android SDK 입력·파일 선택기를 사용합니다. 앱 종료 후 이전 WebView가 사라질 때까지 기다리고, 네이티브 화면이 준비될 때까지 확인하며, 부팅 중에는 WebView 탐색을 시작하지 않습니다. 브라우저 결과 폴더도 분리해 네이티브 검증 기록을 보존합니다.

최종 입력 자동화는 하드웨어 키보드 모드를 사용하고, 필드를 비운 뒤 입력·포커스 이동·값 확인을 거쳐 저장합니다. 기존 화면 키보드 표시 설정은 테스트 종료 시 복원합니다. 이는 가상 키보드의 지연된 조합 입력과 자동 입력이 섞이는 현상을 피하기 위한 테스트 설정이며, 실제 기기의 각 IME 타자 동작까지 검증한 결과는 아닙니다.

## 재실행

이 컴퓨터에 준비된 전용 AVD를 실행하는 예시입니다. `3187184`는 이 호스트에서 측정한 값이며 다른 컴퓨터에 그대로 적용하는 기본값이 아닙니다.

```powershell
cd mobile
./scripts/start-android-emulator.ps1 -TscKhz 3187184 -Cores 1 -HardwareTimeoutMultiplier 5
$env:PM_ANDROID_SERIAL = 'emulator-5566'
npm run test:android
```

창을 표시하려면 실행 스크립트에 `-Visible`을 지정합니다. 다른 AVD나 실행 파일은 `-AvdName`, `-EmulatorPath`, `-Port`로 선택합니다. 시간 제한 배수 조정에는 `su`를 사용할 수 있는 debuggable 테스트 AVD가 필요합니다. 실행 중인 기기에는 시작 옵션이 다시 적용되지 않으므로 옵션을 변경할 때는 해당 테스트 기기를 종료한 뒤 실행합니다. 별도의 테스트 기기와 JDK 21·Android SDK 환경을 준비한 뒤 `npm run android:apk`로 APK를 다시 만들 수 있습니다.

부팅 대기는 기본 600000ms이며 `PM_ANDROID_BOOT_TIMEOUT_MS`로 조정합니다. APK 경로는 `PM_ANDROID_APK`로 지정할 수 있습니다. 테스트는 에뮬레이터만 선택하고 별도의 검증용 프로젝트를 만듭니다. 원시 결과·Android 화면·WebView 화면·UI 계층·내보낸 파일은 `mobile/test-results/android-native/`에 저장합니다.

이번 기록은 로컬 Android 에뮬레이터 검증입니다. 물리 기기나 다른 Android 버전, iOS 네이티브 실행 결과로 확대하지 않습니다. 이전 실패 기록은 [2026-10-30 검증 시도](android-emulator-2026-10-30.md)에 보존했습니다.
