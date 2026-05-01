# Capacitor iOS 빌드/배포 구체화 가이드 (저장소 자산 중심)

## 왜 수정했는가
- 기존 문서는 로컬(macOS/Xcode) 준비 절차 비중이 높아, **현재 저장소에 이미 있는 CI 자산을 활용하는 관점**이 약했다.
- 이 문서는 `./github/workflows` 및 현재 Android 자동화 패턴을 기준으로 iOS를 확장하는 계획으로 재정리한다.

## 저장소 기준 현재 상태(2026-05-01)
- Android 자동화는 이미 다수 워크플로우로 운영 중이며, 버전 동기화/시크릿 주입/릴리즈 빌드 패턴이 존재한다.
- iOS 전용 워크플로우(`ios-*.yml`)와 iOS 네이티브 프로젝트 디렉토리(`ios/`)는 아직 저장소에 없다.
- 따라서 1차 목표는 “로컬 개발 가이드”가 아니라, **저장소에 커밋 가능한 iOS CI 자산 정의**다.

---

## 1) 먼저 만들 저장소 자산(Artifacts)

### 1-1. 워크플로우 파일
1. `.github/workflows/ios-build.yml`  
   - PR/수동 트리거  
   - 서명 없이 시뮬레이터 빌드(회귀 확인)
2. `.github/workflows/ios-release.yml`  
   - 태그(`v*`) + 수동 트리거  
   - archive/export/TestFlight 업로드

### 1-2. 스크립트 파일
1. `scripts/ci/ios/setup-signing.sh`  
   - base64 디코딩, keychain 생성, 인증서 import, provisioning profile 배치
2. `scripts/ci/ios/set-build-number.sh`  
   - `CFBundleVersion` 자동 증가(run number 기반)

### 1-3. 설정 템플릿
1. `ios/exportOptions.plist.template`  
   - `method=app-store`, `teamID`, `signingStyle` 등
2. `docs/ongoing/IOS_SECRETS_CHECKLIST.md`  
   - 시크릿 이름/용도/갱신주기/소유자

---

## 2) 기존 저장소 자산 재사용 원칙

### 2-1. 워크플로우 패턴 재사용
- `.github/workflows/build.yml`의 공통 패턴 재사용
  - `actions/checkout`
  - `actions/setup-node`
  - `npm ci`
  - `npm run build`
  - `npx cap sync ...`
- `.github/workflows/release-aab.yml`의 릴리즈 운영 패턴 재사용
  - 수동 입력 + 태그 트리거 병행
  - 버전/체인지로그 동기화 관점 유지

### 2-2. 버전 관리 일원화
- 저장소 `VERSION` 파일을 단일 소스로 유지
- iOS `CFBundleShortVersionString`는 `VERSION`과 동기화
- iOS `CFBundleVersion`은 GitHub Actions run number 또는 별도 계산식 사용

---

## 3) ios-build.yml (PR 품질 게이트) 요구사항

## 트리거
- `pull_request` (main/develop 대상)
- `workflow_dispatch`

## 필수 단계
1. 체크아웃
2. Node 20 + `npm ci`
3. `npm run build`
4. `npx cap sync ios`
5. `pod install` (ios/App)
6. `xcodebuild` 시뮬레이터 빌드

## 실패 기준
- 위 1개라도 실패 시 PR 머지 불가(CI required check)

---

## 4) ios-release.yml (태그 릴리즈) 요구사항

## 트리거
- `push.tags: v*`
- `workflow_dispatch`

## 필수 단계
1. 체크아웃 + Node 세팅 + 웹 빌드
2. `npx cap sync ios`
3. signing setup 스크립트 실행
4. archive
5. export ipa
6. TestFlight 업로드
7. 아티팩트(ipa, xcarchive 로그) 업로드

## 보안 원칙
- 인증서/프로파일/p8 원문 파일은 저장소 커밋 금지
- GitHub Secrets(base64)로만 주입
- keychain은 job 종료 시 삭제

---

## 5) GitHub Secrets 표준(저장소 자산 기준)

### Required
- `IOS_P12_BASE64`
- `IOS_P12_PASSWORD`
- `IOS_PROFILE_BASE64`
- `KEYCHAIN_PASSWORD`
- `ASC_API_KEY_ID`
- `ASC_API_ISSUER_ID`
- `ASC_API_PRIVATE_KEY_BASE64`

### Optional
- `APPLE_TEAM_ID`
- `IOS_BUNDLE_ID`

> Android에서 이미 사용 중인 “base64 시크릿 복원” 패턴을 동일하게 적용한다.

---

## 6) 단계별 도입 로드맵 (저장소 반영 중심)

### Phase 1 — CI 스캐폴딩 커밋
- `ios-build.yml` 추가
- iOS 폴더 미존재 시 실패 메시지를 명확히 출력(가이드 링크 포함)
- 목적: 파이프라인 틀 먼저 고정

### Phase 2 — 네이티브 프로젝트 반영
- macOS에서 `npx cap add ios` 수행 후 `ios/` 커밋
- `ios-build.yml`을 실제 컴파일 가능 상태로 전환

### Phase 3 — 릴리즈 자동화
- `ios-release.yml` + signing 스크립트 + exportOptions 템플릿 커밋
- TestFlight 업로드까지 E2E 1회 검증

### Phase 4 — 운영 표준화
- 브랜치 보호 규칙에 iOS build check 추가
- 릴리즈 체크리스트/롤백 절차 문서 확정

---

## 7) Done 기준 (문서가 아닌 저장소 결과물 기준)
- `.github/workflows/ios-build.yml`이 main에 존재하고 PR에서 동작
- `.github/workflows/ios-release.yml`이 태그 기준으로 동작
- iOS 시크릿 체크리스트 문서가 저장소에 존재
- 신규 담당자가 “저장소 문서 + Actions 로그”만으로 TestFlight 업로드 재현 가능

---

## 8) 즉시 실행 액션(다음 PR)
1. `ios-build.yml` 초안 추가(PR check 전용)
2. `docs/ongoing/IOS_SECRETS_CHECKLIST.md` 추가
3. `CAPACITOR_WINDOWS_GITHUB_PLAN.md`의 iOS 섹션을 “저장소 자산 기반 단계”로 교체
