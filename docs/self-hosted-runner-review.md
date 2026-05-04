# Self-hosted Runner 도입 방안 검토안

## 1. 배경
현재 저장소에는 Android 빌드 및 Firebase 운영 관련 스크립트/설정이 포함되어 있어, CI 실행 환경의 일관성과 캐시 최적화가 중요합니다.

- Android 관련 스크립트
  - `setup:android`, `build-apk`, `build-bundle`
- Firebase 관련 작업
  - Firestore Rules 테스트, Hosting/Functions 운영

이 특성상 Self-hosted Runner는 빌드 속도와 재현성, 배포 권한 분리 측면에서 도입 가치가 있습니다.

---

## 2. 현황 요약

### 2.1 파이프라인 성격
- `npm run setup:android`: Android 프로젝트 생성/동기화 및 Gradle 설정 패치
- `npm run build-apk`, `npm run build-bundle`: Android 산출물 생성
- `npm run test:rules`: Firebase Emulator 기반 Firestore 보안 규칙 테스트

### 2.2 운영 특성
- Android SDK/JDK/Gradle 환경 고정 필요
- 빌드 캐시(`~/.gradle`, npm cache) 활용 시 성능 개선 여지 큼
- 배포 권한(예: Firebase, Android 서명키) 분리 필요

---

## 3. 도입 목표
1. Android 릴리즈 빌드 시간 단축
2. 릴리즈 빌드 환경 재현성 강화
3. 배포 시크릿 및 권한의 노출 범위 최소화
4. CI 실패 원인의 환경 의존성 감소

---

## 4. 권장 도입 전략 (단계적)

### Phase 1 (권장): 하이브리드 운영
- **GitHub-hosted 유지**: PR 검증(테스트/정적 검증)
- **Self-hosted 전환**: Android 릴리즈 빌드, 배포 Job

장점:
- 운영 부담을 최소화하면서 핵심 병목 구간만 최적화
- 보안 민감 작업(배포/서명)을 전용 러너로 격리

### Phase 2: 최적화 확장
- 릴리즈 파이프라인 전체 Self-hosted 이전 검토
- Runner 역할 분리(빌드 전용 / 배포 전용)
- 필요 시 에페메럴(일회성) Runner 도입

---

## 5. 권장 아키텍처

### 5.1 Runner 라벨 예시
- `self-hosted`, `linux`, `android`, `deploy`

### 5.2 노드 스펙 권장
- OS: Ubuntu LTS
- Java: JDK 17
- Node.js: 20.x
- Android SDK: compile/target SDK 35 대응

### 5.3 캐시 전략
- Gradle cache: `~/.gradle`
- npm cache: `~/.npm` (또는 npm 기본 cache)
- Android SDK는 러너에 사전 설치하여 재사용

---

## 6. 보안 설계 원칙

1. **실행 범위 제한**
   - 신뢰 브랜치(`main`, `release/*`) 중심으로 Self-hosted Job 허용
   - 외부 포크 PR에서 Self-hosted 실행 금지

2. **시크릿 최소권한**
   - Firebase 배포 인증정보는 deploy job에만 주입
   - Android 서명키는 별도 보호 스토리지/환경변수로 분리

3. **워크스페이스 격리**
   - Job 종료 후 작업 디렉토리 정리
   - 가능하면 에페메럴 러너 사용(1 Job = 1 러너)

4. **네트워크 최소허용**
   - 필수 도메인(GitHub, npm, Google APIs 등)만 허용

5. **감사/추적성 확보**
   - 릴리즈/배포 Job 로그 보관 정책 운영
   - 누가/언제 배포했는지 추적 가능한 태깅 규칙 적용

---

## 7. 워크플로우 분리안 (예시)

### 7.1 `ci-lite` (GitHub-hosted)
- 목적: 빠른 PR 품질 검증
- 작업:
  1. `npm ci`
  2. `npm run test:rules`

### 7.2 `android-release` (Self-hosted, `linux` + `android`)
- 목적: APK/AAB 릴리즈 빌드
- 작업:
  1. `npm ci`
  2. `npm run setup:android`
  3. `npm run build-bundle`

### 7.3 `deploy-firebase` (Self-hosted, `linux` + `deploy`)
- 목적: Hosting/Functions 배포
- 작업:
  1. `npm ci`
  2. 배포 커맨드 실행(브랜치/태그 조건)

---

## 8. 기대효과 및 리스크

### 기대효과
- Android 빌드 시간 단축(환경 준비 비용 감소)
- 릴리즈 품질 안정성 향상(환경 고정)
- 배포 보안 통제 강화(전용 노드/권한 분리)

### 리스크
- 러너 인프라 운영 부담 증가
- 패치 누락 시 보안 취약점 확대 가능
- 러너 오염(이전 Job 잔존 파일) 리스크

### 대응
- 운영 책임 범위 명확화(SRE/개발)
- 월간 패치/점검 루틴
- 주기적 러너 재프로비저닝

---

## 9. 도입 의사결정 체크리스트
- [ ] Android 릴리즈 빌드 시간이 팀 임계치(예: 15분)를 초과하는가?
- [ ] 배포 시크릿 분리 필요성이 높은가?
- [ ] 러너 운영 담당자/온콜 체계가 있는가?
- [ ] 브랜치 보호/승인 프로세스가 정착되어 있는가?
- [ ] 에페메럴 러너 또는 정리 스크립트를 적용 가능한가?

---

## 10. 결론 (권고)
**단기적으로는 하이브리드(검증=GitHub-hosted, 릴리즈/배포=Self-hosted)를 권장**합니다.

이 방식은 성능/보안 이점을 빠르게 확보하면서도 운영 리스크를 제어할 수 있습니다.
Phase 1 운영 데이터를 기반으로, 이후 Phase 2(범위 확대)를 판단하는 것이 가장 안전합니다.
