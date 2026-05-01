# CAPACITOR_WINDOWS_GITHUB_PLAN.md 구현 시 보안·비용 이슈 분석

> 작성일: 2026-05-01  
> 참조 문서: `CAPACITOR_WINDOWS_GITHUB_PLAN.md`  
> 현재 상황: Play Store **공개 테스트 준비 중** / Firebase 무료 체험 만료 D-43 (2026-06-13)

---

## 분석 범위 및 전제

| 항목 | 상태 |
|------|------|
| Play Store | 공개 테스트(Open Testing) 준비 중 |
| 레포 가시성 | Public → Private 전환 검토 중 |
| Firebase 요금제 | 무료 체험 크레딧 ₩428,305 / 만료 2026-06-13 |
| 앱 패키지 | `com.levelup.reboot` |
| Android 빌드 러너 | `ubuntu-22.04` |
| 배포 방식 | AAB 수동 제출 (Play Console) |

---

## 1. 보안 이슈

### A. 키스토어 / 앱 서명 — 최우선 위험

**Play Store에서 한 번 사용한 서명 키는 교체 불가.**  
분실 또는 탈취 시 앱을 삭제하고 새 패키지명으로 재등록해야 하며, 기존 사용자 전원 재설치가 필요합니다.

**현재 상태:**

| 항목 | 상태 | 위험 |
|------|------|------|
| 릴리즈 키스토어 | `RELEASE_KEYSTORE_BASE64` (GitHub Secrets) | Secret 탈취 시 위변조 APK 서명 가능 |
| 오프라인 백업 | PLAN.md에 정책만 언급, 절차 미문서화 | 백업 유실 = 앱 종료 |
| Google Play App Signing | 적용 여부 미확인 | 미적용 시 업로드 키 분실 = 복구 불가 |

**Google Play App Signing 권장:**  
Google이 최종 서명 키를 보관하고, 업로드 시에는 별도의 업로드 키만 사용합니다.  
업로드 키는 분실해도 Google 고객센터를 통해 교체 가능하므로 앱 연속성이 보장됩니다.

```
현재 (미적용 추정):
  개발자 → 릴리즈 키 서명 → AAB → Play Console → 사용자
                ↑ 분실 시 복구 불가

Google Play App Signing 적용 후:
  개발자 → 업로드 키 서명 → AAB → Google(서명 키 재서명) → 사용자
                ↑ 분실해도 Google 통해 교체 가능
```

---

### B. PLAN.md 시크릿 이름 vs 실제 워크플로우 불일치

PLAN.md에 정의된 시크릿 이름과 실제 워크플로우에서 사용하는 이름이 다릅니다.  
그대로 구현하면 시크릿 등록 오류 또는 빌드 실패가 발생합니다.

| PLAN.md 정의 | 실제 워크플로우 | 적용 파일 |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | `RELEASE_KEYSTORE_BASE64` | `release-aab.yml` |
| `ANDROID_KEYSTORE_PASSWORD` | `RELEASE_KEYSTORE_PASSWORD` | `release-aab.yml` |
| `ANDROID_KEY_ALIAS` | `RELEASE_KEY_ALIAS` | `release-aab.yml` |
| `ANDROID_KEY_PASSWORD` | `RELEASE_KEY_PASSWORD` | `release-aab.yml` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `FIREBASE_SERVICE_ACCOUNT` | `deploy-firebase.yml` |

**조치**: PLAN.md의 시크릿 이름을 실제 워크플로우 기준으로 통일하거나, 반대로 워크플로우를 PLAN.md 이름으로 일괄 변경.

---

### C. GitHub Actions 공급망 보안

**gitleaks-action 메이저 버전만 고정 (위험):**

```yaml
# security-scan.yml — 현재
- uses: gitleaks/gitleaks-action@v2   ← v2.x.x 어떤 버전도 실행 가능
```

악의적인 마이너 업데이트가 배포될 경우 자동으로 실행됩니다.

```yaml
# 권장: 마이너+패치까지 고정
- uses: gitleaks/gitleaks-action@v2.3.4
```

**Action 버전 혼재 (`pr-check.yml`):**

| Action | 사용 버전 | 권장 |
|--------|----------|------|
| `actions/setup-node` | v4, v5 혼재 | v5 통일 |
| `actions/setup-java` | v4, v5 혼재 | v5 통일 |
| `actions/checkout` | v4, v5 혼재 | v5 통일 |

---

### D. npm audit 정책 불완전

```yaml
# security-scan.yml — 현재
- name: Audit frontend dependencies
  run: npm audit --audit-level=high
  continue-on-error: true   ← ⚠️ High 취약점 발견돼도 워크플로우 성공 처리
```

Play Store 공개 테스트 전 `continue-on-error: true` 제거 또는 별도 이슈 자동 생성으로 변경을 권장합니다.

---

### E. 디버그 키스토어 비밀번호 하드코딩

`build.yml`이 생성하는 Gradle 설정에 디버그 키스토어 비밀번호가 평문으로 포함됩니다.

```groovy
// build.yml이 android/ 디렉토리에 주입하는 내용
signingConfigs {
    debug {
        storePassword "android"      ← 하드코딩
        keyAlias "androiddebugkey"   ← 하드코딩
        keyPassword "android"        ← 하드코딩
    }
}
```

Public 레포 기간 중 이 설정이 노출되면 디버그 빌드를 위변조한 APK를 동일한 키로 서명할 수 있습니다.  
실 서비스 영향은 낮지만, 내부 테스트 배포 경로를 오염시킬 수 있습니다.

---

### F. Firebase 서비스 계정 광범위 권한

`FIREBASE_SERVICE_ACCOUNT` JSON 하나로 다음을 모두 수행합니다:

- Cloud Functions 배포
- IAM 바인딩 (`roles/run.invoker`, `roles/iam.serviceAccountTokenCreator` 등)
- Firestore 배포
- Firebase Hosting 배포

탈취 시 전체 GCP 프로젝트에 대한 광범위한 접근이 가능합니다.

**권장**: 배포용 서비스 계정(CI 전용, 배포 권한만)과 런타임용 서비스 계정(Functions 실행용) 분리.

---

### G. 외부 API 키 집중 위험

`deploy-firebase.yml`에서 7개 외부 서비스 키를 GitHub Secrets에서 읽어 Functions `.env`에 주입합니다:

```
AZURE_CS_KEY, ALADIN_TTB_KEY, KAKAO_REST_API_KEY,
KOBIS_API_KEY, KMDB_API_KEY, ADMIN_EMAILS, ADMIN_MASTER_EMAIL
```

GitHub Secrets에 접근 가능한 계정이 탈취되면 7개 외부 서비스가 동시에 노출됩니다.  
Environment Secrets(production 환경 보호 규칙 적용)로 전환하면 접근 범위를 제한할 수 있습니다.

---

## 2. 비용 이슈

### A. Firebase 무료 체험 만료 — D-43 (2026-06-13) ⚠️ 긴급

**만료 후 Spark 플랜 자동 전환 시 Cloud Functions 전면 비활성화.**

영향받는 기능:

| 함수 | 역할 | 중단 시 영향 |
|------|------|-------------|
| `sendRaidAlert` (3회/일) | 레이드 푸시 알림 | 주요 참여 유도 채널 소멸 |
| `sendDailyReminder` | 일일 리마인더 | 재방문 유도 중단 |
| `sendStreakWarnings` (×4 샤드) | 스트릭 경고 푸시 | 스트릭 이탈 급증 |
| `sendComebackPush` (×4 샤드) | 복귀 유저 유도 | 유저 이탈 가속 |
| `cleanupExpiredReelsPhotos` | 24h 릴스 사진 자동 삭제 | 스토리지 무제한 누적 |
| `generateThumbnail` | 이미지 썸네일 생성 | 이미지 로딩 성능 저하 |
| `syncClaims` | 로그인 시 권한 동기화 | 관리자 기능 접근 불가 |

**DAU 예상 감소: 50%+** (푸시 알림 전면 중단 기준)

**조치**: 공개 테스트 출시 전 **Blaze 플랜 전환 필수.**

---

### B. 규모별 월간 Firebase 비용 예측

CDN 캐싱 적용 기준 (이미지 썸네일 240px WebP + Service Worker Cache):

| MAU | Firestore | Storage CDN | Functions | 월 합계 |
|-----|-----------|-------------|-----------|---------|
| 1,000 | $0 | $0 | $0 | **$0** (무료 한도 내) |
| 10,000 | $1.80 | $14.40 | $5 | **~$21** (₩27K) |
| 50,000 | $12.60 | $34.00 | $20 | **~$67** (₩87K) |
| 100,000 | $26.10 | $68.00 | $40 | **~$134** (₩174K) |

> CDN 미적용 시 Storage 비용 약 5배 증가. 이미지 썸네일(`generateThumbnail`) 함수가 핵심 비용 절감 역할.

---

### C. GitHub Actions 분 — Public→Private 전환 충격

CAPACITOR_WINDOWS_GITHUB_PLAN.md 구현 후 예상 월 사용량:

| 워크플로우 | 소요 시간 | 빈도 | 월 사용량 |
|-----------|----------|------|----------|
| `release-aab.yml` (릴리즈 AAB) | ~35분 | 월 2~4회 | 70~140분 |
| `build.yml` (디버그 APK) | ~22분 | 월 20~40회 | 440~880분 |
| `pr-check.yml` (4개 잡) | ~40분/PR | 월 5회 PR | 200분 |
| `security-scan.yml` | ~25분 | 주 1회 | 100분 |
| `deploy-firebase.yml` | ~8분 | 월 10회 | 80분 |
| `backup.yml` | ~10분 | 주 1회 | 40분 |
| `auto-version.yml` | ~3분 | 월 20회 | 60분 |
| **합계** | | | **990~1,500분/월** |

- **Public 레포 (현재)**: 무제한 무료 → 문제 없음
- **Private 전환 후 Free 플랜**: 2,000분/월 → **여유 500~1,010분**
- **릴리즈 집중 기간 또는 PR 빈도 증가 시**: 초과 위험 (`$0.008/분`)

---

### D. iOS 빌드 추가 시 macOS Runner 비용

PLAN.md 3-3항에 명시: iOS 실빌드/서명은 macOS runner 필요.

| 구분 | Runner | 분당 가격 | 예상 비용/월 |
|------|--------|----------|------------|
| Android AAB | `ubuntu-22.04` | $0.008 | $0.56~$1.12 |
| iOS Archive | `macos-14` | $0.08 (10배) | $9.6~$12.8 |

iOS 빌드를 CI에 추가하는 시점에 월 $10 내외 비용이 발생합니다.  
Free 플랜의 macOS 무료 한도는 월 1,000분이므로 iOS 빌드만으로는 무료 범위 내이나,  
ubuntu와 함께 관리해야 합니다.

---

### E. Azure Content Safety 비용

이미지 스크리닝 2단계 (NSFWJS 로컬 + Azure CS 원격):

| MAU | 일일 이미지 업로드 추정 | 월 Azure CS 트랜잭션 | 비용 |
|-----|----------------------|---------------------|------|
| 1K | ~10건 | 300건 | **$0.30** |
| 10K | ~100건 | 3,000건 | **$3** |
| 50K | ~500건 | 15,000건 | **$15** |

> 현재 Firebase 무료 크레딧으로 커버 중. Blaze 전환 후 별도 GCP 결제 수단 필요.

---

## 3. 플레이스토어 공개 테스트 체크리스트

공개 테스트 출시 전 반드시 완료해야 하는 항목:

| 우선순위 | 항목 | 이유 | 담당 |
|---------|------|------|------|
| 🔴 **즉시** | Firebase **Blaze 플랜 전환** | 2026-06-13 전 필수, 만료 시 Functions 중단 | Firebase 콘솔 |
| 🔴 **즉시** | **Google Play App Signing** 활성화 확인 | 키스토어 분실 대응 체계 | Play Console |
| 🔴 **즉시** | 릴리즈 키스토어 **오프라인 암호화 백업** 절차 실행 및 문서화 | 단일 실패점 제거 | 팀 내부 |
| 🔴 **즉시** | PLAN.md 시크릿 이름 → 실제 워크플로우 기준 **통일** | 구현 혼선 방지 | `CAPACITOR_WINDOWS_GITHUB_PLAN.md` |
| 🟡 **출시 전** | `npm audit continue-on-error: true` **제거** | 취약점 누적 방지 | `security-scan.yml` |
| 🟡 **출시 전** | `gitleaks-action` 버전 마이너까지 고정 | 공급망 공격 방어 | `security-scan.yml` |
| 🟡 **출시 전** | Action 버전 혼재(`setup-node`, `setup-java`) v5 통일 | 예측 가능한 빌드 환경 | `pr-check.yml` |
| 🟢 **안정화 후** | Firebase SA 권한 분리 (배포용 vs 런타임용) | 탈취 피해 최소화 | GCP IAM |
| 🟢 **안정화 후** | GitHub Environment Secrets 전환 (production 보호 규칙) | 외부 API 키 접근 제한 | GitHub Settings |
| 🟢 **Private 전환 시** | GitHub Actions 분 예산 계획 (월 2,000분 기준) | 초과 비용 방지 | 팀 운영 |

---

## 4. CAPACITOR_WINDOWS_GITHUB_PLAN.md 단계별 보안·비용 영향

| 단계 | 내용 | 보안 영향 | 비용 영향 |
|------|------|----------|----------|
| **1단계**: 로컬 개발환경 | Windows 11 + JDK 17 + Android Studio | 낮음 | 없음 |
| **2단계**: 브랜치 전략 | main/develop/feature/hotfix + PR 규칙 | 낮음 (apply-branch-protection.yml 이미 적용) | 없음 |
| **3-1단계**: CI (린트/테스트/빌드) | ubuntu-22.04 PR 트리거 | 낮음 | PR당 ~40분 소모 |
| **3-2단계**: Android 릴리즈 워크플로우 | 태그 트리거 AAB 빌드 | **높음** (키스토어 Secret 필수) | 릴리즈당 ~35분 |
| **3-3단계**: iOS 관련 | macOS runner 필요 | 중간 (별도 인증서 관리) | **$0.08/분 (10배)** |
| **4단계**: 시크릿 정책 | PLAN.md 이름 ≠ 실제 워크플로우 | **높음** (이름 불일치 위험) | 없음 |
| **5단계**: 릴리즈 운영 | 스토어 제출 체크리스트 | 중간 (SHA-1 Firebase 등록 절차) | Play Console 제출 시간 |
| **6단계**: 2주 로드맵 | Day 3: CI 구축 | 낮음 | 빌드 분 누적 시작 |
