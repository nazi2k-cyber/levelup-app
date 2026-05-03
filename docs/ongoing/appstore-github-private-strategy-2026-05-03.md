# 앱스토어 출시 전략 및 GitHub Private 전환 검토

> 작성일: 2026-05-03

---

## 배경

- 현재 Play Store 공개 테스트 또는 출시 중
- GitHub 레포지토리 퍼블릭 상태
- iOS App Store 출시 여부 미결정
- 향후 GitHub Private 전환 예정

---

## 질문 1: Apple Developer Program 가입만으로 GitHub Actions 클라우드 환경에서 앱스토어 심사 제출이 가능한가?

### 결론: 가입은 필요조건이지만 충분조건이 아님

GitHub Actions macOS 러너만으로 앱스토어 심사 제출까지 완전 자동화할 수 있으나, 아래 4가지가 모두 갖춰져야 한다.

| 항목 | 설명 | 비고 |
|---|---|---|
| Apple Developer Program | 연 $99 유료 가입 | 인증서·프로파일 발급의 전제 |
| 배포 인증서 + 개인키 | Distribution Certificate (`.p12` + 비밀번호) | GitHub Secret에 Base64로 저장 |
| 배포 프로비저닝 프로파일 | App Store 배포용 `.mobileprovision` | GitHub Secret에 Base64로 저장 |
| App Store Connect API Key | `.p8` + Key ID + Issuer ID | 업로드 자동화 인증에 필요 |

macOS 물리 장비는 불필요. GitHub-hosted macOS 러너로 대체 가능.

### 현재 `ios-build.yml`의 한계

현재 워크플로우는 앱스토어 제출 불가 상태 (CI 검증 전용).

```
CODE_SIGNING_ALLOWED=NO   ← 코드 사이닝 없음
-configuration Debug       ← Debug 빌드
-sdk iphonesimulator       ← 시뮬레이터용 빌드
```

앱스토어 제출을 위해 필요한 추가 단계:

```
1. xcodebuild archive        → .xcarchive 생성 (코드 사이닝 포함)
2. xcodebuild -exportArchive → .ipa 생성
3. xcrun altool / fastlane   → App Store Connect 업로드
```

---

## 질문 2: iOS 자동화 워크플로우를 지금 만들고 Private 전환할까, 아니면 Private 전환 후 시장 반응 보고 결정할까?

### 현재 상태 진단

**보안 현황**
- 실제 민감값(키스토어, API 키 등)은 모두 GitHub Secrets에 저장 → 공개 노출 없음
- Firebase 설정값(projectId 등)은 `.gitleaks.toml`에서 의도적으로 허용 처리됨 (클라이언트 식별자, 정상)
- **주요 위험**: `www/app.js` 등 비즈니스 로직 전체가 공개 상태 → 경쟁사 기능 복사 가능

**GitHub Actions 비용 구조**

| 상태 | Ubuntu (Android) | macOS (iOS) |
|---|---|---|
| Public 레포 | 무제한 무료 | 무제한 무료 |
| Private Free 플랜 | 2,000분/월 (1× 배율) | 2,000분 중 **10× 배율** 차감 |
| Private Team 플랜 | 3,000분/월 | 3,000분 중 10× 배율 차감 |

macOS 러너 10× 배율 → iOS 빌드 1회 약 15분 = **150분 소진**. Free 플랜 기준 월 13회 한계.

현재 `release-aab.yml` (Ubuntu)은 Private 전환 후에도 비용 부담 거의 없음.

---

### 결론: 지금 바로 Private 전환이 우선

iOS 자동화는 시장 반응 확인 후 개발하는 것이 합리적.

**보안 측면**
- 소스코드 노출이 가장 큰 리스크. 플레이스토어 출시 전 공개 상태를 유지할 이유 없음
- 워크플로우 YAML 공개 시 인프라 구조(Firebase 프로젝트, Secret 이름 목록)도 노출됨

**비용 측면**
- iOS 워크플로우를 지금 만들어도 시장 반응이 나쁘면 매몰 비용
- iOS 개발 결정 시점에 맞춰 개발해도 늦지 않음
  - 로컬 검증 후 1~2회 CI 실행으로 확정 가능
  - macOS 분당 $0.008 × 10× 배율 = 회당 약 $1~2 수준, 큰 부담 아님
- Android 출시는 현재 `release-aab.yml` (Ubuntu)로 충분

---

### 권장 실행 순서

```
1. 지금        → GitHub Private 전환
2. 단기        → Play Store 출시 (현재 release-aab.yml 그대로 사용)
3. 4~8주 후   → 시장 반응 확인
4. iOS 결정 시 → Apple Developer Program 가입 + iOS 배포 워크플로우 추가
```

---

## 관련 파일

| 파일 | 설명 |
|---|---|
| `.github/workflows/release-aab.yml` | Android AAB 빌드 + Play Store 제출 자동화 |
| `.github/workflows/ios-build.yml` | iOS 시뮬레이터 빌드 CI (심사 제출 불가) |
| `.gitleaks.toml` | 비밀값 스캔 허용 목록 |
| `docs/ongoing/IOS_SECRETS_CHECKLIST.md` | iOS 배포 시 필요한 Secret 목록 |
| `docs/ongoing/github-private-conversion-analysis-2026-04-30.md` | GitHub Private 전환 분석 (이전 문서) |
