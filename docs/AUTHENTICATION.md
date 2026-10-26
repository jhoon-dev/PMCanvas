# 외부 인증 연결 · 0.6.0

PM Canvas는 `config/auth.json`의 `providers` 배열을 읽습니다. 여러 회사를 위한 별도 코드나 플러그인을 작성하지 않고 각 인증 서버의 설정을 등록합니다. 연결별 `enabled: true`를 설정하고 앱을 재시작하면 로그인 화면에 표시됩니다. 설정은 시작할 때 읽으므로 파일 수정만으로 실행 중인 앱이 바뀌지는 않습니다.

| 방식 | 연결 대상 | 로그인 동작 |
|---|---|---|
| OIDC | Microsoft Entra ID, Keycloak, Okta, Authentik, OIDC를 지원하는 AD FS 등 | 인증 서버로 이동 후 돌아옴 |
| SAML 2.0 | Entra 엔터프라이즈 앱, AD FS, Keycloak, Okta 및 표준 SAML IdP | SP에서 시작하는 Redirect → 서명된 POST 응답 |
| LDAPS | 사내 Active Directory 및 LDAP 디렉터리 | 로그인 방식에서 디렉터리를 선택하고 회사 계정으로 인증 |

새 연동에는 OIDC Authorization Code + PKCE를 우선 사용합니다. Microsoft도 신규 개발의 기본 프로토콜로 OIDC를 권장합니다. [Microsoft 공식 가이드](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/plan-sso-integration-isv)

LDAPS는 디렉터리 비밀번호 검증이며 브라우저 통합 SSO는 아닙니다. 앱이 비밀번호를 수신해 암호화된 디렉터리 연결로 검증하고 저장하지 않습니다. AD의 브라우저 SSO·MFA·조건부 액세스가 필요하면 AD와 연결된 Entra ID, AD FS, Keycloak 등을 OIDC/SAML로 사용하세요. Windows 통합 Kerberos/NTLM 인증은 이 버전에 없습니다.

## 설치 및 컨피그 활성화

신규 `npm run setup`은 모든 연결이 비활성화된 `config/auth.json`을 생성하고 Docker 내부 설정 파일 경로를 지정합니다. 기존 설정 파일은 덮어쓰지 않습니다. 기존 설치는 `config/auth.example.json`을 `config/auth.json`으로 복사하고 `.env`에 다음을 추가하세요.

```dotenv
AUTH_CONFIG_FILE=/app/config/auth.json
```

Docker Compose는 `./config`를 `/app/config`에 읽기 전용으로 마운트합니다. `config/secrets` 폴더를 만들고 연결에 필요한 비밀값과 인증서를 넣습니다. 파일 경로는 JSON 파일 위치를 기준으로 합니다. Windows에서 작성한 JSON도 UTF-8(BOM 없음)으로 저장하세요. 기본 예제에는 Entra, Keycloak, SAML, AD가 있으며 필요한 연결만 활성화합니다.

검사 및 재기동:

```sh
docker compose run --rm --no-deps app node scripts/check-auth.mjs
npm run service:up
```

외부 DB Compose에서는 첫 명령에 `-f compose.external.yml`을 추가하고 재기동도 해당 Compose 파일을 사용하세요. 컨피그 검사는 필수 필드·파일·TLS 정책을 검사하며 실제 인증 서버 접속 성공까지 확인하는 명령은 아닙니다.

Node.js로 직접 실행하면 `.env`의 `AUTH_CONFIG_FILE=config/auth.json`으로 바꾸고 `npm run auth:check`, `npm start`를 사용합니다. 비밀 파일은 저장소·설치 ZIP·화면·API 응답에 포함하지 않습니다. 파일과 DB 백업에는 별도 접근 권한을 적용하세요.

## OIDC 예시

```json
{
  "providers": [{
    "id": "company",
    "enabled": true,
    "type": "oidc",
    "label": "회사 계정",
    "issuer": "https://sso.example.com/realms/company",
    "clientId": "pmcanvas",
    "clientSecretFile": "secrets/client-secret.txt",
    "clientAuth": "client_secret_basic",
    "autoProvision": true,
    "allowedDomains": ["example.com"],
    "sessionMinutes": 60
  }]
}
```

인증 서버에 등록할 Redirect URI는 `PUBLIC_ORIGIN + BASE_PATH + /api/auth/sso/{id}/callback`입니다. 위 연결의 서비스가 `https://pm.example.com/pmcanvas/`이면 `https://pm.example.com/pmcanvas/api/auth/sso/company/callback`을 정확히 등록합니다. 웹 서버용 confidential client, Authorization Code, PKCE S256을 사용하세요. `clientAuth`는 `client_secret_basic`과 `client_secret_post`를 지원합니다. implicit flow·비밀번호 grant는 사용하지 않습니다.

`issuer`는 인증 서버가 발급하는 정확한 issuer URL입니다. 서버의 discovery 문서로 엔드포인트를 조회합니다. `openid email profile` scope를 요청하며 `sub`를 고유 ID로 사용합니다. 기본 이메일·이름 클레임은 `email`, `name`이고 `emailClaim`, `nameClaim`으로 바꿀 수 있습니다. 서명·issuer·audience·만료·nonce·state·PKCE를 검증합니다. ID 토큰 서명 알고리즘은 기본 RS256이며 `signingAlgorithm`에 PS256 또는 ES256도 지정할 수 있습니다.

IdP가 이메일을 ID 토큰에 넣지 않으면 discovery의 UserInfo 엔드포인트에서 조회하고 `sub`가 ID 토큰과 같은지 검증합니다. `useUserInfo: true`로 UserInfo를 우선 사용할 수 있습니다. 기본 scope는 `scopes` 배열로 조정하되 `openid`는 필수입니다. 이 버전은 refresh token을 보관하지 않으므로 `offline_access`는 요청하지 않습니다.

Entra ID는 `https://login.microsoftonline.com/{실제-tenant-id}/v2.0`을 사용합니다. `common`이나 `organizations`를 단일 조직 issuer 대신 사용하지 마세요. 예제의 `preferred_username`은 표시용 이메일 클레임이며 계정 식별에는 사용하지 않습니다. Entra처럼 `email_verified`를 제공하지 않는 신뢰된 조직 IdP에서 자동 생성하려면 `trustEmail: true`와 정확한 `allowedDomains`를 명시합니다. 이는 관리자가 해당 IdP의 이메일 클레임 정책을 신뢰한다는 설정입니다. 클레임과 앱 할당은 실제 조직 설정에 맞춰 확인해야 합니다.

## SAML 2.0

예제의 `entryPoint`, `idpIssuer`, `entityId`를 설정하고 다음 파일을 준비합니다.

- `idpCertFile`: 신뢰할 IdP 서명 인증서(PEM).
- `privateKeyFile`: 이 앱의 SP 요청 서명 개인키(PEM).
- `publicCertFile`: 위 개인키에 대응하는 SP 인증서(PEM).

`entityId`는 SP의 고유 Entity ID입니다. ACS URL은 OIDC와 동일한 규칙의 `/callback`, 메타데이터 URL은 `/api/auth/sso/{id}/metadata`입니다. 관리자 계정 화면의 **SSO 연결과 계정 매핑**에서도 URL을 확인할 수 있습니다. IdP에 SP 메타데이터를 등록하고 응답과 Assertion을 모두 RSA-SHA256으로 서명하도록 설정하세요. SP AuthnRequest도 SHA256으로 서명합니다. IdP signing certificate가 바뀌면 컨피그가 참조하는 인증서를 갱신하고 앱을 재시작합니다.

IdP는 재할당되지 않는 영구 NameID와 이메일 클레임을 보내야 합니다. 기본 이메일 클레임 이름은 `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`이며 `emailClaim`으로 변경합니다. 이름도 `nameClaim`으로 매핑합니다. transient NameID는 거절합니다. SP에서 시작한 요청과 브라우저 쿠키에 바인딩한 응답만 허용하고, IdP에서 시작하는 unsolicited 로그인은 허용하지 않습니다.

SAML은 크로스 사이트 POST를 위해 SameSite=None; Secure 쿠키를 사용하므로 PUBLIC_ORIGIN의 HTTPS가 필수입니다. IdP·SP 시계를 동기화하세요. 요청 유효시간은 10분, 허용 시계 오차는 60초입니다. 응답/Assertion 서명, Issuer, Audience, Destination, Recipient, InResponseTo 및 시간 조건을 검증합니다. 이 버전은 암호화하지 않은 서명 Assertion을 지원합니다. Assertion 암호화와 SAML Single Logout은 제공하지 않습니다.

## AD / LDAPS

`ldaps://dc.example.com:636`과 인증서를 신뢰할 CA를 지정합니다. `ldap://` 평문 연결과 인증서 검증 비활성화는 허용하지 않습니다. `caFile`은 디렉터리 TLS의 추가 CA입니다. OIDC 사설 CA는 `.env`의 `NODE_EXTRA_CA_CERTS=/app/config/secrets/root-ca.crt`에 지정합니다.

읽기 전용 서비스 계정 `bindDN`, 비밀번호 파일 `bindPasswordFile`, `searchBase`, `searchFilter`를 설정합니다. 필터에는 `{{username}}`이 정확히 한 번 있어야 하며 실제 사용자 입력은 LDAP 필터 문법으로 이스케이프합니다. 서비스 계정으로 사용자 한 명만 검색한 뒤 별도 LDAPS 연결로 그 사용자의 DN과 비밀번호를 검증합니다. 빈 비밀번호는 거절하고 referral을 따라가지 않습니다.

AD 예제는 `sAMAccountName`을 검색하고 비활성 계정을 제외합니다. UPN을 사용하려면 검색 필터의 속성을 `userPrincipalName`으로 바꾸세요. AD의 안정적인 식별자는 `objectGUID`이며 바이트 원형을 `base64:` 접두사의 Base64로 저장합니다. 이메일·표시 이름은 `mail`, `displayName`을 사용합니다. 범용 LDAP은 `subjectAttribute`를 `entryUUID` 같은 불변 속성으로 변경할 수 있습니다. LDAP group 기반 권한 자동 할당·디렉터리 동기화는 제공하지 않습니다.

## 계정 생성·권한·운영

`autoProvision`의 기본값은 false입니다. true이면 반드시 정확한 이메일 도메인의 `allowedDomains`를 지정해야 합니다. 새 계정은 일반 사용자이며 프로젝트 접근 권한과 관리자 권한을 자동 부여하지 않습니다. 자동 생성 계정은 로컬 비밀번호 로그인·변경·관리자 재설정을 사용할 수 없습니다.

같은 이메일이 기존 계정에 있어도 자동 병합하지 않습니다. 관리자가 기존 사용자를 확인하고 **계정 → SSO 연결과 계정 매핑**에서 연결 ID, 외부 고유 ID, 기존 사용자 이메일을 매핑합니다. OIDC는 `sub`, SAML은 영구 NameID, AD는 `base64:...` 형태의 objectGUID를 입력합니다. API는 `/api/auth/connections`의 GET/POST/DELETE를 사용하며 관리자 세션과 CSRF가 필요합니다. 기존 로컬 계정에 명시적으로 연결하면 기존 로컬 로그인도 유지합니다. 비상 복구용 관리자 계정에는 외부 계정을 연결할 수 없습니다.

연결 ID는 조직별로 고정해 사용하세요. issuer/디렉터리 authority가 바뀌면 같은 연결 ID여도 기존 ID 매핑을 재사용하지 않습니다. 연결 해제 시 해당 사용자의 앱 세션을 종료합니다. 앱 계정 비활성화도 모든 세션과 이후 외부 로그인을 차단하며, 인증 서버 로그인 성공만으로 자동 재활성화하지 않습니다.

외부 로그인 세션은 기본 60분이며 `sessionMinutes`로 5~720분을 지정합니다. IdP의 계정 비활성화·그룹 변경을 앱에 실시간 통보하는 SCIM·back-channel logout·세션 동기화는 제공하지 않습니다. 긴급 차단은 앱에서도 사용자를 비활성화하세요. 앱 로그아웃은 PM Canvas 세션만 종료하며 IdP 세션을 종료하지 않습니다. IdP의 MFA 정책을 사용하고 앱은 별도의 MFA 우회를 제공하지 않습니다.

인증 흐름과 SAML 요청 캐시는 PostgreSQL에 저장하므로 여러 앱 인스턴스에서도 같은 DB를 사용하면 콜백 처리를 공유합니다. 사용한 흐름은 원자적으로 소비합니다. 제한 카운터는 앱 프로세스 단위이므로 인터넷에 공개할 때는 앞단 프록시에서도 요청 제한을 적용하세요.

## 검증 범위

모의 OIDC 서버와 실제 서명 토큰, 서명된 SAML 응답, HTTP 콜백, PostgreSQL 저장·계정 연결·세션 폐기를 검사합니다. 브라우저 OIDC 리디렉션도 모의 IdP로 확인합니다. LDAPS는 클라이언트 대역으로 검색·필터·TLS 옵션·사용자 bind 흐름을 검사했으며 실제 AD 서버에는 아직 연결하지 않았습니다. 실제 Entra ID·AD FS·Okta·Keycloak 테넌트와 조직별 MFA 정책은 접속 정보가 준비된 환경에서 확인해야 합니다.

구현 참고: [openid-client](https://github.com/panva/openid-client), [Node-SAML](https://github.com/node-saml/node-saml), [ldapts](https://github.com/ldapts/ldapts).
