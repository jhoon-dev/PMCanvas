# Mac 인증서 발급부터 GitHub 자동 공개까지

현재 CI는 Mac ARM64·Intel DMG/ZIP을 Developer ID로 서명하고 Apple에 공증을 요청합니다. 두 Mac의 설치 검증과 파일 해시 검증을 통과한 뒤 GitHub Release를 공개합니다. Apple 로그인·회원 가입·약관 동의·인증서 발급은 계정 소유자가 진행합니다. Apple 계정 이메일만 등록한 상태로는 서명할 수 없습니다.

## Windows 자동 설정 도구 — Mac이 없는 경우

저장소 루트의 PowerShell에서 실행합니다. Node.js와 Git for Windows의 OpenSSL 3, GitHub CLI가 필요합니다. 이 PC의 기본 Git OpenSSL 경로는 도구가 자동으로 찾습니다.

```powershell
npm --prefix desktop run signing:setup
```

1. **새 작업 폴더**를 선택하고 메뉴 **1**에서 개발자 이메일과 개인 키 암호 A를 입력합니다. 숨김 입력이므로 화면에 글자가 나타나지 않습니다. CSR과 AES-256으로 암호화한 개인 키를 생성합니다.
2. 도구가 표시한 Apple 페이지에서 **Certificates → + → Developer ID Application**을 선택하고 표시된 CSR만 업로드합니다. Apple 로그인·멤버십·약관·발급은 본인이 진행합니다. 개인 키를 Apple에 올리지 않습니다.
3. 발급된 `.cer`를 다운로드합니다. 스크립트를 종료했다면 같은 명령을 다시 실행하고 기존 작업 폴더를 선택합니다.
4. 메뉴 **2**에서 `.cer` 경로, 원래 개인 키 암호 A, 새 P12 암호 B를 입력합니다. 인증서 종류·유효기간·키 일치·Apple 중간 인증서 서명과 고정 SHA-256을 확인한 뒤 P12를 생성합니다. 기존 키·완성된 P12는 덮어쓰지 않습니다.
5. GitHub CLI 로그인이 필요하면 다른 터미널에서 `gh auth login`을 완료합니다. 메뉴 **3**에서 P12 암호 B를 입력하면 `jhoon-dev/PMCanvas`의 **desktop-release Environment**에 `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`를 등록합니다.
6. 메뉴 **4**에서 공증 방식을 선택합니다. Apple 계정 방식은 앱 전용 암호·Team ID를, API 방식은 App Manager 권한의 Team Key P8·Key ID·Issuer ID를 입력합니다. 키 발급 위치와 정확한 Secret 이름은 아래 5·6절에 설명합니다.
7. 등록 후 **Actions → Desktop verification and builds**에서 `platform=mac`, `signed=true`, `unsigned=false`, `publish=false`로 먼저 확인합니다. 성공 실행을 확인한 뒤 공개합니다.

개인 키·CSR·P12와 지문만 담은 상태 파일은 `%LOCALAPPDATA%` 아래의 무작위 `PMCanvas-MacSigning-` 작업 폴더에 보관합니다. 폴더는 현재 Windows 사용자만 접근하도록 ACL을 제한합니다. 도구는 Git 저장소·worktree 내부, 정션·심볼릭 링크, 공유 접근 권한이 있는 작업 폴더를 거부합니다. 여러 작업을 동시에 실행하면 잠금으로 중복 생성을 막습니다.

암호는 공백 없이 영문·숫자·기호 **16~128자**로 설정합니다. **A는 개인 키를 여는 암호, B는 P12 암호이자 `MAC_CSC_KEY_PASSWORD` 값**입니다. 두 암호를 비밀번호 관리자에 구분해 보관하세요. 상태 파일에 암호를 저장하지 않습니다.

암호·P12 base64·P8 원문은 화면·스크립트 로그·클립보드·명령 인수에 출력하지 않습니다. OpenSSL 암호는 자식 프로세스의 일시적인 환경으로, GitHub Secret 값은 표준 입력으로만 전달합니다. 외부 도구의 원문 오류도 출력하지 않습니다. 입력·출력을 파일로 리다이렉트한 비대화형 실행은 거부합니다.

`NODE_DEBUG`, `NODE_OPTIONS` 또는 Node의 디버그·추적 옵션이 활성화되어 있으면 비밀값을 받기 전에 중단합니다. 특히 `NODE_DEBUG=child_process`가 자식 프로세스 환경을 로그에 남기는 것을 막습니다.

공증 방식을 바꿀 때 다른 방식의 Secret이 Environment 또는 저장소에 남아 있으면 등록을 중단합니다. 기존 Secret은 자동 삭제하지 않습니다. GitHub에서 다른 그룹을 직접 제거한 뒤 다시 등록하세요. 네트워크 오류로 등록이 중단되면 일부 Secret만 갱신되었을 수 있으므로 같은 등록 단계를 다시 실행합니다. 도구는 CI 빌드나 Release 공개를 자동 실행하지 않습니다.

Apple 중간 인증서는 [Apple PKI](https://www.apple.com/certificateauthority/)의 Developer ID G1·G2에서 가져오며 고정된 지문을 검사합니다. P12에는 macOS 키체인 호환용 보호 방식을 사용하고, 원본 개인 키는 AES-256으로 암호화합니다. [OpenSSL P12 설명](https://docs.openssl.org/3.0/man1/openssl-pkcs12/)

아래 절은 Mac 키체인을 이용해 수동으로 준비하는 대안입니다.

## 1. 준비

- Windows 자동 도구 또는 Mac 키체인으로 CSR·P12를 준비할 수 있습니다. Mac을 직접 보유할 필요는 없으며 실제 빌드는 GitHub의 Mac runner에서 실행합니다.
- 활성 Apple Developer Program 멤버십. [Apple Developer 계정](https://developer.apple.com/account/)에서 Membership details와 Team ID를 확인하세요.
- 인증서 생성 권한. 수동 Developer ID 발급은 Account Holder 권한이 필요합니다.
- 이 저장소의 GitHub Settings에 접근할 수 있는 계정.

이번 배포는 **Mac App Store 외부의 GitHub DMG/ZIP 배포**입니다. 선택할 인증서는 **Developer ID Application**입니다. Apple Development, Apple Distribution, Developer ID Installer를 대신 선택하지 마세요. Installer 인증서는 PKG용이며 현재 DMG/ZIP 배포에는 필요하지 않습니다. [Apple 인증서 안내](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)

## 2. Mac에서 CSR 생성

1. Spotlight에서 **키체인 접근 / Keychain Access**를 엽니다.
2. 상단 **키체인 접근 → 인증서 지원 → 인증 기관에서 인증서 요청…**을 선택합니다. 영문 메뉴는 **Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority…**입니다.
3. User Email Address에 본인의 Apple 개발자 계정 이메일을 입력합니다.
4. Common Name에는 구분 가능한 이름(예: `PM Canvas Developer ID`)을 입력합니다.
5. CA Email Address는 비워 둡니다.
6. **디스크에 저장 / Saved to disk**를 선택하고 `.certSigningRequest` 파일을 저장합니다.

이때 개인 키는 이 Mac의 키체인에 생성됩니다. CSR 파일만 다른 Mac으로 옮겨 발급하면 그 Mac에는 원래 개인 키가 없으므로 P12를 내보낼 수 없습니다. 인증서 가져오기도 CSR을 만든 Mac에서 진행하세요. [Apple CSR 안내](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)

## 3. Developer ID Application 인증서 발급

1. [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)에 로그인합니다.
2. **Certificates → +**를 선택합니다.
3. **Developer ID / Developer ID Application**을 선택합니다. 화면에 Software 아래 Developer ID가 먼저 나오면 다음 화면에서 Application을 선택합니다.
4. Continue를 눌러 앞에서 만든 CSR을 업로드합니다.
5. 발급이 끝나면 `.cer` 파일을 다운로드합니다.
6. CSR을 만든 Mac에서 `.cer`를 더블클릭해 login 키체인에 가져옵니다.
7. 키체인 접근의 **나의 인증서 / My Certificates**에서 `Developer ID Application: … (TEAMID)`를 찾습니다.
8. 인증서 왼쪽 펼침 표시를 열어 **개인 키가 함께 표시되는지** 확인합니다.

메뉴에 Developer ID가 없으면 팀 선택·Account Holder 권한·멤버십·보류된 약관을 확인하세요. 이미 정상 인증서가 있다면 중복 발급하기보다 그 인증서와 개인 키를 사용할 수 있습니다.

## 4. 개인 키를 포함한 P12 내보내기

1. My Certificates의 Developer ID Application 인증서를 선택합니다. 펼쳤을 때 개인 키가 연결된 항목이어야 합니다.
2. **파일 → 항목 내보내기… / File → Export Items…**를 선택합니다.
3. 형식은 **Personal Information Exchange (.p12)**, 파일명은 예를 들어 `PMCanvas-DeveloperID.p12`로 지정합니다.
4. 강한 **P12 파일 전용 암호**를 설정하고 비밀번호 관리자에 보관합니다. Apple 로그인 암호와 별개입니다.
5. macOS가 키체인 접근을 확인하면 이 Mac의 로그인 암호 등 요청된 인증을 진행합니다.

`.p12`를 선택할 수 없거나 인증서만 `.cer`로 내보내진다면 개인 키가 연결되지 않은 경우가 많습니다. CSR을 만든 키체인을 확인하세요. `.cer`만 GitHub에 등록하면 서명할 수 없습니다. [Apple 키체인 내보내기 안내](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac)

## 5. 공증 자격 증명 준비: 두 방식 중 하나

### A. App Store Connect Team API 키 — CI용 권장

현재 저장소에 고정된 `@electron/notarize`가 지원하는 **Team Key + App Manager** 방식을 사용합니다. 이 경로에서는 Individual Key를 사용하지 않습니다.

1. [App Store Connect](https://appstoreconnect.apple.com/)에 로그인합니다.
2. **Users and Access → Integrations → App Store Connect API → Team Keys**로 이동합니다.
3. Request Access가 보이면 Account Holder가 약관에 동의해 접근을 요청합니다. 이 요청이 승인된 후 키를 생성합니다.
4. **Generate API Key / +**에서 이름을 `PMCanvas CI Notarization` 등으로 정합니다.
5. Access는 **App Manager**를 선택하고 생성합니다. Admin 권한은 필요하지 않습니다.
6. **Key ID**와 **Issuer ID**를 기록합니다. Issuer ID는 UUID이고 Team ID와 다릅니다.
7. `AuthKey_키ID.p8` 파일을 다운로드합니다. **개인 키는 한 번만 다운로드할 수 있습니다.**

Team API 키는 역할 범위 내에서 팀의 여러 앱에 접근할 수 있으므로 전용 키로 관리하고 필요 없어지면 폐기하세요. 이 프로젝트에서는 P8을 base64 Secret으로 받아 CI 임시 파일로 만들고 완료·실패 후 정리합니다. [Apple API 키 안내](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/), [현재 사용 라이브러리의 공증 인증 안내](https://github.com/electron/notarize#usage-with-app-store-connect-api-key)

### B. Apple 계정 + 앱 전용 암호 — 대안

API 키를 만들 수 없다면 이 방식을 사용합니다.

1. Apple 계정의 이중 인증을 활성화합니다.
2. [Apple 계정](https://account.apple.com/)의 **로그인 및 보안 → 앱 암호 / App-Specific Passwords**로 이동합니다.
3. 새 앱 전용 암호를 만들고 구분할 이름을 지정합니다.
4. 생성된 앱 전용 암호를 보관합니다. **평소 Apple 로그인 암호를 넣지 마세요.**
5. [Developer 계정](https://developer.apple.com/account/)의 **Membership details**에서 10자리 **Team ID**를 확인합니다.

계정 기본 암호를 변경하면 기존 앱 전용 암호가 취소될 수 있습니다. 이 경우 새 암호로 Secret을 갱신합니다. [Apple 앱 전용 암호 안내](https://support.apple.com/en-us/102654), [Team ID 확인](https://developer.apple.com/help/glossary/team-id/)

## 6. GitHub Environment Secrets 등록

저장소 **Settings → Environments → desktop-release → Environment secrets → Add secret**에 등록합니다. 아래 이름은 현재 CI가 읽는 정확한 이름입니다. 일반 Variables 칸에 비밀 키나 암호를 넣지 마세요.

공통 필수:

| Secret                 | 넣을 값                                      |
| ---------------------- | -------------------------------------------- |
| `MAC_CSC_LINK`         | P12 파일 전체를 base64로 변환한 한 줄 문자열 |
| `MAC_CSC_KEY_PASSWORD` | 4단계에서 설정한 P12 내보내기 암호           |

A 방식 추가:

| Secret                 | 넣을 값                               |
| ---------------------- | ------------------------------------- |
| `APPLE_API_KEY_BASE64` | P8 파일 전체를 base64로 변환한 문자열 |
| `APPLE_API_KEY_ID`     | P8의 Key ID                           |
| `APPLE_API_ISSUER`     | Team API 키의 Issuer ID               |

B 방식 추가:

| Secret                        | 넣을 값                                |
| ----------------------------- | -------------------------------------- |
| `APPLE_ID`                    | 본인의 Apple 개발자 계정 로그인 이메일 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 앱 전용 암호                           |
| `APPLE_TEAM_ID`               | 10자리 개발 팀 ID                      |

A와 B를 섞어 일부만 등록하지 말고 한 그룹을 완성하세요. A로 전환할 때 B의 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`는 제거해 인증 방식을 명확히 합니다. 로컬 설정은 P8 경로를 쓰지만 CI Secret은 `APPLE_API_KEY_BASE64`입니다.

Mac 터미널에서 다음처럼 클립보드에 복사한 뒤 GitHub Secret 값 칸에 붙여 넣을 수 있습니다. 파일은 저장소 밖에 둡니다.

```sh
base64 -i "$HOME/Certificates/PMCanvas-DeveloperID.p12" | tr -d '\n' | pbcopy
# GitHub의 MAC_CSC_LINK에 붙여 넣고 저장합니다.

base64 -i "$HOME/Certificates/AuthKey_KEYID.p8" | tr -d '\n' | pbcopy
# A 방식: APPLE_API_KEY_BASE64에 붙여 넣고 저장합니다.
```

base64는 암호화가 아닙니다. 출력·클립보드도 비밀로 취급하고 공개 이슈·커밋·채팅에 붙여 넣지 마세요. 작업 후 클립보드를 비웁니다.

GitHub CLI를 사용한다면 파일을 표준 입력으로 전달할 수 있습니다. 암호를 명령 인수에 쓰지 않습니다.

```sh
gh auth login
base64 -i "$HOME/Certificates/PMCanvas-DeveloperID.p12" | tr -d '\n' | gh secret set MAC_CSC_LINK --env desktop-release --repo jhoon-dev/PMCanvas
gh secret set MAC_CSC_KEY_PASSWORD --env desktop-release --repo jhoon-dev/PMCanvas
# 암호를 숨김 프롬프트에 입력합니다.

base64 -i "$HOME/Certificates/AuthKey_KEYID.p8" | tr -d '\n' | gh secret set APPLE_API_KEY_BASE64 --env desktop-release --repo jhoon-dev/PMCanvas
gh secret set APPLE_API_KEY_ID --env desktop-release --repo jhoon-dev/PMCanvas
gh secret set APPLE_API_ISSUER --env desktop-release --repo jhoon-dev/PMCanvas
gh secret list --env desktop-release --repo jhoon-dev/PMCanvas
```

`gh secret list`에는 이름만 보이며, 저장한 Secret 원문은 다시 조회할 수 없습니다. CLI 프롬프트에서 실제 값을 입력합니다. [GitHub Environment Secret 안내](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

## 7. 처음에는 공개 없이 실행

**Actions → Desktop verification and builds → Run workflow**에서 다음을 선택합니다.

| 항목        | 첫 검증 | 검증 후 자동 공개                      |
| ----------- | ------- | -------------------------------------- |
| Branch      | `main`  | `main`                                 |
| platform    | `mac`   | `mac`                                  |
| signed      | `true`  | `true`                                 |
| unsigned    | `false` | `false`                                |
| publish     | `false` | `true`                                 |
| release_run | 비워 둠 | 이전 성공 실행 ID로 공개만 재시도 가능 |

실행에서 Mac 서명 빌드와 ARM64·Intel 설치 검증이 모두 성공했는지 확인합니다. 결과의 `release-manifest.json`에는 `signed=true`, `notarized=true`가 있어야 합니다. 실제 검사는 코드 서명·Gatekeeper·공증 티켓·DMG/ZIP 안의 앱·저장/재설치 데이터 보존을 포함합니다.

첫 실행이 성공하면 같은 성공 실행을 `release_run`에 입력하고 `publish=true`로 실행해 재빌드 없이 공개할 수 있습니다. 원본과 같은 `platform=mac`, `signed=true`를 유지합니다. 새로 빌드해 공개해도 됩니다. 공개된 동일 버전은 덮어쓰지 않으며 새 배포에는 새 버전을 사용합니다. 인증서가 없거나 공증이 실패하면 서명 없는 파일로 대체 공개하지 않습니다.

## 8. 자주 생기는 오류

| 오류 상황              | 확인할 항목                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| 인증서를 찾지 못함     | `MAC_CSC_LINK`가 CER가 아닌 개인 키 포함 P12의 base64인지             |
| P12 가져오기 실패      | 파일 손상·복사 누락·P12 암호 불일치                                   |
| 공증 401 / 인증 실패   | API Key ID·Issuer ID·Team Key 권한, 또는 앱 전용 암호·Team ID         |
| `.p8` 없음             | 로컬은 경로, GitHub는 `APPLE_API_KEY_BASE64`인지                      |
| Developer ID 메뉴 없음 | Account Holder 권한·활성 멤버십·팀·약관                               |
| 공개 단계만 실패       | 성공 실행 ID로 `release_run` 재시도. 공개된 같은 버전은 변경하지 않음 |

P12와 P8 원본은 암호화해 별도 보관하세요. 인증서가 만료되면 새 인증서와 P12로 두 Mac Secret을 교체하고, P8을 분실하면 기존 키를 폐기하고 새 키 세트를 등록합니다. 어느 경우에도 기존 인증서를 이유 없이 먼저 폐기하지 마세요.
