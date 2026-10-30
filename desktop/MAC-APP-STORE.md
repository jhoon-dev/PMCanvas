# Mac App Store 배포

이 문서는 GitHub DMG/ZIP용 [Developer ID·공증 설정](MAC-SETUP.md)과 별개입니다. `Mac App Store` 워크플로는 Apple Silicon·Intel을 포함하는 **universal MAS** 앱을 빌드합니다. 검증 빌드, 서명한 PKG, 업로드, 심사 제출, 실제 게시를 구분합니다. unsigned 검증 ZIP을 App Store에 제출하거나 일반 사용자용 설치본으로 배포하지 않습니다.

## 계정 계약 확인

App Store Connect의 신규 앱 등록이 **계약 업데이트** 안내로 차단되면 계정 소유자가 [비즈니스](https://appstoreconnect.apple.com/business)에서 계약을 검토·동의해야 합니다. 필요하면 [Apple Developer 계정](https://developer.apple.com/account/)의 최신 Program License Agreement도 먼저 확인합니다. 계약·세금·거래자 자격 정보는 계정 소유자가 실제 상황에 맞게 제공합니다.

## 앱과 서명 자료

1. [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)에서 명시적 App ID **`app.pmcanvas.desktop`**, 설명 **PM Canvas Desktop**을 등록합니다. 다른 ID로 등록하면 패키지 설정의 `build` → `appId`도 일치시켜야 합니다.
2. App Store Connect → 앱 → 신규 앱: 플랫폼 **macOS**, 이름 **PM Canvas Desktop**, 기본 언어 **한국어**, 위 Bundle ID, SKU **PMCanvasDesktopMac**으로 생성합니다. 이름이 이미 사용 중이면 사용할 수 있는 이름을 정합니다.
3. **Apple Distribution**(또는 Mac App Distribution) 앱 서명 인증서와 **Mac Installer Distribution / 3rd Party Mac Developer Installer** 설치 패키지 인증서를 발급합니다. 개인 키를 포함한 P12를 각각 내보냅니다. Developer ID Application·Installer 인증서는 이 Store 경로에 사용하지 않습니다.
4. 위 App ID와 앱 서명 인증서에 연결한 **Mac App Store Connect 배포 프로비저닝 프로파일**을 발급합니다. 개발·Developer ID 프로파일을 사용하지 않습니다.
5. App Store Connect → 사용자 및 액세스 → 통합에서 업로드 권한을 가진 **Team API Key**를 준비합니다. P8은 한 번만 내려받을 수 있으며 Key ID·Issuer ID를 함께 보관합니다. 기존 키가 있다면 권한을 확인해 재사용할 수 있습니다.

개인 키·P12·P8·프로비저닝 프로파일·암호는 채팅·이슈·커밋에 넣지 않습니다. 인증서 발급에는 해당 인증서용 CSR과 개인 키가 필요합니다. 기존 `signing:setup`은 **Developer ID 전용**이므로 MAS 인증서 변환·등록에 사용하지 않습니다.

## GitHub 설정

저장소 Settings → Environments → **desktop-mac-store**를 만듭니다. Variable:

| 이름             | 값                             |
| ---------------- | ------------------------------ |
| `PM_MAS_TEAM_ID` | Apple 개발 팀의 10자리 Team ID |

Environment Secrets:

| 이름                             | 값                                                      |
| -------------------------------- | ------------------------------------------------------- |
| `MAS_CSC_LINK`                   | 앱 배포 인증서와 개인 키를 포함한 P12의 base64          |
| `MAS_CSC_KEY_PASSWORD`           | 위 P12의 암호                                           |
| `MAS_INSTALLER_CSC_LINK`         | 설치 패키지 배포 인증서와 개인 키를 포함한 P12의 base64 |
| `MAS_INSTALLER_CSC_KEY_PASSWORD` | 위 P12의 암호                                           |
| `MAS_PROVISION_PROFILE_BASE64`   | 배포 프로비저닝 프로파일 파일의 base64                  |
| `ASC_KEY_BASE64`                 | App Store Connect Team API P8 파일의 base64             |
| `ASC_KEY_ID`                     | API Key ID                                              |
| `ASC_ISSUER_ID`                  | API Issuer ID                                           |

base64는 암호화가 아닙니다. `gh secret set NAME --env desktop-mac-store --repo jhoon-dev/PMCanvas`의 숨김 입력 또는 파일의 표준 입력으로 등록하고 값을 로그에 출력하지 않습니다. 기존 `desktop-release`의 Developer ID Secrets와 별도로 관리합니다.

## 빌드·업로드

- push·PR: 비밀값 없이 unsigned universal MAS 앱을 만들고 소스·패키지 허용 목록·두 CPU 아키텍처·아이콘을 검사합니다. 결과는 `PMCanvas-MAS-verification-NOT-for-submission` 아티팩트입니다. **서명된 샌드박스 실행 검증은 아닙니다.**
- main에서 수동 실행, `submission=true`, `upload=false`: 프로파일의 팀·앱 ID·유효기간·배포 종류를 검사하고 앱과 PKG를 서명합니다. 서명과 체크섬을 확인한 결과는 `PMCanvas-Mac-App-Store-submission`입니다.
- `submission=true`, `upload=true`: 같은 PKG의 SHA-256과 소스 커밋을 확인한 뒤 `xcrun altool`로 검증·업로드합니다. Apple의 처리 완료·심사·공개는 별도이며, 워크플로 성공을 실제 게시 완료로 해석하지 않습니다. 같은 버전의 새 빌드는 증가한 `CFBundleVersion`이 필요합니다. `github.run_number`를 사용하며 재실행 대신 새 workflow dispatch를 사용합니다.

로컬 macOS에서는 `.env.mas`에 위 값들을 `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_INSTALLER_LINK`, `CSC_INSTALLER_KEY_PASSWORD`, `PM_MAS_TEAM_ID`, `PM_MAS_BUILD_NUMBER`, `PM_MAS_PROFILE`(절대 경로) 이름으로 설정합니다. `npm run release:check:mas`, `npm run dist:mas`를 `desktop/`에서 실행합니다. 빌드는 깨끗한 커밋의 원본만 사용합니다. `npm run verify:mas`는 서명 자료 없이 패키지 구조만 검증합니다.

## 샌드박스 실행과 심사

MAS는 GitHub 설치 파일을 내려받지 않고 Mac App Store 업데이트 화면을 엽니다. 프로젝트를 다시 열기 위한 보안 범위 북마크는 앱 컨테이너의 `file-access.json`에 보관합니다. 파일을 임시 파일로 쓴 뒤 교체하는 안전한 저장을 유지하기 위해, 첫 저장 때 사용자가 대상 파일의 **상위 폴더**를 직접 선택해야 합니다. 다른 폴더 선택이나 취소로는 저장하지 않습니다. 내보내기의 일시 권한은 완료·실패 후 해제합니다.

프로덕션 배포 서명 앱은 직접 실행해서 검증하지 않습니다. 개발 인증서·등록된 Mac·개발 프로파일을 이용한 `mas-dev` 빌드 또는 처리된 TestFlight 빌드에서 다음을 실제로 확인한 뒤 심사에 제출합니다. **현재 unsigned CI 결과만으로 이 검증이 완료됐다고 표시하지 않습니다.**

- 새 프로젝트·프로젝트 열기·저장·다른 이름 저장·재시작 후 재열기·미저장 복구.
- 폴더 권한 선택·취소·잘못된 폴더·권한 철회·외부 파일 변경 보호.
- Excel 가져오기·작업 프로세스·템플릿·Excel/CSV/JSON 내보내기.
- 한국어·영어, 개인정보처리방침 링크, Mac App Store 업데이트 이동.

App Store Connect에서 버전 **0.8.3**, 생산성 카테고리, 연령 등급, 실제 개인정보 처리 내역, 지원 URL, 개인정보처리방침 URL, macOS 스크린샷, 가격·지역·심사 연락처·심사 메모를 작성하고 처리된 빌드를 선택합니다. 가격·지역·법적 선언·연락처는 소유자가 확정합니다. 앱은 오프라인·계정 없이 사용하며 프로젝트를 개발자 서버로 수집하지 않습니다. 개인정보 표시의 최종 답변은 Apple 질문과 [실제 방침](PRIVACY.md)을 대조합니다. App Review 승인과 출시 설정이 완료되어야 실제 게시됩니다.

## 근거

- [Electron Mac App Store 제출 가이드](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [electron-builder v26 MAS 설정](https://www.electron.build/v26/docs/mas/)
- [Electron 파일 대화상자와 보안 북마크](https://www.electronjs.org/docs/latest/api/dialog)
- [Apple 빌드 업로드](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
