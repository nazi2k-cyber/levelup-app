# iOS 릴리즈 시크릿 체크리스트

## 목적
- iOS 서명/업로드에 필요한 시크릿을 표준화하고, 만료 및 소유자 관리 기준을 명확히 한다.

## Required Secrets

| Secret 이름 | 용도 | 갱신 주기 | 소유자 |
|---|---|---|---|
| `IOS_P12_BASE64` | 배포 인증서(.p12) base64 값 | 인증서 만료 전(보통 1년) | 모바일 릴리즈 담당 |
| `IOS_P12_PASSWORD` | .p12 비밀번호 | 인증서 교체 시 | 모바일 릴리즈 담당 |
| `IOS_PROFILE_BASE64` | provisioning profile base64 값 | 프로파일 만료 전(보통 1년) | 모바일 릴리즈 담당 |
| `KEYCHAIN_PASSWORD` | CI 임시 키체인 비밀번호 | 분기 1회 이상 교체 권장 | DevOps |
| `ASC_API_KEY_ID` | App Store Connect API Key ID | 키 재발급 시 | iOS 배포 권한 보유자 |
| `ASC_API_ISSUER_ID` | App Store Connect Issuer ID | 변경 시 | iOS 배포 권한 보유자 |
| `ASC_API_PRIVATE_KEY_BASE64` | App Store Connect API Private Key(.p8) base64 값 | 키 재발급 시 | iOS 배포 권한 보유자 |

## Optional Secrets

| Secret 이름 | 용도 | 갱신 주기 | 소유자 |
|---|---|---|---|
| `APPLE_TEAM_ID` | export 옵션/서명 설정 보조 값 | 팀 변경 시 | iOS 배포 권한 보유자 |
| `IOS_BUNDLE_ID` | 번들 ID 오버라이드/검증 용도 | 앱 ID 변경 시 | 모바일 리드 |

## 운영 규칙
- 인증서/프로파일/p8 원문 파일은 저장소에 커밋하지 않는다.
- GitHub Secrets에는 base64 변환본만 저장한다.
- keychain은 릴리즈 job 종료 시 반드시 삭제한다.
- 시크릿 권한은 최소 권한 원칙으로 제한한다.

## 점검 루틴
1. 분기 시작 주에 만료 예정 시크릿 점검
2. 만료 30일 전 교체 일정 확정
3. 교체 후 `workflow_dispatch`로 iOS release dry-run 수행
4. 점검 결과를 릴리즈 노트/운영 문서에 기록
