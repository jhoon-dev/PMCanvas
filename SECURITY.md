# 보안 안내

웹의 인증·메일·백업·운영 보안 지침은 [web/SECURITY.md](web/SECURITY.md)를 참고하세요. 데스크톱의 브리지·파일 보호와 배포 전 검증은 [desktop/README.md](desktop/README.md)에 설명합니다.

공통 입력 검증은 `shared/model/`에서 관리하며 두 제품에서 같은 규칙을 사용합니다. 비공개 운영 데이터는 제품별 폴더에 보관하고 Git이나 배포 패키지에 포함하지 않습니다.
