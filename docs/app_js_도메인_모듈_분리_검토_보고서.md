# app.js 도메인 모듈 분리 검토 보고서

- 대상 앱: **LEVEL UP: REBOOT**
- 작성일: **2026-04-06 (UTC 기준)**
- 참고: 모바일앱 완성도 분석 및 예상 이용자수 산출 보고서 (2026-03-26)
- 목적: app.js 모놀리식 구조의 도메인별 모듈 분리 방안을 시스템 영향도에 따라 phase별로 설계

---

## 1) 현황 분석

### 1-1. 현재 구조

| 항목 | 수치 |
|---|---:|
| app.js 총 라인 수 | 16,536줄 |
| 함수 수 | 306개 (async + sync) |
| 파일 크기 | 846KB |
| 도메인 영역 수 | 20개 이상 |
| `window.xxx` 전역 함수 등록 | 162개 |

### 1-2. 식별된 도메인 영역

| # | 도메인 | app.js 라인 범위 (약) | 함수 수 (약) |
|---:|---|---|---:|
| 1 | Analytics / ConversionTracker | 49-113 | 12 |
| 2 | Remote Config / A/B Testing | 36-133 | 3 |
| 3 | Network / Offline | 138-271 | 6 |
| 4 | Image Upload / Storage | 164-596 | 25 |
| 5 | AppState / Navigation | 661-1211 | 20 |
| 6 | Init / DOMContentLoaded | 1366-1515 | 1 |
| 7 | Onboarding | 1552-1620 | 5 |
| 8 | User Data Persistence | 1832-2167 | 10 |
| 9 | Player Progression / Stats | 2406-2746 | 20 |
| 10 | Quests | 2994-3272 | 9 |
| 11 | Raid / Dungeon | 3504-3995 | 15 |
| 12 | Auth / User Management | 4309-5031 | 70+ |
| 13 | Social / Leaderboard | 4309-4519 | 10 |
| 14 | Daily Challenges / Roulette | 6501-6833 | 12 |
| 15 | Advertising (AdMob) | 6833-7629 | 20 |
| 16 | Planner / Diary | 7674-8725 | 15 |
| 17 | Reels / Social Feed | 8812-9891 | 30 |
| 18 | Settings / Theme | 9916+ | 15 |
| 19 | Health / Fitness Sync | 10059-10549 | 12 |
| 20 | Push Notifications | 10689-11283 | 15 |
| 21 | D-Day / Life Status | 11368-12048 | 20 |
| 22 | Security / Sanitization | 11342-11368 | 4 |
| 23 | Exercise Calculators | 15066-16536 | 30+ |

### 1-3. 핵심 리스크 (완성도 보고서 인용)

> "대형 단일 파일 구조(app.js)로 기능 변경 시 회귀 영향 범위가 큼"
> — 기술/품질 영역 (72/100점) 잔여 리스크

> "권장 조치: app.js 도메인 모듈 분리(온보딩/레이드/광고/소셜)"
> — Phase 2 (31-60일) 품질 안정화 항목

---

## 2) 기술 환경 분석

### 2-1. 모듈화 가능성

| 항목 | 현황 | 평가 |
|---|---|---|
| 스크립트 로드 방식 | `<script type="module" src="app.js">` | ES6 import/export 즉시 사용 가능 |
| 번들러 | 없음 (Vanilla JS) | 네이티브 ES6 모듈 방식 채택 |
| 상태 관리 | 전역 `AppState` 객체 (lines 661-699) | core 모듈로 분리 후 import 공유 |
| HTML 이벤트 바인딩 | `onclick="window.xxx()"` 패턴 162개 | 각 모듈에서 window 등록 유지 |
| Firebase SDK | CDN import + 전역 객체 | firebase-init 모듈로 중앙화 |
| 파일 동기화 | `sync-www.sh` (개별 파일 목록 기반) | modules/ 디렉토리 동기화 추가 필요 |
| 참고 패턴 | Admin 대시보드 (`www/admin/js/`) | 이미 ES6 모듈 구조 적용됨 |

### 2-2. 설계 원칙

1. **점진적 분리:** Big-bang 리팩토링 금지. 각 Phase는 독립적으로 배포 가능
2. **역호환성:** `window.xxx` 전역 등록 유지로 app.html 변경 최소화
3. **단방향 의존:** core → domain → ui 방향. 순환 의존 금지
4. **영향도 기반 순서:** 저결합 모듈부터 추출하여 리스크 최소화

---

## 3) 목표 모듈 구조

```
app.js                          ← 엔트리포인트 (import + init 호출, ~200줄)
modules/
├── core/
│   ├── state.js                ← AppState, getInitialAppState()
│   ├── firebase-init.js        ← Firebase SDK 초기화, db/auth/storage export
│   ├── network.js              ← NetworkMonitor, online/offline 처리
│   ├── analytics.js            ← ConversionTracker, Remote Config
│   └── utils.js                ← sanitize*, getTodayStr, KST helpers
├── user/
│   ├── auth.js                 ← login, logout, signup, email verification
│   ├── profile.js              ← username, avatar, profile modal
│   └── persistence.js          ← saveUserData, loadUserDataFromDB, normalizers
├── onboarding.js               ← showOnboardingGuide, slides, A/B variants
├── raid-dungeon.js             ← dungeon rendering, raid timer, boss HP, attacks
├── advertising.js              ← AdMob init, banner/rewarded/native ads, bonus EXP
├── social/
│   ├── leaderboard.js          ← fetchSocialData, renderUsers, rankings
│   └── reels.js                ← posts, reactions, comments, location, reporting
├── quest.js                    ← quest list, DIY quests, calendar, history
├── planner.js                  ← planner calendar, tasks, timebox, diary, photo
├── progression.js              ← streaks, rare titles, loot, crit, level-up
├── push-notifications.js       ← FCM init, topics, listeners, in-app notifications
├── health-sync.js              ← GPS, Google Fit, Health Connect, step UI
├── challenges.js               ← weekly challenges, roulette
├── dday.js                     ← D-Day countdown, life status
├── exercise-calc.js            ← running calculator, 1RM calculator
├── ui/
│   ├── navigation.js           ← nav ordering, hamburger menu, tab switching
│   ├── status-cards.js         ← card editor, drag reorder, visibility
│   ├── modals.js               ← info modals, profile stats modal
│   └── theme.js                ← dark/light mode, language change
└── media/
    ├── image-upload.js          ← upload queue, compression, retry, blob cache
    └── camera.js               ← camera/gallery, photo source sheet
```

**총 27개 모듈**, 5개 하위 디렉토리 (core, user, social, ui, media)

---

## 4) 모듈 간 의존성 맵

```
core/state.js ──────────────────────────────── (모든 모듈이 의존)
core/firebase-init.js ──────────────────────── (DB/Auth 사용 모듈이 의존)
core/utils.js ──────────────────────────────── (sanitize/date 사용 모듈이 의존)
core/network.js ─── core/firebase-init.js
core/analytics.js ─── core/firebase-init.js

onboarding.js ─── core/analytics.js, core/state.js
advertising.js ─── core/state.js, core/firebase-init.js
raid-dungeon.js ─── core/state.js, core/firebase-init.js, core/utils.js
social/leaderboard.js ─── core/state.js, core/firebase-init.js, user/profile.js
social/reels.js ─── core/state.js, core/firebase-init.js, media/image-upload.js

user/persistence.js ─── core/state.js, core/firebase-init.js
user/auth.js ─── core/state.js, core/firebase-init.js, core/analytics.js
user/profile.js ─── user/auth.js, media/image-upload.js

quest.js ─── core/state.js, progression.js
progression.js ─── core/state.js, core/firebase-init.js
planner.js ─── core/state.js, core/firebase-init.js, media/image-upload.js
push-notifications.js ─── core/state.js, core/firebase-init.js
health-sync.js ─── core/state.js
challenges.js ─── core/state.js, core/firebase-init.js
dday.js ─── core/state.js, core/firebase-init.js, core/utils.js
exercise-calc.js ─── core/state.js
```

---

## 5) 모듈 패턴 설계

### 5-1. 공유 상태 접근

```javascript
// modules/core/state.js
export let AppState = getInitialAppState();
export function getInitialAppState() { /* ... */ }
export function resetAppState() { AppState = getInitialAppState(); }

// 다른 모듈에서:
import { AppState } from './core/state.js';
```

### 5-2. Firebase 공유

```javascript
// modules/core/firebase-init.js
export { db, auth, storage, functions, analytics, remoteConfig };

// 다른 모듈에서:
import { db, auth } from './core/firebase-init.js';
```

### 5-3. window 전역 함수 등록 (onclick 핸들러 호환)

```javascript
// modules/raid-dungeon.js
export function joinDungeon() { /* ... */ }
window.joinDungeon = joinDungeon;  // app.html onclick 핸들러용
```

### 5-4. 모듈 초기화 패턴

```javascript
// app.js (엔트리포인트)
import { AppState } from './modules/core/state.js';
import { initOnboarding } from './modules/onboarding.js';
import { initRaid } from './modules/raid-dungeon.js';
import { initAds } from './modules/advertising.js';
import { initReels } from './modules/social/reels.js';
// ... DOMContentLoaded에서 각 모듈 init 호출
```

---

## 6) Phase별 구현 계획 (시스템 영향도 순)

### Phase 1: Core 인프라 + 저결합 모듈 (영향도: 낮음)

**목표:** 공유 기반 모듈 분리 + 독립적인 도메인 추출
**예상 기간:** 3-5일
**리스크:** 매우 낮음 — 기반 모듈과 완전 독립 도메인만 대상

| 순서 | 모듈 | 라인 수 (약) | 의존도 | 추출 근거 |
|---:|---|---:|---|---|
| 1 | `core/state.js` | 60 | 없음 | 모든 모듈의 기반, AppState 분리 |
| 2 | `core/firebase-init.js` | 40 | state | Firebase 객체 중앙화 |
| 3 | `core/utils.js` | 50 | 없음 | sanitize, date helpers (범용 유틸) |
| 4 | `core/network.js` | 60 | firebase-init | NetworkMonitor 완전 독립적 |
| 5 | `core/analytics.js` | 90 | firebase-init | ConversionTracker + RemoteConfig |
| 6 | `exercise-calc.js` | 1,470 | state만 | **가장 안전한 추출 대상** — 완전 독립, 타 도메인 참조 없음 |
| 7 | `dday.js` | 680 | state, firebase, utils | 타 도메인 의존 없음 |
| 8 | `challenges.js` | 330 | state, firebase | roulette/challenge 독립적 |

**검증 항목:**
- 앱 로드 시 콘솔 에러 없음
- 운동 계산기 (러닝/1RM) 정상 작동
- D-Day 추가/수정/삭제
- 룰렛 스핀 + 주간 챌린지 진행

---

### Phase 2: 보고서 권고 4대 도메인 (영향도: 중간)

**목표:** 완성도 보고서 핵심 권고 — 온보딩/레이드/광고/소셜 도메인 분리
**예상 기간:** 5-7일
**리스크:** 중간 — AdMob 초기화 타이밍, 레이드 타이머, 리스 피드 렌더링 주의

| 순서 | 모듈 | 라인 수 (약) | 주요 의존 | 리스크 포인트 |
|---:|---|---:|---|---|
| 9 | `onboarding.js` | 80 | analytics, state | A/B 실험 variant 연동 |
| 10 | `advertising.js` | 800 | state, firebase | AdMob SDK 초기화 순서, GDPR UMP 동의 플로우 |
| 11 | `raid-dungeon.js` | 500 | state, firebase, utils | `setInterval` 타이머 관리, KST 슬롯 계산 |
| 12 | `social/leaderboard.js` | 210 | state, firebase, profile | 글로벌/친구 탭 전환 |
| 13 | `social/reels.js` | 1,080 | state, firebase, media | 위치 태그(Nominatim API), 반응/댓글, 신고 시스템 |

**검증 항목:**
- 온보딩 가이드 표시 (compact/legacy variant 모두)
- 레이드 참여 → 공격 → HP 바 업데이트
- 배너 광고 표시, 보상형 광고 시청 → 보너스 EXP 수령
- 리스 작성 (위치 태그 포함) → 좋아요 → 댓글 → 신고

---

### Phase 3: 사용자 & 진행 시스템 (영향도: 높음)

**목표:** 핵심 사용자 데이터 경로 분리 — 가장 신중하게 접근
**예상 기간:** 5-7일
**리스크:** 높음 — 데이터 저장/로드, 인증 플로우가 앱 전체에 영향

| 순서 | 모듈 | 라인 수 (약) | 리스크 포인트 |
|---:|---|---:|---|
| 14 | `media/image-upload.js` | 430 | retry queue + offline 복원력, 업로드 직렬화 |
| 15 | `user/persistence.js` | 340 | Firestore 읽기/쓰기 핵심 경로, normalizer 함수들 |
| 16 | `user/auth.js` | 720 | 로그인/로그아웃/회원가입 전체 플로우, Google OAuth |
| 17 | `user/profile.js` | 300 | auth 모듈 의존, 이미지 업로드 연동 |
| 18 | `progression.js` | 340 | 스트릭/레어칭호/루트/크리티컬 — 다수 모듈에서 참조 |
| 19 | `quest.js` | 280 | progression 의존, DIY 퀘스트 CRUD |

**검증 항목:**
- 로그인 (Google OAuth + 이메일/비밀번호) → 사용자 데이터 로드
- 프로필 사진 업로드 → 압축 → Storage 저장
- 퀘스트 완료 → 스탯 증가 → 레벨업
- 스트릭 갱신 → 레어 칭호 달성
- 오프라인 → 온라인 복귀 시 데이터 동기화

---

### Phase 4: UI & 나머지 (영향도: 중간)

**목표:** 나머지 도메인 분리로 모듈화 완성
**예상 기간:** 5-7일

| 순서 | 모듈 | 라인 수 (약) | 비고 |
|---:|---|---:|---|
| 20 | `planner.js` | 1,050 | 가장 큰 단일 도메인 모듈 |
| 21 | `push-notifications.js` | 600 | FCM 토큰 관리, 토픽 구독 |
| 22 | `health-sync.js` | 490 | Health Connect / Google Fit 네이티브 연동 |
| 23 | `ui/navigation.js` | 500 | 탭 드래그 리오더, 햄버거 메뉴 |
| 24 | `ui/status-cards.js` | 400 | 카드 에디터, 드래그 리오더 |
| 25 | `ui/modals.js` | 200 | 정보 모달, 프로필 스탯 모달 |
| 26 | `ui/theme.js` | 200 | 다크/라이트 모드, 언어 전환 |
| 27 | `media/camera.js` | 100 | 카메라/갤러리 선택 |

### Phase 5: 엔트리포인트 정리

- app.js를 **~200줄의 import + init 호출 코드**로 축소
- `DOMContentLoaded` / `onAuthStateChanged` 오케스트레이션 로직만 유지
- 모든 도메인 로직은 modules/ 하위로 이동 완료

---

## 7) 인프라 변경 사항

### 7-1. sync-www.sh 수정

modules/ 디렉토리 전체 동기화 추가:

```bash
# 기존 FILES 배열 루프 이후 추가
# modules/ 디렉토리 동기화 (rsync 사용)
if [ -d "$SCRIPT_DIR/modules" ]; then
    mkdir -p "$WWW_DIR/modules"
    rsync -a --delete "$SCRIPT_DIR/modules/" "$WWW_DIR/modules/"
    echo "  SYNC modules/ 디렉토리"
elif [ -d "$WWW_DIR/modules" ]; then
    mkdir -p "$SCRIPT_DIR/modules"
    rsync -a --delete "$WWW_DIR/modules/" "$SCRIPT_DIR/modules/"
    echo "  SYNC modules/ (www → root)"
fi
```

### 7-2. 변경 파일 요약

| 파일 | 변경 내용 |
|---|---|
| `app.js` | 모듈 import + init 호출로 점진적 축소 |
| `modules/**/*.js` | 신규 생성 (27개 모듈 파일) |
| `sync-www.sh` | modules/ 디렉토리 동기화 로직 추가 |
| `app.html` | **변경 불필요** (이미 `<script type="module">`) |

---

## 8) 검증 전략

### Phase별 검증 체크리스트

| Phase | 검증 항목 |
|---|---|
| Phase 1 | 앱 로드 정상, 운동 계산기, D-Day CRUD, 룰렛 스핀 |
| Phase 2 | 온보딩 가이드, 레이드 참여/공격, 광고 표시/보상, 리스 작성/반응 |
| Phase 3 | 로그인/로그아웃, 프로필 수정, 퀘스트 완료, 스트릭/칭호, 오프라인 동기화 |
| Phase 4 | 플래너 사용, 푸시 알림, 건강 동기화, 테마 전환, 탭 리오더 |
| Phase 5 | 전체 E2E 회귀 테스트 |

### 공통 검증 절차

1. `bash sync-www.sh` 실행 → www/ 동기화 확인
2. 브라우저 개발자 도구 콘솔 에러 없음 확인
3. 해당 Phase 도메인 기능 수동 테스트
4. Capacitor 빌드: `npm run build-apk` 성공 확인 (Phase 완료 시)

---

## 9) 예상 효과

### 정량적 개선

| 지표 | 현재 | 목표 |
|---|---:|---:|
| app.js 라인 수 | 16,536줄 | ~200줄 (엔트리포인트) |
| 최대 단일 모듈 크기 | - | ~1,470줄 (exercise-calc) |
| 평균 모듈 크기 | - | ~400줄 |
| 도메인 간 결합도 | 높음 (전역 함수) | 낮음 (명시적 import) |

### 정성적 개선

- **유지보수성:** 도메인별 독립 수정 가능, 회귀 영향 범위 축소
- **개발자 온보딩:** 신규 개발자가 특정 도메인만 파악하면 작업 가능
- **테스트 용이성:** 모듈 단위 테스트 작성 가능 (E2E 자동화 기반 확보)
- **병렬 개발:** 여러 개발자가 서로 다른 모듈을 동시 수정 가능

### 완성도 점수 영향 (예측)

기술/품질 영역: 72점 → **78-80점** (모듈화 + 구조 개선)
**종합 완성도: 80점 → 82-83점**

---

## 10) 추가 분석: IIFE 패턴 모듈 및 핵심 결합점

### 10-1. 기존 IIFE 자체 격리 모듈 (가장 안전한 추출 대상)

app.js 하단에 4개의 IIFE(즉시 실행 함수 표현식)가 이미 자체 격리 스코프로 구현되어 있음. 이들은 `window.*` 등록과 `AppState` 읽기만으로 외부와 통신하므로, **Phase 1에서 가장 우선적으로 추출 가능**.

| IIFE | app.js 라인 범위 | 크기 | 외부 의존 |
|---|---|---:|---|
| Pomodoro Timer | 12049-12494 | 445줄 | `AppState.currentLang`, `i18n`, `isNativePlatform` |
| Library/Book Scanner | 12499-15064 | 2,565줄 | `AppState`, `i18n`, `auth`, `db`, `saveUserData` |
| Running Calculator | 15067-16192 | 1,125줄 | `AppState.currentLang`, `i18n`, `saveUserData` |
| 1RM Calculator | 16195-16536 | 341줄 | `AppState.currentLang`, `i18n`, `saveUserData` |

**IIFE 4개 합계: 4,476줄 (app.js의 27%)** — 행동 변경 없이 모듈 변환 가능

### 10-2. 핵심 결합점: `switchTab()` 함수

`switchTab()` (line 4040)은 탭 전환 시 각 도메인의 render 함수를 직접 호출하는 **앱 전체의 핵심 결합점**.

```
switchTab() → renderQuestList(), renderDungeon(), fetchSocialData(),
              renderReelsFeed(), renderPlannerCalendar(), renderBonusExp(),
              loadAndShowNativeAd(), ...
```

**대응 전략:**
- 초기: `switchTab()`에서 각 모듈의 render 함수를 직접 import
- 향후: EventBus 패턴으로 전환 (모듈이 탭 전환 이벤트를 구독)

```javascript
// 향후 EventBus 패턴 예시 (modules/core.js)
export const EventBus = {
    _handlers: {},
    on(event, fn) { (this._handlers[event] ??= []).push(fn); },
    emit(event, ...args) { (this._handlers[event] || []).forEach(fn => fn(...args)); }
};

// modules/quest.js
EventBus.on('tab:quest', () => renderQuestList());
```

### 10-3. `data.js` 전역 상수 처리

`data.js`는 `<script>` (비모듈)로 app.js보다 먼저 로드되어 `i18n`, `statKeys`, `weeklyQuestData`, `seoulStations` 등을 전역에 노출.

**권장:** data.js는 현 상태 유지. ES6 모듈 코드에서 전역 변수로 직접 접근 가능. 모든 모듈이 `i18n`을 참조하므로 data.js의 모듈 변환은 저우선순위.

### 10-4. 성능 고려사항

- 모듈 파일 27개 = HTTP 요청 27개 추가
- **Capacitor WebView**: 로컬 파일시스템에서 서빙 → 지연 무시 가능
- **웹 버전**: HTTP/2 멀티플렉싱으로 병렬 로드 → 영향 미미
- **향후 필요 시**: 번들러(Vite 등) 도입으로 단일 파일 빌드 가능 (소스 코드 변경 없이)

---

## 11) 리스크 완화 방안

| 리스크 | 영향 | 완화 전략 |
|---|---|---|
| 모듈 로딩 순서 | 초기화 실패 | ES6 모듈은 import 그래프 순서대로 실행. data.js는 일반 script로 먼저 로드되어 안전 |
| 순환 의존 | 런타임 에러 | EventBus 패턴으로 도메인 간 간접 통신. core → domain → ui 단방향 원칙 |
| `window.*` 함수 누락 | onclick 핸들러 미작동 | 각 모듈에서 window 등록 유지. 추출 시 등록 목록 체크리스트 확인 |
| `saveUserData` 참조 단절 | 데이터 미저장 | persistence.js를 Phase 3까지 app.js에 유지. 모든 소비 모듈 이전 완료 후 추출 |
| Capacitor 호환성 | 앱 크래시 | Phase별 `npm run build-apk` + 기기 테스트 필수 |

---

## 12) 구현 우선순위 권장

보고서 권고안에 따라 **Phase 1 (core 기반 + 저결합) → Phase 2 (온보딩/레이드/광고/소셜)** 순서로 우선 진행.

- Phase 1은 Phase 2의 **필수 전제 조건** (core 모듈 없이 도메인 모듈 분리 불가)
- Phase 2가 보고서의 **핵심 권고 사항** (4대 도메인)
- Phase 1에서 IIFE 4개 추출로 **즉시 4,476줄 (27%) 감소** — 가장 안전한 성과
- Phase 1+2 완료 시 **13개 모듈 분리**, app.js에서 약 **8,700줄 제거 (53%)**
- Phase 3-5는 Phase 1+2 안정화 후 후속 작업으로 분리 권장
