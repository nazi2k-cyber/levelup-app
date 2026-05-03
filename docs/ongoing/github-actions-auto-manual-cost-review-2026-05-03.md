# GitHub Actions 자동→수동 전환 비용효율성 평가 (Private 전환 이후)

작성일: 2026-05-03  
대상 저장소: `bravecat-studio/levelup-app`

## 1) 결론 요약

- **즉시 수동 전환 권장(비용 절감 효과 큼, 위험 낮음)**
  - `security-scan.yml`의 `push(main)` 트리거
  - `sync-landing-page.yml` 전체 브랜치 자동 트리거
  - `sync-terms.yml` 전체 브랜치 자동 트리거
- **자동 유지 권장(품질/안정성에 직접 영향)**
  - `pr-check.yml` (PR 게이트)
  - `deploy-firebase.yml` (main 배포 자동화)
  - `auto-version.yml` (main 버전 일관성)
- **조건부 전환(운영 방식에 따라 선택)**
  - `build.yml`(APK 자동 빌드): 릴리즈 직전 중심이면 수동화 가능
  - `release-aab.yml`의 `push(main)` 자동 릴리즈: 현재 릴리즈 빈도가 낮다면 수동만 유지 권장
  - `backup.yml` 스케줄: 주 1회→월 2회/월 1회로 다운 가능

---

## 2) 현재 워크플로우 분류 (트리거 기준)

### A. 이미 수동 중심(유지)
- `apply-branch-protection.yml` (`workflow_dispatch`)
- `create-subscription-test-account.yml` (`workflow_dispatch`)
- `deploy-rollback.yml` (`workflow_dispatch`)
- `ios-build.yml` (`workflow_dispatch`)
- `migrate-usernames.yml` (`workflow_dispatch`)

→ **추가 조치 불필요**.

### B. 자동 트리거 포함(비용 검토 대상)
- `auto-version.yml` (`push: main`)
- `backup.yml` (`schedule` 주 1회 + 수동)
- `build.yml` (`workflow_run + push(claude/**) + 수동`)
- `deploy-firebase.yml` (`push: main(특정 paths) + 수동`)
- `lighthouse.yml` (`pull_request: main`)
- `pr-check.yml` (`pull_request: main`)
- `release-aab.yml` (`push: main + 수동`)
- `security-scan.yml` (`schedule + push: main`)
- `sync-landing-page.yml` (`push: 모든 브랜치, 특정 파일`)
- `sync-terms.yml` (`push: 모든 브랜치, 특정 파일`)
- `zap-scan.yml` (`schedule 분기 1회 + 수동`)

---

## 3) 비용효율 관점 상세 평가

### 3-1. 우선 전환 1순위

#### (1) Security Scan (`security-scan.yml`)
- 현재 `schedule(주 1회)` + `push(main)` 모두 실행.
- `push(main)` 시 보안 스캔/감사/secret 검사가 중복 수행되어 **분당 과금 누적** 가능성이 큼.
- **권장안**: `push(main)` 제거, `schedule + workflow_dispatch`만 유지.
- 기대효과: 메인 병합 빈도가 높을수록 절감폭 큼.

#### (2) 랜딩/약관 동기화 (`sync-landing-page.yml`, `sync-terms.yml`)
- 현재 `branches: ['**']`로 모든 브랜치에서 트리거.
- 문서/페이지 편집이 잦은 경우, 사소한 변경에도 실행.
- **권장안**:
  - 기본은 수동(`workflow_dispatch`) 전환,
  - 또는 `main`/`release` 브랜치로 축소.
- 기대효과: 개발 브랜치 잡음 실행 크게 감소.

### 3-2. 운영정책 기반 조건부 전환

#### (3) Android APK 자동 빌드 (`build.yml`)
- Android 빌드는 설치/컴파일 단계가 길어 비용 기여도가 큼.
- **권장안**:
  - 내부 QA가 매 커밋 APK를 꼭 요구하지 않으면 자동을 줄이고 수동 중심 전환.
  - 대안: `workflow_run(auto-version)`만 유지하고 `push(claude/**)`는 제거.

#### (4) 릴리즈 AAB (`release-aab.yml`)
- 현재 `push(main)`에서도 실행 조건이 살아 있음(자동 릴리즈 흐름 포함).
- **권장안**: 스토어 제출 주기가 낮다면 `workflow_dispatch` 전용으로 단순화.
- 장점: 오배포/불필요 빌드 위험 + 비용 동시 감소.

#### (5) 백업 (`backup.yml`)
- 주 1회 스케줄은 안정적이나 저장소 규모가 커질수록 비용 증가 가능.
- **권장안**: 월 2회 또는 월 1회 + 릴리즈 전후 수동 실행.

### 3-3. 자동 유지 권장(절감보다 리스크가 큼)

#### (6) PR 게이트 (`pr-check.yml`, 필요시 `lighthouse.yml`)
- PR 품질/정책 위반을 조기 차단.
- 수동 전환 시 사람 의존이 증가하고 누락 리스크가 큼.
- **권장안**: 자동 유지. 대신 잡 시간 단축(캐시, 조건 분기)으로 최적화.

#### (7) 배포 자동화 (`deploy-firebase.yml`)
- main 반영 시 인프라 상태를 일관되게 맞춤.
- 수동 전환 시 배포 누락/지연 리스크 존재.
- **권장안**: 자동 유지(필요 시 paths 더 정교화).

#### (8) 버전 자동화 (`auto-version.yml`)
- 버전/체인지로그 일관성 핵심.
- 수동화 시 릴리즈 인적 실수 가능성 증가.
- **권장안**: 자동 유지.

---

## 4) 추천 전환 시나리오

## 시나리오 A (보수적 절감)
- 자동 유지: `pr-check`, `deploy-firebase`, `auto-version`, `lighthouse`
- 수동 전환: `security-scan`의 `push(main)` 제거, `sync-*` 2종 수동화
- 예상: 품질 영향 최소 + 즉시 비용 절감

## 시나리오 B (중간 절감)
- 시나리오 A + `build.yml` 자동 축소(`push claude/**` 제거)
- 예상: 빌드 시간 기반 비용 추가 절감

## 시나리오 C (공격적 절감)
- 시나리오 B + `release-aab` 자동(push main) 제거 + `backup` 빈도 축소
- 예상: 비용 최저, 대신 운영자 수동 오퍼레이션 증가

---

## 5) 최종 제안

현재 "Private 전환 후 비용효율성"이 최우선이면, **시나리오 B**가 현실적 균형점.

1. 즉시 적용
   - `security-scan`: `push(main)` 제거
   - `sync-landing-page`, `sync-terms`: 수동 또는 main 한정
2. 1~2주 관찰
   - Actions 사용시간/성공률/누락 이슈 체크
3. 추가 절감 판단
   - `build.yml` 자동 범위 축소
   - 릴리즈 빈도 낮으면 `release-aab` 자동 제거

이 접근이면 품질 게이트는 유지하면서, 빈도 높은 "비핵심 자동 실행"만 먼저 줄여서 비용 절감 효과를 빠르게 확인할 수 있음.
