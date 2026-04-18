# 보안강화 방안 검토 보고서

> **대상 앱:** LEVEL UP: REBOOT (Firebase + Capacitor 기반 모바일/웹 앱)  
> **기준일:** 2026-04-18  
> **원칙:** app.js 코드 추가 최소화 / 무료 또는 비용 최소화

---

## 목차

1. [현황 요약](#1-현황-요약)
2. [해킹 취약점 검토](#2-해킹-취약점-검토)
3. [방어 로직 도입 검토](#3-방어-로직-도입-검토)
4. [보안 진단 도구 및 자동 스케줄러](#4-보안-진단-도구-및-자동-스케줄러)
5. [무료·최소비용 방안 정리](#5-무료최소비용-방안-정리)
6. [우선순위 로드맵](#6-우선순위-로드맵)

---

## 1. 현황 요약

### 이미 구현된 보안 요소

| 영역 | 현황 |
|------|------|
| 인증 | Firebase Auth (이메일+Google OAuth), 이메일 인증 강제 |
| 권한 | Custom Claims (admin / adminOperator / master) + 이메일 Fallback |
| DB 규칙 | Firestore Rules — 필드 단위 타입 검증, 포인트·레벨 델타 제한, 5초 빈도 제한 |
| 스토리지 | Storage Rules — self-only 업로드, 파일 크기 제한, MIME 허용리스트 (jpeg/png/webp/gif/heic/heif) |
| 콘텐츠 | NSFWJS(로컬 ML) + Azure Content Safety 2단계 이미지 검수 |
| 오류 추적 | `app_error_logs` 컬렉션 (클라이언트 오류 수집) |
| 백업 | 유저 데이터 수정 전 자동 백업 (`user_backups`) |
| 알림 감사 | `push_logs` / `push_feedback` 컬렉션 |

### 핵심 취약 지점 (사전 식별)

- CSP에 `unsafe-inline` / `unsafe-eval` 사용 → XSS 노출 가능성
- 클라이언트 사이드 게임 상태 직접 Firestore 저장 → 데이터 조작 위험
- Rate Limiting이 Firebase 기본 수준에만 의존 → Brute-force 가능
- Admin 권한 이메일 목록이 환경변수에만 관리 → 운영 실수 위험
- 소셜 기능(reels, 댓글)의 텍스트 콘텐츠 필터링 부재

---

## 2. 해킹 취약점 검토

### 2-1. XSS (Cross-Site Scripting)

| 항목 | 내용 |
|------|------|
| **위치** | `app.html` CSP 헤더 / `app.js` 동적 DOM 조작 |
| **문제** | `unsafe-inline`, `unsafe-eval` 허용으로 인라인 스크립트 실행 가능 |
| **공격 시나리오** | 소셜 기능(reels/댓글)에 악성 스크립트 삽입 → 타 유저 세션 탈취 |
| **위험도** | ⚠️ 중~고 |

```
현재 CSP:
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.gstatic.com ...

목표 CSP (점진적 적용):
script-src 'self' 'nonce-{random}' https://*.gstatic.com ...
```

### 2-2. 게임 데이터 조작 (Client-Side Trust)

| 항목 | 내용 |
|------|------|
| **위치** | `app.js` → Firestore `users/{userId}` 직접 쓰기 |
| **문제** | 포인트·레벨·퀘스트 완료 등 게임 상태를 클라이언트에서 계산 후 저장 |
| **공격 시나리오** | Firestore SDK 직접 호출로 임의 points/level 값 주입 |
| **위험도** | ⚠️ 고 (랭킹 시스템 신뢰성 훼손) |

```
취약한 흐름:
클라이언트 계산 → setDoc(userRef, { points: 999999 }) → Firestore

안전한 흐름:
클라이언트 이벤트 → Cloud Function 검증 → 서버 계산 → Firestore
```

**Firestore Rules 현황 — 부분 보호만 존재:**
```javascript
// 현재: 타입 검증만 수행 (범위 검증 없음)
isValidUserFieldsPart1() → string/number/boolean 타입만 확인
// 필요: 값 범위 + 증감량 검증 (Cloud Function으로 이전 권장)
```

### 2-3. Rate Limiting / Brute-force

| 항목 | 내용 |
|------|------|
| **위치** | Firebase Auth 로그인 / Cloud Functions 호출부 |
| **문제** | Firebase Auth는 기본 보호가 있으나, 커스텀 함수 호출에는 Rate Limit 없음 |
| **공격 시나리오** | `sendTestNotification`, `handleAdminListUsers` 등 반복 호출 |
| **위험도** | ⚠️ 중 |

### 2-4. 텍스트 콘텐츠 인젝션

| 항목 | 내용 |
|------|------|
| **위치** | `reels_reactions` / `post_reports` 컬렉션 |
| **문제** | 이미지는 2단계 검수이나, 텍스트(댓글·이름)는 필터링 없음 |
| **공격 시나리오** | 혐오 표현, 스팸, 피싱 URL 삽입 |
| **위험도** | ⚠️ 중 |

### 2-5. Dependency 취약점

| 항목 | 내용 |
|------|------|
| **위치** | `functions/package.json`, `package.json` |
| **문제** | `@tensorflow/tfjs ^4.22.0`, `nsfwjs ^4.1.0` 등 고정되지 않은 버전 |
| **공격 시나리오** | 악성 패키지 업데이트(공급망 공격) |
| **위험도** | ⚠️ 중 |

### 2-6. 환경변수 및 시크릿 관리

| 항목 | 내용 |
|------|------|
| **위치** | `functions/.env` (gitignore 처리됨) |
| **문제** | `ADMIN_EMAILS`, `AZURE_CS_KEY` 등 평문 저장, 로테이션 정책 없음 |
| **공격 시나리오** | 배포 파이프라인 침해 시 시크릿 노출 |
| **위험도** | ⚠️ 중 |

### 2-7. Service Worker 캐시 포이즈닝

| 항목 | 내용 |
|------|------|
| **위치** | `www/sw.js` |
| **문제** | CDN 리소스를 Cache-First로 저장 — CDN 침해 시 악성 코드 캐시 가능 |
| **공격 시나리오** | Firebase SDK CDN 변조 → 앱 전체 감염 |
| **위험도** | ⚠️ 낮~중 (Firebase CDN 신뢰도 높으나 SRI 미적용) |

---

## 3. 방어 로직 도입 검토

> **원칙:** app.js 변경 최소화 → Firestore Rules / Cloud Functions / firebase.json 중심으로 방어

### 3-1. Firestore Rules 강화 (app.js 변경 없음)

#### A. 게임 수치 범위 제한

```javascript
// firestore.rules 추가 예시
function isValidPointsDelta(existing, incoming) {
  // 1회 업데이트 시 증가량 10,000 포인트 이하만 허용
  return incoming.points - existing.points <= 10000
    && incoming.level - existing.level <= 1;
}
```

#### B. 업데이트 빈도 제한 (타임스탬프 기반)

```javascript
// users 문서에 lastUpdatedAt 필드 추가 후 Rules에서 검증
function notTooFrequent(existing) {
  return request.time > existing.data.lastUpdatedAt + duration.value(5, 's');
}
```

#### C. 쓰기 가능 필드 명시적 허용리스트

```javascript
// 허용된 필드만 업데이트 가능하도록 제한
function onlyAllowedFields() {
  let allowed = ['points', 'level', 'stats', 'streak', ...];
  return request.resource.data.diff(resource.data).affectedKeys()
    .hasOnly(allowed);
}
```

### 3-2. Cloud Functions Rate Limiting (app.js 변경 없음)

#### 방법 A: Firestore 기반 Rate Limiter (무료)

```javascript
// functions/rateLimiter.js (신규 파일)
async function checkRateLimit(uid, action, maxCalls, windowSeconds) {
  const ref = db.collection('rate_limits').doc(`${uid}_${action}`);
  // 트랜잭션으로 호출 횟수 카운트 → 초과 시 429 반환
}
```

#### 방법 B: Firebase App Check 적용 (무료)

- Firebase Console → App Check → reCAPTCHA v3 (웹) / Play Integrity (Android) 활성화
- `functions/index.js`에 `app.check().runWith({ enforceAppCheck: true })` 추가
- **app.js 변경:** App Check SDK 초기화 1줄만 추가

```javascript
// app.js 최소 추가 (1줄)
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
initializeAppCheck(app, { provider: new ReCaptchaV3Provider(SITE_KEY) });
```

### 3-3. 텍스트 콘텐츠 필터링 (Cloud Function 추가)

#### 방법 A: 금칙어 사전 방식 (무료)

```javascript
// functions/textFilter.js (신규 파일)
const BLOCKED_PATTERNS = [/* 금칙어 목록 */];
function filterText(text) {
  return BLOCKED_PATTERNS.some(p => text.includes(p));
}
// Firestore Trigger로 reels_reactions 생성 시 자동 검수
```

#### 방법 B: Google Perspective API (무료 쿼터: 1 QPS)

```
엔드포인트: https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze
독성 점수 0~1 반환 → 0.7 이상 자동 숨김 처리
```

### 3-4. CSP 강화 (firebase.json 수정, app.js 변경 없음)

```json
// firebase.json headers 추가
{
  "headers": [{
    "source": "**",
    "headers": [{
      "key": "Content-Security-Policy",
      "value": "default-src 'self'; script-src 'self' 'nonce-{NONCE}' https://*.googleapis.com; object-src 'none'; base-uri 'self';"
    }, {
      "key": "X-Frame-Options",
      "value": "DENY"
    }, {
      "key": "X-Content-Type-Options", 
      "value": "nosniff"
    }, {
      "key": "Referrer-Policy",
      "value": "strict-origin-when-cross-origin"
    }, {
      "key": "Permissions-Policy",
      "value": "geolocation=(self), camera=(), microphone=()"
    }]
  }]
}
```

### 3-5. SRI (Subresource Integrity) 적용 (app.html 수정)

```html
<!-- 현재 -->
<script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js"></script>

<!-- SRI 적용 후 -->
<script 
  src="https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js"
  integrity="sha384-{hash}"
  crossorigin="anonymous">
</script>
```

### 3-6. 시크릿 관리 강화 (인프라 변경)

| 현재 | 개선 |
|------|------|
| `functions/.env` 평문 | Firebase Secret Manager 또는 GCP Secret Manager 사용 |
| 로테이션 없음 | 90일 주기 Azure API Key 로테이션 스케줄 설정 |
| 단일 Admin 목록 | Firestore `admin_config` 컬렉션으로 이전 (마스터만 수정 가능) |

---

## 4. 보안 진단 도구 및 자동 스케줄러

> **원칙:** Firebase 무료 티어 + GCP 무료 쿼터 최대 활용

### 4-1. 보안 진단 Cloud Functions 구성

#### A. 의심 활동 탐지 스케줄러 (무료)

```
Firebase Cloud Functions pubsub 스케줄러 (cron)
→ 무료 티어: 월 2,000,000 호출 / 400,000 GB-초
```

```javascript
// functions/securityScheduler.js (신규 파일)

// ① 매일 02:00 — 포인트 이상 증가 탐지
exports.detectAnomalousPoints = functions.pubsub
  .schedule('0 2 * * *').timeZone('Asia/Seoul')
  .onRun(async () => {
    // 24시간 내 포인트 증가량 상위 0.1% 유저 플래그
    // 결과를 security_alerts 컬렉션에 저장
  });

// ② 매시간 — 다중 로그인 실패 탐지
exports.detectBruteForce = functions.pubsub
  .schedule('0 * * * *')
  .onRun(async () => {
    // Firebase Auth의 사용자별 로그인 실패 패턴 분석
    // app_error_logs에서 auth/* 오류 집계
  });

// ③ 매주 월요일 — 휴면 어드민 계정 감사
exports.auditAdminAccounts = functions.pubsub
  .schedule('0 9 * * 1').timeZone('Asia/Seoul')
  .onRun(async () => {
    // 90일 이상 미접속 admin Custom Claim 보유자 목록 생성
    // security_alerts에 저장 후 마스터에게 알림
  });
```

#### B. 실시간 이상 탐지 Firestore Trigger (무료)

```javascript
// functions/securityTriggers.js (신규 파일)

// ① 포인트 급증 감지 — users 문서 업데이트 시
exports.onUserUpdate = functions.firestore
  .document('users/{userId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const delta = (after.points || 0) - (before.points || 0);
    
    if (delta > 50000) { // 임계값 설정
      await db.collection('security_alerts').add({
        type: 'points_spike',
        userId: context.params.userId,
        delta,
        detectedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

// ② 신규 어드민 클레임 부여 감사
exports.onAdminClaimSet = functions.firestore
  .document('admin_audit_log/{logId}')
  .onCreate(async (snap) => {
    // 슬랙 웹훅 또는 이메일로 마스터 알림
  });
```

#### C. 보안 대시보드 Cloud Function (무료)

```javascript
// functions/securityDashboard.js (신규 파일)
exports.getSecurityReport = functions.https.onCall(async (data, context) => {
  await assertMaster(context);
  
  return {
    // 최근 24시간 통계
    loginFailures: await countRecentErrors('auth/'),
    pointAnomalies: await getSecurityAlerts('points_spike', 24),
    contentFlags: await getScreeningResults('flagged', 24),
    newAdminGrants: await getAdminAuditLog(24),
    
    // 시스템 상태
    activeUsers24h: await countActiveUsers(24),
    storageUsage: await getStorageStats(),
    functionErrors: await getFunctionErrorRate()
  };
});
```

### 4-2. 의존성 취약점 자동 스캔 (무료)

#### 방법 A: GitHub Actions (무료 — 공개/비공개 저장소 무료 쿼터 있음)

```yaml
# .github/workflows/security-scan.yml (신규 파일)
name: Security Scan

on:
  schedule:
    - cron: '0 3 * * 1'  # 매주 월요일 03:00
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # npm audit — 무료
      - name: Audit frontend dependencies
        run: npm audit --audit-level=high
        working-directory: ./www
        
      - name: Audit functions dependencies
        run: npm audit --audit-level=high
        working-directory: ./functions

      # Firestore Rules 정적 분석 — 무료
      - name: Validate Firestore Rules
        uses: firebase-tools-action@v1
        with:
          args: firestore:rules

  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # gitleaks — 오픈소스, 무료
      - name: Scan for secrets
        uses: gitleaks/gitleaks-action@v2
```

#### 방법 B: Firebase App Distribution + Crashlytics (무료)

- Android/iOS 빌드 시 자동 취약점 리포트
- 크래시 로그와 보안 오류 통합 모니터링

### 4-3. Firestore Rules 자동 테스트 (무료)

```javascript
// test/firestore-rules.test.js (신규 파일)
// firebase-rules-unit-testing 패키지 사용 (무료 로컬 에뮬레이터)

describe('Security Rules', () => {
  it('일반 유저는 타인 데이터 수정 불가', async () => {
    const db = getFirestore({ uid: 'user-A' });
    await assertFails(
      db.collection('users').doc('user-B').update({ points: 9999 })
    );
  });
  
  it('포인트 10,000 초과 1회 증가 불가', async () => {
    // 범위 제한 Rules 추가 후 테스트
  });
  
  it('Admin이 아닌 유저는 app_config 읽기 불가', async () => {
    const db = getFirestore({ uid: 'normal-user' });
    await assertFails(db.collection('app_config').get());
  });
});
```

```json
// package.json scripts 추가
{
  "scripts": {
    "test:rules": "firebase emulators:exec 'jest test/firestore-rules.test.js'",
    "test:security": "npm run test:rules && npm audit"
  }
}
```

### 4-4. 보안 알림 연동 (무료)

#### 방법 A: Firebase Extensions — Slack 알림 (무료 Extensions)

```
Firebase Console → Extensions → "Send Messages with Twilio" 또는
자체 Slack Webhook (무료)
→ security_alerts 컬렉션 신규 문서 생성 시 자동 알림
```

#### 방법 B: 이메일 알림 (Firebase 무료 이메일 한도 내)

```javascript
// functions/alertNotifier.js
exports.onSecurityAlert = functions.firestore
  .document('security_alerts/{alertId}')
  .onCreate(async (snap) => {
    const alert = snap.data();
    // Firebase Admin SDK → 이메일 발송 (SendGrid 무료 100통/일)
    // 또는 Gmail SMTP (무료)
  });
```

---

## 5. 무료·최소비용 방안 정리

### 비용 분류표

| 방안 | 비용 | 우선순위 |
|------|------|---------|
| Firestore Rules 강화 (범위/빈도 제한) | **무료** | 🔴 즉시 |
| Firebase App Check (reCAPTCHA v3) | **무료** | 🔴 즉시 |
| firebase.json 보안 헤더 추가 | **무료** | 🔴 즉시 |
| GitHub Actions 의존성 스캔 (npm audit) | **무료** | 🟠 단기 |
| gitleaks 시크릿 스캔 | **무료** | 🟠 단기 |
| Cloud Functions 이상 탐지 스케줄러 | **무료** (쿼터 내) | 🟠 단기 |
| Firestore 기반 Rate Limiter | **무료** | 🟠 단기 |
| Google Perspective API (텍스트 필터) | **무료** (1 QPS) | 🟡 중기 |
| Firebase Firestore Rules 자동 테스트 | **무료** (로컬 에뮬레이터) | 🟡 중기 |
| SRI (Subresource Integrity) | **무료** | 🟡 중기 |
| GCP Secret Manager | **저비용** (~$0.06/시크릿/월) | 🟡 중기 |
| Azure Content Safety (이미지) | **현재 사용 중** (유료) | — 유지 |
| Slack 알림 Webhook | **무료** | 🟡 중기 |
| SendGrid 이메일 알림 | **무료** (100통/일) | 🟡 중기 |

### Firebase 무료 티어 여유 공간 (Spark Plan 기준)

| 리소스 | 무료 한도 | 보안 기능 예상 사용량 |
|--------|----------|---------------------|
| Cloud Functions 호출 | 2M/월 | 스케줄러 ~1,000/월 |
| Cloud Functions GB-초 | 400K/월 | ~5,000/월 |
| Firestore 읽기 | 50K/일 | 진단 쿼리 ~500/일 |
| Firestore 쓰기 | 20K/일 | 알림 로그 ~100/일 |
| Cloud Storage | 5GB | 로그 파일 최소 |

---

## 6. 우선순위 로드맵

### Phase 1 — 즉시 적용 (1~2일, app.js 변경 없음) — **구현 완료 2026-04-18**

```
✅ 1. firebase.json — 보안 헤더 추가 (구현 완료)
       X-Frame-Options: DENY, X-Content-Type-Options: nosniff,
       Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy 적용됨
       ※ CSP unsafe-inline/unsafe-eval 잔존 — Phase 3 (SRI/nonce) 에서 개선 예정

✅ 2. firestore.rules — 게임 수치 범위 검증 추가 (구현 완료)
       ✅ isValidPointsDelta(): 1회 50,000 포인트 증가 상한
       ✅ isValidLevelDelta(): 1회 1레벨 증가 상한
       ✅ notTooFrequent(): 5초 업데이트 빈도 제한
          (인프라 구현 완료 — Phase 2 app.js에서 lastUpdatedAt 쓰기 시 완전 활성화)
       ✅ security_alerts / rate_limits 컬렉션 규칙 추가 (Phase 2 준비 완료)

✅ 3. storage.rules — MIME 검증 강화 (구현 완료)
       image/.* → 명시적 허용 목록 (jpeg/png/webp/gif/heic/heif)
       SVG·BMP·TIFF 차단 (XSS 및 불필요 형식 배제)

⏳ 4. Firebase Console — App Check 활성화 (수동 작업 필요)
       콘솔에서 직접 활성화: 웹 reCAPTCHA v3 / Android Play Integrity
       → Phase 2 완료 후 app.js App Check 초기화 1줄 추가 예정
```

### Phase 2 — 단기 적용 (1~2주)

```
🔧 4. functions/securityTriggers.js — 실시간 이상 탐지 Trigger 추가
       (포인트 급증, 대량 삭제 감지)

🔧 5. functions/rateLimiter.js — Firestore 기반 Rate Limiter 추가

🔧 6. .github/workflows/security-scan.yml — 자동 의존성 스캔 CI 추가
       (npm audit + gitleaks)

🔧 7. app.js — App Check 초기화 1줄 추가 (Phase 1 완료 후)
```

### Phase 3 — 중기 적용 (1개월)

```
📋 8. functions/securityScheduler.js — 주간/일간 보안 진단 스케줄러

📋 9. Google Perspective API 연동 — 텍스트 콘텐츠 필터링

📋 10. test/firestore-rules.test.js — Rules 자동화 테스트 추가

📋 11. GCP Secret Manager 이전 — ADMIN_EMAILS, AZURE_CS_KEY

📋 12. SRI 해시 적용 — app.html Firebase SDK 태그
```

### Phase 4 — 장기 고도화 (분기별)

```
🎯 13. 어드민 대시보드에 보안 리포트 탭 추가
        (security_alerts 컬렉션 시각화)

🎯 14. 게임 상태 계산 로직을 Cloud Functions으로 이전
        (클라이언트 신뢰 제거 — 가장 근본적 보안 개선)

🎯 15. 분기별 외부 침투 테스트 (무료: OWASP ZAP 자동 스캔)
```

---

## 부록: 파일별 변경 범위 요약

| 파일 | Phase | 변경 유형 | app.js 영향 |
|------|-------|---------|-----------|
| `firebase.json` | 1 | 보안 헤더 추가 | **없음** |
| `firestore.rules` | 1 | 범위/빈도 검증 추가 | **없음** |
| `storage.rules` | 1 | MIME 검증 강화 ✅ (jpeg/png/webp/gif/heic/heif 허용리스트) | **없음** |
| `functions/securityTriggers.js` | 2 | **신규 파일** | **없음** |
| `functions/rateLimiter.js` | 2 | **신규 파일** | **없음** |
| `.github/workflows/security-scan.yml` | 2 | **신규 파일** | **없음** |
| `app.js` | 2 | App Check 초기화 1줄 | **최소 (1줄)** |
| `functions/securityScheduler.js` | 3 | **신규 파일** | **없음** |
| `test/firestore-rules.test.js` | 3 | **신규 파일** | **없음** |
| `app.html` | 3 | SRI 해시 추가 | **없음** |

---

*본 문서는 구현 지침서이며, 실제 적용 전 스테이징 환경에서 검증을 권장합니다.*
