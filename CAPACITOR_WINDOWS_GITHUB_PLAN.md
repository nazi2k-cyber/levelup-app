# Capacitor + GitHub 기반 Windows 개발/배포 플랜

## 목적
- 현재 Capacitor 앱을 **Windows 개발 환경**에서 안정적으로 빌드/테스트/배포 가능한 형태로 정리한다.
- GitHub를 중심으로 브랜치, CI, 릴리즈 운영 체계를 표준화한다.

## 전제
- 앱 소스는 GitHub 저장소에서 관리한다.
- Windows 11 기준으로 작업한다.
- Android 배포(Play Console)와 iOS 배포(App Store)는 모두 고려하되, iOS 실빌드/서명은 macOS가 필요하다.

## 아키텍처 원칙
1. 웹 코드(`www` 혹은 프레임워크 빌드 산출물)와 네이티브 코드(Android/iOS)를 분리 관리한다.
2. 릴리즈 태그 기반 버전 관리(예: `v1.4.0`)를 사용한다.
3. CI는 “품질 게이트(테스트/린트)”와 “빌드 산출물 생성”을 우선 자동화한다.
4. 시크릿(키/토큰)은 GitHub Secrets로만 관리한다.

## 1단계: Windows 로컬 개발환경 표준화

### 1-1. 필수 설치
- Git
- Node.js LTS (권장: 20.x)
- npm 또는 pnpm (팀 표준 1개로 통일)
- Java JDK 17
- Android Studio + Android SDK + Platform Tools
- (선택) VS Code + 권장 확장

### 1-2. 프로젝트 부트스트랩
```bash
npm ci
npx cap sync
```

### 1-3. 실행/디버그
```bash
npm run build
npx cap run android
```

## 2단계: GitHub 브랜치 전략
- `main`: 운영 배포 기준 브랜치
- `develop`: 통합 개발 브랜치
- `feature/*`: 기능 개발
- `hotfix/*`: 긴급 수정

### PR 규칙
- 최소 1명 리뷰 승인
- CI 통과 필수
- 스쿼시 머지 권장
- PR 템플릿 사용(변경요약/테스트/리스크/롤백)

## 3단계: CI/CD (GitHub Actions)

### 3-1. CI 워크플로우 (PR 트리거)
- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- 실패 시 머지 차단

### 3-2. Android 빌드 워크플로우 (태그 트리거)
- 태그 푸시(`v*`) 시 Android release bundle(`.aab`) 생성
- 아티팩트 업로드
- (선택) Play Console 자동 업로드

### 3-3. iOS 관련 주의사항
- Windows에서 iOS 서명/아카이브는 불가
- GitHub Actions macOS runner 또는 외부 macOS CI 필요
- Windows에서는 웹코드/공통 로직 검증 중심으로 운영

## 4단계: 환경변수/시크릿 정책
- `.env`는 커밋 금지
- 환경별 파일 분리(`.env.dev`, `.env.prod`)
- GitHub Secrets 예시
  - `ANDROID_KEYSTORE_BASE64`
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
  - `ANDROID_KEY_PASSWORD`
  - `FIREBASE_SERVICE_ACCOUNT_JSON`

## 5단계: 릴리즈 운영
1. `develop` 안정화 후 `main` PR 생성
2. `main` 머지 후 버전 태그 발행 (`vX.Y.Z`)
3. GitHub Actions에서 빌드 아티팩트 생성
4. 스토어 제출 체크리스트 수행
   - 버전/빌드번호 확인
   - 권한 문구/개인정보 라벨 확인
   - 크래시/로그인/결제 플로우 점검

## 6단계: 2주 실행 로드맵

### Week 1
- Day 1: 개발환경 표준 문서화 + 온보딩 확인
- Day 2: 브랜치 전략/PR 템플릿 적용
- Day 3: CI(린트/테스트/빌드) 구축
- Day 4: Android debug/release 수동 빌드 검증
- Day 5: 이슈 보완 + 체크리스트 확정

### Week 2
- Day 1: 태그 기반 Android release 워크플로우 구축
- Day 2: 시크릿/서명키 운영 점검
- Day 3: 스테이징 릴리즈 리허설
- Day 4: 운영 릴리즈
- Day 5: 회고 및 자동화 개선 백로그 작성

## 리스크 및 대응
- iOS 실배포는 macOS 의존: macOS runner 예산/시간 사전 확보
- 키스토어 유실: 오프라인 백업 + 접근권한 최소화
- Capacitor/플러그인 버전 충돌: 월 1회 의존성 점검 창구 운영

## 완료 기준 (Definition of Done)
- Windows 신규 개발자가 1시간 내 로컬 실행 성공
- PR 생성 시 CI 자동 실행 및 품질 게이트 동작
- 태그 푸시 시 Android 아티팩트 자동 생성
- 릴리즈 체크리스트 기반으로 제출/롤백 절차 문서화 완료
