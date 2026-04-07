# IIFE 패턴 유지한 저결합 모듈 추가 분리 검토

- 대상 앱: **LEVEL UP: REBOOT**
- 작성일: **2026-04-07 (UTC 기준)**
- 참고: `refactor-ad-social-module-separation.md` (Phase 1-3 완료), `app_js_도메인_모듈_분리_검토_보고서.md`
- 목적: app.js 내 남은 2개 자체 격리 IIFE 블록(뽀모도로, 내 서재)을 기존 패턴 그대로 추출

---

## 1) 현황 요약

### 1-1. 현재 아키텍처

```
app.js (14,154줄)
  └── Module Bridge (L14112-14145)
        ├── window.AppState, window.saveUserData, ...
        ├── 광고 모듈용: window._db, window._fbLogEvent, ...
        └── 소셜 모듈용: window._getDocs, window.switchTab, ...
  └── Dynamic Imports (L14147-14154)
        ├── modules/ad-manager.js  (875줄)  → window.AdManager
        ├── modules/social.js      (283줄)  → window.SocialModule
        └── modules/exercise-calc.js (1,478줄) → window.ExerciseCalcModule
```

### 1-2. 기존 추출 성과

| Phase | 모듈 | 라인 수 | 상태 |
|-------|------|------:|------|
| Phase 1 | `modules/ad-manager.js` (광고) | 875줄 | ✅ 완료 |
| Phase 2 | `modules/social.js` (소셜) | 283줄 | ✅ 완료 |
| Phase 3 | 동적 로드 등록 & www 동기화 | - | ✅ 완료 |
| (기존) | `modules/exercise-calc.js` (운동 계산기) | 1,478줄 | ✅ 완료 |

### 1-3. app.js 내 남은 IIFE 블록

app.js 내에 2개의 자체 격리 IIFE가 남아 있음. 이들은 `window.*` 등록과 `AppState`/`i18n` 읽기만으로 외부와 통신하므로 **행동 변경 없이 모듈 변환 가능**.

| IIFE | app.js 라인 | 크기 | 외부 의존 |
|------|------------|------|-----------|
| 뽀모도로 타이머 | 11024-11469 | ~446줄 | `AppState`, `i18n`, `saveUserData`, `updatePointUI`, `drawRadarChart`, `getTodayKST`, `showToast`, `showInAppNotification`, Capacitor LocalNotifications |
| 내 서재 (Library/ISBN Scanner) | 11474-14109 | ~2,636줄 | `AppState`, `i18n`, `auth`, `db`, `setDoc`, `doc`, `saveUserData`, `isNativePlatform`, Capacitor BarcodeScanner, Html5QrCode |

추가로 `openLibraryInfoModal` (lines 5459-5518, ~60줄)이 IIFE 외부 app.js 본문에 존재하나, 서재 도메인 전용이므로 Library 모듈로 함께 이동.

**추출 합계: ~3,142줄 → app.js 약 11,012줄로 감소 (22.6%↓)**

---

## 2) 추출 설계

### 2-1. 적용 패턴 (기존과 동일)

```javascript
// modules/xxx.js
(function() {
    'use strict';

    // Private state (closure-scoped)
    let _state = { ... };

    // Private helpers
    function _helper() { ... }

    // 외부 의존은 window.* 경유
    const AppState = window.AppState;
    const i18n = window.i18n;

    // Public API → window 등록 (HTML onclick 호환)
    window.publicFunction = function() { ... };

    // DOMContentLoaded 안전 처리
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
```

### 2-2. 설계 원칙

1. **IIFE 래핑 유지:** `(function() { 'use strict'; ... })();` — 기존 모듈과 일관성
2. **Window Bridge 경유:** 외부 참조를 `window.*`로 변환, Module Bridge에서 노출
3. **방어적 호출:** `typeof xxx === 'function'` 가드 유지 (기존 코드에 이미 적용됨)
4. **DOMContentLoaded 안전 처리:** 동적 import 시점에 DOM 이미 로드 가능성 대응
5. **window 함수 등록 유지:** HTML `onclick="window.xxx()"` 핸들러 호환

---

## 3) Step 1: `modules/pomodoro.js` 생성

### 3-1. 추출 대상 (app.js lines 11024-11469)

| 영역 | 라인 | 내용 |
|------|------|------|
| 상수/상태 | 11024-11036 | `POMO_STORAGE_KEY`, `pomoState` 객체 |
| 설정 관리 | 11038-11048 | `getPomoSettings()`, `savePomoSettings()` |
| UI 업데이트 | 11050-11127 | `updatePomoUI()` — 시간 표시, 진행 링, 버튼 상태 |
| 타이머 로직 | 11129-11228 | `startPomoPhase()`, `pomoTick()` — 집중/휴식/긴휴식 전환 |
| 알림 | 11230-11327 | `playPomoSound()`, `schedulePomoNotification()`, `cancelPomoNotification()` |
| 보상 지급 | 11329-11352 | `grantPomoReward()` — +10P & AGI +0.3 (일 1회) |
| Public API | 11354-11435 | `togglePomodoro`, `resetPomodoro`, `openPomoSettings`, `closePomoSettings`, `savePomoSettingsFromModal` |
| 초기화 | 11437-11469 | `initPomoLocalNotifListener()`, DOMContentLoaded 리스너 |

### 3-2. 외부 의존성 매핑

| 현재 참조 | Module Bridge 매핑 | 상태 |
|-----------|-------------------|------|
| `AppState.currentLang` | `window.AppState.currentLang` | ✅ 이미 노출 |
| `AppState.user._pomoDoneDate` | `window.AppState.user._pomoDoneDate` | ✅ 이미 노출 |
| `AppState.user.points` | `window.AppState.user.points` | ✅ 이미 노출 |
| `AppState.user.stats.agi` | `window.AppState.user.stats.agi` | ✅ 이미 노출 |
| `i18n[lang]` | `window.i18n[lang]` | ✅ 이미 노출 |
| `getTodayKST()` | `window.getTodayKST()` | ✅ 이미 노출 |
| `saveUserData()` | `window.saveUserData()` | ✅ 이미 노출 |
| `updatePointUI()` | `window.updatePointUI()` | ✅ 이미 노출 |
| `drawRadarChart()` | `window.drawRadarChart()` | ✅ 이미 노출 |
| `showToast()` | `window.showToast()` | ❌ **Bridge 추가 필요** |
| `showInAppNotification()` | `window.showInAppNotification()` | ❌ **Bridge 추가 필요** |
| `window.Capacitor` | 직접 참조 | ✅ 변경 불필요 |

### 3-3. window 등록 목록 (HTML onclick 호환)

```javascript
window.togglePomodoro        // 시작/일시정지
window.resetPomodoro         // 리셋
window.openPomoSettings      // 설정 모달 열기
window.closePomoSettings     // 설정 모달 닫기
window.savePomoSettingsFromModal  // 설정 저장
```

### 3-4. DOMContentLoaded 처리

기존:
```javascript
document.addEventListener('DOMContentLoaded', () => { ... });
```

변경:
```javascript
function initPomo() {
    const settings = getPomoSettings();
    pomoState.secondsLeft = settings.focusMin * 60;
    pomoState.totalSeconds = settings.focusMin * 60;
    updatePomoUI();
    const settingsBtn = document.getElementById('btn-pomo-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', window.openPomoSettings);
    initPomoLocalNotifListener();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPomo);
} else {
    initPomo();
}
```

---

## 4) Step 2: `modules/library.js` 생성

### 4-1. 추출 대상

| 소스 | app.js 라인 | 크기 | 내용 |
|------|------------|------|------|
| Library IIFE | 11474-14109 | ~2,636줄 | ISBN 스캐너, 책 관리, 바벨탑, 날짜 필터, 공유 |
| `openLibraryInfoModal` | 5459-5518 | ~60줄 | 서재 가이드 모달 (IIFE 외부, 서재 도메인) |

### 4-2. 외부 의존성 매핑

| 현재 참조 | Module Bridge 매핑 | 상태 |
|-----------|-------------------|------|
| `AppState` | `window.AppState` | ✅ 이미 노출 |
| `i18n` | `window.i18n` | ✅ 이미 노출 |
| `auth` | `window._auth` | ✅ 이미 노출 |
| `db` | `window._db` | ✅ 이미 노출 |
| `setDoc` | `window._setDoc` | ✅ 이미 노출 |
| `doc` | `window._doc` | ✅ 이미 노출 |
| `saveUserData` | `window.saveUserData` | ✅ 이미 노출 |
| `isNativePlatform` | `window.isNativePlatform` | ✅ 이미 노출 |
| `showToast` | `window.showToast` | ❌ → Step 1에서 Bridge 추가 |
| `window.AdManager` | 직접 참조 | ✅ 변경 불필요 |
| `window.Capacitor` | 직접 참조 | ✅ 변경 불필요 |

**참고:** Library IIFE 내부 코드 전체를 구현 시점에 정밀 스캔하여, 위 목록 외 추가 외부 참조가 있는지 확인 필요.

### 4-3. window 등록 목록 (HTML onclick 호환, ~40개)

```javascript
// 서재 메인
window.openLibraryInfoModal     // 가이드 모달 (IIFE 외부에서 이동)
window.updateLibraryCardCount
window.openLibraryView
window.closeLibraryView
window.switchLibraryTab
window.switchLibraryPeriod
window.switchLibraryViewMode
window.filterLibraryBooks
window.toggleLibrarySearchMode
window.renderLibrary

// 날짜 선택기
window.openLibraryDatePicker
window.closeLibraryDatePicker
window.confirmLibraryDatePicker
window.selectLibraryPickerYear
window.selectLibraryPickerMonth

// 검색
window.selectSearchCat
window.addSearchResult
window.loadMoreSearchResults

// 책 관리
window.openBookAction
window.openBookDetail
window.addBookToLibrary
window.removeBookFromLibrary
window.changeBookCategory

// ISBN 스캐너
window.openIsbnScanner
window.closeIsbnScanner
window.manualIsbnLookup
window.confirmScanResult
window.cancelScanResult

// 책 추가 확인
window.confirmAddBook
window.cancelBookConfirm
window.confirmManualBook
window.cancelManualBook

// 공유
window.shareLibraryAsImage
window._executeLibraryImageSave
```

### 4-4. `openLibraryInfoModal` 이동

- app.js line 5459-5518에서 **제거**
- `modules/library.js` IIFE 내부에 삽입
- `window.openLibraryInfoModal = function() { ... }` 등록 유지

---

## 5) Step 3: app.js 수정

### 5-1. 코드 제거

| 대상 | 라인 | 크기 |
|------|------|------|
| `openLibraryInfoModal` | 5459-5518 | ~60줄 |
| Pomodoro IIFE | 11024-11469 | ~446줄 |
| Library IIFE | 11474-14109 | ~2,636줄 |

### 5-2. Module Bridge 확장

기존 Bridge 블록 (삭제 후 위치 변동)에 추가:

```javascript
// 뽀모도로/서재 모듈용 추가 노출
window.showToast = showToast;
window.showInAppNotification = showInAppNotification;
```

### 5-3. 동적 import 추가

기존 import 블록에 추가:

```javascript
// --- Pomodoro 모듈 동적 로드 ---
import('./modules/pomodoro.js').catch(e => console.error('[Pomodoro] 모듈 로드 실패:', e));

// --- Library 모듈 동적 로드 ---
import('./modules/library.js').catch(e => console.error('[Library] 모듈 로드 실패:', e));
```

### 5-4. 호출부 수정

app.js 본문에서 Pomodoro/Library 함수를 직접 호출하는 부분이 있다면 방어적 가드 추가:

```javascript
// 예시
if (window.updateLibraryCardCount) window.updateLibraryCardCount();
```

**참고:** 두 IIFE 모두 자체 격리되어 있어 app.js 본문에서 직접 호출하는 경우는 거의 없을 것으로 예상. 구현 시점에 grep 확인 필요.

---

## 6) Step 4: www 동기화 & 검증

### 6-1. www/ 동기화

```bash
cp modules/pomodoro.js www/modules/pomodoro.js
cp modules/library.js www/modules/library.js
cp app.js www/app.js
```

(`sync-www.sh`는 이미 modules/ 디렉토리 rsync 지원 — `refactor-ad-social-module-separation.md` Phase 3에서 적용됨)

### 6-2. 구문 검증

```bash
node --check modules/pomodoro.js
node --check modules/library.js
node --check app.js
```

### 6-3. 기능 검증 체크리스트

| 영역 | 검증 항목 |
|------|-----------|
| 앱 로드 | 콘솔 에러 없음 |
| 뽀모도로 | 시작 → 일시정지 → 재개 → 리셋 |
| 뽀모도로 | 설정 모달 열기 → 값 변경 → 저장 → 반영 확인 |
| 뽀모도로 | 4세트 완료 → 보상 +10P & AGI +0.3 지급 확인 |
| 뽀모도로 | 네이티브 로컬 알림 (Capacitor) 정상 발화 |
| 서재 | 서재 열기 → 닫기 |
| 서재 | ISBN 바코드 스캔 → 책 정보 조회 → 추가 |
| 서재 | 수동 ISBN 입력 → 조회 → 추가 |
| 서재 | 책 검색 → 결과에서 추가 |
| 서재 | 카테고리 변경 (읽고있는책/읽은책/읽고싶은책) |
| 서재 | 책 삭제 |
| 서재 | 날짜 필터 (전체/연간/월간) |
| 서재 | 뷰 모드 전환 (그리드/리스트) |
| 서재 | 서재 이미지 공유 |
| 서재 | 서재 가이드 모달 (`openLibraryInfoModal`) |
| 기존 모듈 | 광고 (AdManager) 정상 |
| 기존 모듈 | 소셜 (SocialModule) 정상 |
| 기존 모듈 | 운동 계산기 (ExerciseCalc) 정상 |

---

## 7) 수정 대상 파일 요약

| 파일 | 작업 | 상태 |
|------|------|------|
| `modules/pomodoro.js` | **신규 생성** — 뽀모도로 IIFE (~446줄) | ⬜ 미구현 |
| `modules/library.js` | **신규 생성** — 서재 IIFE (~2,696줄, openLibraryInfoModal 포함) | ⬜ 미구현 |
| `app.js` | IIFE 삭제 (~3,142줄) + openLibraryInfoModal 삭제 (~60줄) + Module Bridge 확장 (2줄) + 동적 import 추가 (6줄) | ⬜ 미구현 |
| `www/modules/pomodoro.js` | www 동기화 | ⬜ 미구현 |
| `www/modules/library.js` | www 동기화 | ⬜ 미구현 |
| `www/app.js` | www 동기화 | ⬜ 미구현 |

---

## 8) 예상 결과

### 8-1. 정량적 변화

| 지표 | 현재 | 목표 |
|------|------|------|
| app.js 라인 수 | 14,154줄 | **~10,950줄** |
| modules/ 파일 수 | 3개 | **5개** |
| 모듈 추출 총 라인 | 2,636줄 | **5,778줄** |
| 원본 대비 추출 비율 | 16% | **35%** |

### 8-2. 모듈 최종 구성

```
modules/
├── ad-manager.js      (875줄)  → window.AdManager         ✅ 완료
├── social.js          (283줄)  → window.SocialModule       ✅ 완료
├── exercise-calc.js   (1,478줄) → window.ExerciseCalcModule ✅ 완료
├── pomodoro.js        (~446줄) → window.togglePomodoro 등   ⬜ 미구현
└── library.js         (~2,696줄) → window.openLibraryView 등 ⬜ 미구현
```

---

## 9) 리스크 분석

| 리스크 | 영향도 | 확률 | 완화 전략 |
|--------|--------|------|-----------|
| DOMContentLoaded 타이밍 | 중 | 낮 | `document.readyState` 체크 패턴 적용 (exercise-calc.js 선례) |
| Library IIFE 내 미파악 외부 참조 | 중 | 중 | 구현 시점에 IIFE 전체 코드 정밀 스캔, 누락 시 Bridge 추가 |
| `openLibraryInfoModal` 위치 이동 | 낮 | 낮 | `window.openLibraryInfoModal` 등록 유지, HTML onclick 호환 |
| 로드 순서 | 낮 | 매우 낮 | Pomodoro/Library는 다른 모듈과 상호 의존 없음 |
| Capacitor 플러그인 접근 | 낮 | 매우 낮 | `window.Capacitor` 직접 참조, Module Bridge 불필요 |

---

## 10) 향후 추출 대상 (본 계획 이후)

본 계획의 Pomodoro + Library 추출 완료 후, app.js에는 더 이상 자체 격리 IIFE가 없음. 이후 추출은 `app_js_도메인_모듈_분리_검토_보고서.md`의 Phase 2-5 계획을 따르며, 도메인 간 결합이 존재하므로 core 모듈(state.js, firebase-init.js, utils.js) 분리가 선행 필요.

| 대상 | 예상 크기 | 난이도 | 비고 |
|------|----------|--------|------|
| core/state.js | ~60줄 | 낮 | AppState 분리 (모든 모듈의 기반) |
| core/firebase-init.js | ~40줄 | 낮 | Firebase SDK 중앙화 |
| core/utils.js | ~50줄 | 낮 | sanitize, date helpers |
| raid-dungeon.js | ~500줄 | 중 | switchTab() 결합점 주의 |
| planner.js | ~1,050줄 | 중 | 가장 큰 비-IIFE 도메인 |
| reels.js | ~1,080줄 | 중 | 위치 태그, 반응/댓글 시스템 |
| auth.js | ~720줄 | 높 | 인증 플로우 전체 영향 |

---

*본 문서는 검토 계획이며, 구현은 별도 승인 후 진행합니다.*
