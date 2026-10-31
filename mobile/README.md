# PM Canvas Mobile

iPhone과 Android에서 사용하는 오프라인 프로젝트 관리 앱입니다. Capacitor 8의 네이티브 프로젝트와 휴대폰 전용 화면을 포함합니다. 공통 계산·검증·편집 코드는 `shared/`에서 가져오며 웹 서버나 Electron에 의존하지 않습니다.

[개인정보처리방침 / Privacy policy](PRIVACY.md)은 프로젝트 목록과 더보기 화면에서 오프라인으로도 확인할 수 있습니다.

## 기능

- 여러 프로젝트, 참여인력, 업무·일정·세부 작업 편집과 삭제
- 완료일을 지정하는 체크리스트, 공수 가중 진척률, 예상 완료일
- 기기에 자동 저장, 앱을 다시 열었을 때 복원, 최근 변경 실행 취소·다시 실행
- 웹·데스크톱 `.pmcanvas` 및 프로젝트 JSON 가져오기, 프로젝트 파일과 CSV 보고서 내보내기
- 네이티브 공유 시트, Android 뒤로 가기, 노치·홈 표시줄 여백, 작은 화면 대응
- 업무 기준 시간대 변경·저장 (기본값 `Asia/Seoul`)

현재 첫 버전의 화면은 한국어입니다. WBS 계층과 기준 계획은 가져오기·편집·내보내기 과정에서 보존하지만 계층 이동과 기준 계획 생성 화면은 아직 없습니다. Excel 입출력, 서버 로그인·자동 동기화, 알림과 위젯은 포함하지 않습니다.

## 개발

Node.js 22.18 이상을 사용합니다. 제품 폴더에서 의존성을 설치합니다.

```sh
cd mobile
npm ci
npm run dev
```

개발 서버는 로컬 브라우저 미리보기입니다. 오프라인 앱은 빌드한 화면을 설치본 안에 포함합니다. 네이티브 앱 설정에 원격 서버 주소나 운영 인증정보를 넣지 않습니다.

```sh
npm run build
npm run sync
npm run android
# macOS에서
npm run ios
```

`android/`와 `ios/`는 소스 관리 대상입니다. `cap add`는 이미 완료했으므로 다시 실행하지 않습니다. 화면이나 플러그인을 수정한 뒤 `npm run sync`로 각 플랫폼에 반영합니다.

## Android

Android 7.0 / API 24 이상을 대상으로 하며 compile/target SDK는 36입니다. JDK 21, Android Studio 2025.2.1 이상, Android SDK Platform 36과 Build Tools 36을 준비합니다. `JAVA_HOME`은 JDK 21, `ANDROID_HOME`은 SDK 경로를 가리키게 설정하세요. Android Studio의 Gradle JDK도 21로 맞춥니다.

```sh
npm run android:apk
```

결과는 `android/app/build/outputs/apk/debug/app-debug.apk`입니다. 개발용 서명 APK이므로 Play Store 제출용으로 사용하지 않습니다. 배포는 Android Studio에서 고유한 application ID·버전 코드·릴리스 서명을 확인한 뒤 AAB로 생성합니다. 키 파일은 소스에 넣지 않습니다.

## iPhone

Mac과 Xcode 26 이상이 필요하며 최소 지원 OS는 iOS 15.4입니다. Swift Package Manager를 사용하므로 CocoaPods 설치는 필요하지 않습니다.

```sh
npm ci
npm run ios
```

Xcode에서 App 타깃의 Signing & Capabilities에 본인 Apple Developer Team을 선택하고, 사용할 Bundle Identifier를 지정한 뒤 시뮬레이터나 아이폰으로 실행합니다. iOS Bundle Identifier와 Android application ID는 `dev.jhoon.pmcanvas`이며 [Capacitor 설정](capacitor.config.json)의 `appId`도 같은 값을 사용합니다. Store/TestFlight 배포 전 계정 소유자가 식별자·서명·배포용 프로필을 설정해야 합니다.

파일 공유 플러그인의 파일 타임스탬프 사용 사유 `C617.1`을 `App/PrivacyInfo.xcprivacy`에 선언하고 앱 리소스에 포함했습니다. [Capacitor Filesystem 공식 안내](https://capacitorjs.com/docs/apis/filesystem)를 참고하세요. [플랫폼 개발 환경 안내](https://capacitorjs.com/docs/getting-started/environment-setup)도 함께 확인하세요.

## 데이터와 파일

프로젝트는 앱의 IndexedDB에 트랜잭션으로 저장합니다. 저장이 끝난 뒤 화면의 상태를 갱신하고, 저장 실패 시 편집 내용을 유지합니다. 같은 프로젝트를 여러 창에서 열면 리비전을 검사해 오래된 창의 덮어쓰기를 막습니다. 앱 삭제·브라우저 데이터 삭제·기기 저장소 정리는 로컬 데이터 손실로 이어질 수 있으므로 프로젝트 파일을 별도로 보관하세요. 서버로 자동 업로드하지 않습니다.

가져오기는 항상 새 프로젝트 사본을 만들며 기존 프로젝트를 덮어쓰지 않습니다. 파일은 8MB 이하이고 공통 검증을 통과해야 합니다. 웹에서 미확정 WBS 셀을 먼저 저장한 뒤 내보내세요. `.pmcanvas`의 `pm-canvas-project` 버전 1 형식은 웹·데스크톱과 같습니다. 다른 기기에 공유한 파일을 열어 가져오는 수동 이동 방식이며, 실시간 공동 편집은 지원하지 않습니다.

기기에서는 캐시 폴더에 내보내기 파일을 만들고 OS 공유 시트를 엽니다. OS의 저장/공유 앱을 선택해 보관합니다. 브라우저 미리보기에서는 파일 다운로드로 동작합니다. CSV는 공통 보고서 모듈의 수식 입력 방지 처리를 사용합니다.

## 검증

```sh
npm test
npx playwright install chromium webkit
npm run test:browser
npm run format:check
# macOS: 독립된 iPhone 시뮬레이터를 만들어 실제 앱 실행·저장·재실행을 검증
npm run sync
npm run test:ios
```

실제 Android 에뮬레이터 검증은 빌드한 APK와 Android SDK를 준비한 뒤 `npm run test:android`로 실행합니다. 여러 대가 연결되어 있으면 `PM_ANDROID_SERIAL`로 선택합니다. 스크립트는 개발용 APK를 설치하고 별도의 검증용 프로젝트를 만듭니다. WebView와 Android SDK 입력·파일 선택기를 사용하므로 별도 Playwright Android 드라이버 설치는 필요하지 않습니다. Windows의 전용 AVD 실행 스크립트와 부팅 설정은 [2026-10-31 Android 검증 기록](docs/validation/android-emulator-2026-10-31.md)에 설명했습니다.

모델·저장소 테스트는 파일 호환성, WBS·기준 계획 유지, 잘못된 입력, 완료 체크, 삭제 시 연결 정리, 재연결 복원, 동시 수정 충돌과 트랜잭션 실패를 검사합니다. 브라우저 테스트는 Android 크기의 Chromium과 iPhone 크기의 WebKit에서 생성·편집·체크·복원·내보내기·가져오기·삭제 취소·작은 화면·저장 충돌을 검사합니다. 브라우저 에뮬레이션은 실제 기기 검증을 대체하지 않습니다.

CI는 브라우저 검증과 개발용 Android APK 빌드, Mac에서 iPhone 시뮬레이터의 XCTest 실행 및 서명 전 기기용 아카이브를 수행합니다. iPhone 테스트는 앱 실행, 개인정보처리방침, 프로젝트 생성, 앱 종료·재실행 후 저장 복원을 확인하며 자신이 만든 시뮬레이터만 정리합니다. `PMCanvas-iPhone-verification-NOT-for-submission` 아티팩트에 시뮬레이터 앱·서명 전 기기 아카이브·XCTest 결과를 ZIP으로 보존합니다. 이 파일은 서명된 IPA나 Store 제출본이 아닙니다. Store 배포 전 실제 iPhone과 Android에서 파일 선택·공유·키보드·백그라운드 복귀·업그레이드 후 데이터 보존을 추가로 확인하세요.

아이콘 원본은 `assets/icon.svg`입니다. 아이콘과 시작 화면을 바꾸려면 Chromium 설치 후 `npm run prepare:icons`를 실행합니다. 생성된 네이티브 PNG는 소스 관리하며 일반 앱 빌드에는 브라우저 도구가 필요하지 않습니다.

2026-10-30 Windows에서 모델·저장소 테스트 8개, Android Chromium·iPhone WebKit 시나리오 8개, 포맷·공개 파일·의존성 검사와 개발용 Android APK 빌드를 통과했습니다. 생성한 APK의 앱 ID·서명과 최신 화면 번들 일치도 확인했습니다. 2026-10-31 [Mac CI의 iPhone 네이티브 검증](https://github.com/jhoon-dev/PMCanvas/actions/runs/41157141725)에서 실제 시뮬레이터의 개인정보처리방침·프로젝트 생성·종료 후 복원 테스트와 기기용 아카이브 빌드를 통과했습니다. 양쪽 플랫폼의 실제 기기 동작과 Store 서명·업로드는 아직 검증하지 않았습니다.

App Store Connect의 [PM Canvas](https://appstoreconnect.apple.com/apps/6829098378/distribution)는 `dev.jhoon.pmcanvas`로 등록했으며 macOS 0.8.3과 iOS 0.1.0을 한 앱 레코드에서 관리합니다. iOS 제품 설명은 초안 상태이며 App Review에 제출하거나 게시하지 않았습니다.

2026-10-31에는 부팅 설정을 조정한 Android 15 에뮬레이터에서 실제 APK의 전체 12단계 검증을 통과했습니다. 저장 직후와 완료 기록 변경 후의 강제 종료·복원, 편집·진척률·오프라인 실행 취소·뒤로 가기, 네이티브 공유·파일 선택·가져오기·삭제를 확인했습니다. [결과와 환경 설정](docs/validation/android-emulator-2026-10-31.md)을 참고하세요.
