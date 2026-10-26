# 검증 결과 · 2026-10-25 · 0.6.0

- 단위·프로토콜·API 테스트 59개 통과. 외부 인증 관련 테스트는 실제 모의 OIDC HTTP 서버·PKCE·JWT 서명·JWKS·UserInfo, SAML Response/Assertion 서명과 교차 출처 POST, LDAP 클라이언트 대역을 사용합니다.
- 별도 실제 HTTP 통신 테스트 7개 통과(메모리 저장 어댑터).
- PostgreSQL 18 실제 통합 테스트 3개 통과. 마이그레이션 재실행, 프로젝트·권한·동시 수정·롤백, 계정 관리, 외부 ID 매핑, 이메일 자동 연결 차단, 로컬 비밀번호 로그인 금지, 비활성화, 세션 폐기, 일회성 흐름의 동시 소비와 만료를 검증했습니다.
- OIDC의 잘못된 서명·issuer·audience·nonce·만료 및 UserInfo sub 불일치 거부 확인. 다른 브라우저의 콜백 및 state 재사용 차단 확인.
- SAML SP 요청 서명·SP 메타데이터·응답/Assertion 서명 검증, Recipient 불일치와 서명 없는 응답 거부 확인. SAML 실제 IdP의 브라우저 인증은 아직 검증하지 않았습니다.
- AD LDAPS의 필터 이스케이프, 인증서 검증 옵션, 서비스 계정 검색과 별도 사용자 bind, 빈 비밀번호 차단, HTTP Origin 검증을 대역 클라이언트로 확인했습니다. 실제 AD/LDAPS 서버에는 접속하지 않았습니다.
- 브라우저에서 별도 모의 IdP를 통한 OIDC 리디렉션·로그인, 외부 인증 계정의 로컬 비밀번호 메뉴 숨김, 관리자 SSO 연결/계정 매핑 화면, LDAP 로그인 방식 선택과 요청 전환, 콜백 오류 표시 확인. 390px 화면에서 계정 대화상자 가로 넘침 없음 확인.
- 업데이트 전 DB 전체 백업 완료. 기존 계정·프로젝트를 유지하고 마이그레이션 003 적용. Docker 빌드·기동 및 앱/DB healthcheck 통과.
- npm audit --omit=dev: 알려진 취약점 0개(검증 당시).
- 실제 서비스는 http://localhost:4180/pmcanvas/ 에서 실행하며 config/auth.json의 연결은 모두 비활성 상태입니다. 실제 조직의 비밀값·IdP 등록 정보는 넣지 않았습니다.
- 기존 관리자 계정과 비밀번호는 유지했습니다. 임시 UI 인증 서버 및 테스트 DB는 검증 후 종료/정리했습니다.

테스트 수 합계 69개입니다. Entra ID·AD FS·Okta·Keycloak·AD 조직 서버의 실제 인증서/테넌트/클레임/MFA 설정과 상호운용성 검증은 해당 연결 정보가 준비된 환경에서 수행해야 합니다. 외부 배포, SCIM, IdP 전역 로그아웃, Kerberos/NTLM, SAML 암호화 Assertion은 범위에 포함하지 않았습니다.
