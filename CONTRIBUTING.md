# 개발 안내

- 웹 제품은 `web/`, 데스크톱 제품은 `desktop/`, iPhone·Android 앱은 `mobile/`, 제품이 공유하는 원본은 `shared/`에서 관리합니다.
- 기존 웹 개발·DB·보안·운영 검증 지침은 [web/CONTRIBUTING.md](web/CONTRIBUTING.md)를 따릅니다.
- 데스크톱 실행·패키징·검증은 [desktop/README.md](desktop/README.md)를 따릅니다.
- 모바일 실행·네이티브 빌드·검증은 [mobile/README.md](mobile/README.md)를 따릅니다.
- 공통 코드는 제품 폴더를 import하지 않습니다. 제품 간 직접 import는 개발 검증 도구 외에는 사용하지 않습니다.
- 루트에서 `npm run format:check`, `npm run public:check`, 제품별 테스트를 실행합니다.
- 환경설정·키·메일 정보·DB 덤프·설치본·생성된 앱 파일은 커밋하지 않습니다.
