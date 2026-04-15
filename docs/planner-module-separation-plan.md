# Planner 도메인 모듈 분리 계획

- 대상 앱: **LEVEL UP: REBOOT**
- 작성일: **2026-04-15**
- 참고: `app_js_도메인_모듈_분리_검토_보고서.md`, `quest-module-separation-plan.md`
- 목적: app.js 내 플래너/다이어리 도메인 코드를 `modules/planner.js`로 분리  
- 선행 조건: `modules/quest.js` 분리 완료 후 진행 권장 (크로스 도메인 결합 처리 필요)

---

## 1) 현황 분석

### 1-1. 현재 상태

| 항목 | 수치 |
|---|---:|
| app.js 라인 수 (Quest 분리 후 기준) | ~8,584줄 |
| Planner 도메인 추출 예정 라인 | ~1,574줄 |
| 추출 후 예상 app.js | ~7,010줄 |

### 1-2. 추출 대상 섹션 (app.js 원본 라인 기준)

| # | 섹션 | 라인 범위 | 크기 |
|---:|---|---|---:|
| 1 | 프로필에서 당일 플래너 열람 | 5657-5723 | ~67줄 |
| 2 | 플래너 안내 모달 | 6553-6618 | ~66줄 |
| 3 | 플래너 공유 모달 및 이미지 저장 | 6676-7148 | ~473줄 |
| 4 | 플래너 코어 (타임박스 + 우선순위 + 일정 복사) | 7283-8155 | ~873줄 |
| 5 | 플래너 사진 기능 | 8157-8250 | ~94줄 |

**추출 합계: 약 1,573줄**

---

## 2) 외부 의존성 매핑

| 현재 참조 | Module Bridge 매핑 | 상태 |
|---|---|---|
| `AppState` | `window.AppState` | ✅ 이미 노출 |
| `i18n` | `window.i18n` | ✅ 이미 노출 |
| `auth` | `window._auth` | ✅ 이미 노출 |
| `db` | `window._db` | ✅ 이미 노출 |
| `setDoc` | `window._setDoc` | ✅ 이미 노출 |
| `doc` | `window._doc` | ✅ 이미 노출 |
| `getDoc` | `window._getDoc` | ✅ 이미 노출 |
| `getDocs` | `window._getDocs` | ✅ 이미 노출 |
| `collection` | `window._collection` | ✅ 이미 노출 |
| `saveUserData()` | `window.saveUserData` | ✅ 이미 노출 |
| `updatePointUI()` | `window.updatePointUI` | ✅ 이미 노출 |
| `drawRadarChart()` | `window.drawRadarChart` | ✅ 이미 노출 |
| `getTodayStr()` | `window.getTodayStr` | ✅ 이미 노출 |
| `getTodayKST()` | `window.getTodayKST` | ✅ 이미 노출 |
| `getWeekStartDate()` | `window.getWeekStartDate` | ✅ 이미 노출 |
| `isNativePlatform` | `window.isNativePlatform` | ✅ 이미 노출 |
| `uploadImageToStorage()` | `window.uploadImageToStorage` | ✅ 이미 노출 |
| `compressBase64Image()` | `window.compressBase64Image` | ✅ 이미 노출 |
| `hideUploadProgress()` | `window.hideUploadProgress` | ✅ 이미 노출 |
| `createUploadProgressCallback()` | `window.createUploadProgressCallback` | ✅ 이미 노출 |
| `getImageExtension()` | `window.getImageExtension` | ✅ 이미 노출 |
| `getThumbnailURL()` | `window.getThumbnailURL` | ✅ 이미 노출 |
| `isBase64Image()` | `window.isBase64Image` | ✅ 이미 노출 |
| `DEFAULT_PROFILE_SVG` | `window.DEFAULT_PROFILE_SVG` | ✅ 이미 노출 |
| `sanitizeText()` | `window.sanitizeText` | ✅ 이미 노출 |
| `sanitizeAttr()` | `window.sanitizeAttr` | ✅ 이미 노출 |
| `showInAppNotification()` | `window.showInAppNotification` | ✅ 이미 노출 |
| `buildUserTitleBadgeHTML()` | `window.buildUserTitleBadgeHTML` | ✅ 이미 노출 |
| `switchTab()` | `window.switchTab` | ✅ 이미 노출 |
| `getMsUntilNextKSTMidnight()` | `window.getMsUntilNextKSTMidnight` | ✅ 이미 노출 |
| `formatCountdown()` | `window.formatCountdown` | ✅ 이미 노출 |

**신규 Bridge 추가 불필요** — 모든 외부 의존이 기존 Bridge에 포함됨.

---

## 3) 상태 변수 이동 대상

플래너 모듈로 이동할 `let` 변수 (app.js line 7283-7290):

| 변수 | 초기값 | 역할 |
|---|---|---|
| `diarySelectedDate` | `getTodayStr()` | 현재 선택된 플래너 날짜 |
| `plannerWeekOffset` | `0` | 주간 캘린더 주 오프셋 |
| `monthlyCalendarYear` | `new Date().getFullYear()` | 월간 캘린더 연도 |
| `monthlyCalendarMonth` | `new Date().getMonth()` | 월간 캘린더 월 |
| `_monthlyCalendarUnlocked` | `false` | 오늘 광고 시청 완료 여부 |
| `plannerTasks` | `Array(6).fill(...)` | 플래너 과제 목록 |
| `plannerPhotoData` | `null` | 플래너 사진 (base64 또는 URL) |

---

## 4) 크로스 도메인 결합점

### 4-1. Planner ← Quest 방향

`savePlannerEntry` 내부에서 `renderPlannerDiyQuests()`를 호출 (line 8020).  
Quest 모듈로 이동 후 `window.renderPlannerDiyQuests`로 등록됨.

| 호출 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| `savePlannerEntry()` line 8020 | `renderPlannerDiyQuests()` | `if (window.renderPlannerDiyQuests) window.renderPlannerDiyQuests()` |

### 4-2. Planner ← app.js 방향

`switchTab` 및 `changeLanguage`에서 플래너 함수를 직접 호출.

| 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| `switchTab()` line 4924 | `renderPlannerCalendar(); loadPlannerForDate(diarySelectedDate);` | `window.renderPlannerCalendar?.(); window.loadPlannerForDate?.(window.diarySelectedDate);` |
| `changeLanguage()` line 5058 | `renderPlannerCalendar();` | `window.renderPlannerCalendar?.();` |

### 4-3. app.js Bridge 변경 (planner.js로 이동하는 노출)

| 제거 항목 | 이유 |
|---|---|
| `window.getDiaryEntry = getDiaryEntry;` (line 9820) | planner.js에서 재등록 |
| `Object.defineProperty(window, 'plannerPhotoData', ...)` (lines 9822-9825) | planner.js에서 재등록 |
| `Object.defineProperty(window, 'diarySelectedDate', ...)` (lines 9826-9829) | planner.js에서 재등록 |

---

## 5) `modules/planner.js` 설계

### 5-1. 파일 구조

```javascript
// modules/planner.js
(function() {
    'use strict';

    // ── 1. 상태 변수 ────────────────────────────────────────────
    let diarySelectedDate = window.getTodayStr ? window.getTodayStr() : new Date().toISOString().slice(0,10);
    let plannerWeekOffset = 0;
    let monthlyCalendarYear = new Date().getFullYear();
    let monthlyCalendarMonth = new Date().getMonth();
    let _monthlyCalendarUnlocked = false;
    let plannerTasks = Array(6).fill(null).map(() => ({ text: '', ranked: false, rankOrder: 0 }));
    let plannerPhotoData = null;

    // ── 2. 외부 노출 (reels 모듈 등에서 접근) ───────────────────
    window.getDiaryEntry = getDiaryEntry;
    Object.defineProperty(window, 'plannerPhotoData', {
        get: function() { return plannerPhotoData; }, configurable: true
    });
    Object.defineProperty(window, 'diarySelectedDate', {
        get: function() { return diarySelectedDate; }, configurable: true
    });

    // ── 3. 유틸 ─────────────────────────────────────────────────
    function dateToStr(d) { ... }
    function getDiaryEntry(dateStr) { ... }
    function getAllDiaryEntries() { ... }

    // ── 4. 플래너 캘린더 ─────────────────────────────────────────
    function renderPlannerCalendar() { ... }
    window.renderPlannerCalendar = renderPlannerCalendar;
    window.changePlannerWeek = function(delta) { ... };

    // ── 5. 월간 캘린더 ───────────────────────────────────────────
    function renderMonthlyCalendar(year, month) { ... }
    window.selectMonthlyDate = function(dateStr) { ... };
    window.changeMonthlyCalendar = function(delta) { ... };
    window.openMonthlyCalendar = async function() { ... };
    window.closeMonthlyCalendar = function() { ... };

    // ── 6. 과제 관리 ─────────────────────────────────────────────
    function isSelectedDateFuture() { ... }
    function getTaskOptions() { ... }
    function updateTimeboxDropdownOptions() { ... }
    function renderPlannerTasks() { ... }
    window.renderPlannerTasks = renderPlannerTasks;
    window.toggleTaskRank = function(idx) { ... };
    window.toggleTaskDone = function(idx) { ... };
    window.updateTaskText = function(idx, val) { ... };
    window.addPlannerTask = function() { ... };
    window.removeTask = function(idx) { ... };

    // ── 7. 날짜 복사/적용 ────────────────────────────────────────
    function getPrevDateStr(dateStr) { ... }
    window.copyPrevDayTasks = function(checked) { ... };
    window.copyPrevDaySchedule = function(checked) { ... };
    window.openApplyTodayModal = function() { ... };
    window.closeApplyTodayModal = function() { ... };
    window.confirmApplyToday = function() { ... };

    // ── 8. 타임박스 그리드 ───────────────────────────────────────
    function renderTimeboxGrid(dateStr) { ... }

    // ── 9. 날짜 선택 및 로드 ─────────────────────────────────────
    window.selectPlannerDate = function(dateStr) { ... };
    function loadPlannerForDate(dateStr) { ... }
    window.loadPlannerForDate = loadPlannerForDate;

    // ── 10. 저장 ─────────────────────────────────────────────────
    async function savePlannerEntry() {
        // ...
        if (window.renderPlannerDiyQuests) window.renderPlannerDiyQuests(); // Quest 모듈 호출
        // ...
    }
    window.savePlannerEntry = savePlannerEntry;

    // ── 11. 사진 기능 ────────────────────────────────────────────
    function loadPlannerPhoto(e) { ... }
    window.removePlannerPhoto = function() { ... };
    function getCaptionByteLength(str) { ... }
    window.updateCaptionCounter = function() { ... };

    // ── 12. 공유 기능 ────────────────────────────────────────────
    window.openShareModal = function() { ... };
    function showImageOverlay(dataUrl, lang) { ... }
    window.sharePlannerAsImage = async function() { ... };
    async function _writeToClipboard(text) { ... }
    window.sharePlannerLink = async function() { ... };

    // ── 13. 프로필 → 당일 플래너 열람 ───────────────────────────
    async function viewUserTodayPlanner(userId) { ... }
    window.viewUserTodayPlanner = viewUserTodayPlanner;

    // ── 14. 안내 모달 ────────────────────────────────────────────
    function openPlannerInfoModal() { ... }
    window.openPlannerInfoModal = openPlannerInfoModal;

    // ── 15. 초기화 ───────────────────────────────────────────────
    function initPlanner() {
        const saveBtn = document.getElementById('btn-planner-save');
        if (saveBtn) saveBtn.addEventListener('click', savePlannerEntry);
        const prioritySaveBtn = document.getElementById('btn-priority-save');
        if (prioritySaveBtn) prioritySaveBtn.addEventListener('click', savePlannerEntry);
        const photoInput = document.getElementById('planner-photo-input');
        if (photoInput) photoInput.addEventListener('change', loadPlannerPhoto);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPlanner);
    } else {
        initPlanner();
    }
})();
```

### 5-2. window 등록 목록 (HTML onclick 호환)

| 함수 | 용도 |
|---|---|
| `window.changePlannerWeek` | 주간 캘린더 이전/다음 주 이동 |
| `window.selectMonthlyDate` | 월간 캘린더 날짜 선택 |
| `window.changeMonthlyCalendar` | 월간 캘린더 월 이동 |
| `window.openMonthlyCalendar` | 월간 캘린더 열기 (광고 게이트) |
| `window.closeMonthlyCalendar` | 월간 캘린더 닫기 |
| `window.toggleTaskRank` | 과제 순위 토글 |
| `window.toggleTaskDone` | 과제 완료 체크 |
| `window.updateTaskText` | 과제 텍스트 수정 |
| `window.addPlannerTask` | 과제 추가 |
| `window.removeTask` | 과제 삭제 |
| `window.copyPrevDayTasks` | 전날 과제 복사 |
| `window.copyPrevDaySchedule` | 전날 일정 복사 |
| `window.openApplyTodayModal` | 선택일 플랜 → 오늘 적용 모달 |
| `window.closeApplyTodayModal` | 적용 모달 닫기 |
| `window.confirmApplyToday` | 오늘 적용 확인 |
| `window.selectPlannerDate` | 날짜 셀 클릭 |
| `window.removePlannerPhoto` | 사진 제거 |
| `window.updateCaptionCounter` | 캡션 글자 수 카운터 갱신 |
| `window.openShareModal` | 공유 모달 열기 |
| `window.sharePlannerAsImage` | 플래너 이미지 공유 |
| `window.sharePlannerLink` | 플래너 링크 공유 |
| `window.viewUserTodayPlanner` | 다른 유저 플래너 보기 |
| `window.openPlannerInfoModal` | 플래너 안내 모달 |

**내부 함수이지만 외부 호출 필요:**

| 함수 | 호출 출처 |
|---|---|
| `window.getDiaryEntry` | reels 모듈, switchTab (리스 포스팅 시) |
| `window.renderPlannerCalendar` | `switchTab`, `changeLanguage` |
| `window.loadPlannerForDate` | `switchTab` |
| `window.renderPlannerTasks` | `toggleDiyQuest` (quest 모듈에서 호출) |
| `window.savePlannerEntry` | (이벤트 리스너로 처리하지만 안전을 위해 노출) |
| `window.plannerPhotoData` | reels 모듈 (Object.defineProperty) |
| `window.diarySelectedDate` | switchTab (Object.defineProperty) |

---

## 6) app.js 수정 사항

### 6-1. 코드 제거 대상

| 대상 | 라인 (원본) | 크기 |
|---|---|---:|
| `viewUserTodayPlanner()` + `window.viewUserTodayPlanner` | 5657-5723 | ~67줄 |
| `openPlannerInfoModal()` 주석 ~ 함수 끝 | 6553-6618 | ~66줄 |
| `openShareModal()` ~ `sharePlannerLink` | 6676-7148 | ~473줄 |
| `// --- ★ 플래너 기능 ---` ~ `getCaptionByteLength` + `updateCaptionCounter` | 7283-8250 | ~968줄 |

**총 제거: ~1,574줄**

### 6-2. Module Bridge 수정

```javascript
// 제거: planner.js 에서 재등록하므로 app.js에서는 제거
// window.getDiaryEntry = getDiaryEntry;           ← 삭제
// Object.defineProperty(window, 'plannerPhotoData', ...);  ← 삭제
// Object.defineProperty(window, 'diarySelectedDate', ...); ← 삭제
```

### 6-3. 직접 함수 호출 → window-based 호출로 변경

| 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| `switchTab()` line 4924 | `renderPlannerCalendar(); loadPlannerForDate(diarySelectedDate);` | `window.renderPlannerCalendar?.(); window.loadPlannerForDate?.(window.diarySelectedDate);` |
| `changeLanguage()` line 5058 | `renderPlannerCalendar();` | `window.renderPlannerCalendar?.();` |

### 6-4. 이벤트 리스너 변경 (DOMContentLoaded 내)

```javascript
// 제거: planner.js initPlanner()에서 등록하므로 app.js에서는 제거
// document.getElementById('btn-planner-save').addEventListener('click', savePlannerEntry);
// document.getElementById('btn-priority-save')?.addEventListener('click', savePlannerEntry);
```

### 6-5. 동적 import 추가

```javascript
// --- Planner 모듈 동적 로드 ---
import('./modules/planner.js').catch(e => console.error('[Planner] 모듈 로드 실패:', e));
```

### 6-6. 주석 추가 (제거된 위치에)

```javascript
// --- Planner / Diary: modules/planner.js로 분리됨 ---
```

---

## 7) 구현 순서 (Quest 분리 완료 후)

```
Step 1: modules/quest.js 구현 완료 확인
Step 2: modules/planner.js 생성 (본 계획 기준)
Step 3: app.js 수정
  3-1. Planner 코드 섹션 제거 (5개 블록)
  3-2. Module Bridge에서 3개 항목 제거 (plannerPhotoData, diarySelectedDate, getDiaryEntry)
  3-3. switchTab, changeLanguage 직접 호출 → window-based 옵셔널 체이닝
  3-4. DOMContentLoaded 이벤트 리스너 제거 (savePlannerEntry 2개)
  3-5. 동적 import 추가
Step 4: 구문 검증 및 기능 테스트
```

---

## 8) 검증 체크리스트

| 영역 | 검증 항목 |
|---|---|
| 앱 로드 | 콘솔 에러 없음 |
| 플래너 탭 | 주간 캘린더 렌더링 |
| 플래너 탭 | 날짜 선택 → 타임박스 / 우선순위 탭 전환 |
| 플래너 탭 | 타임박스 시간대 클릭 → 과제 입력 |
| 플래너 탭 | 우선순위 과제 추가/삭제/체크/순위 변경 |
| 플래너 탭 | 전날 과제 복사 / 전날 일정 복사 |
| 플래너 탭 | 선택일 플랜 → 오늘 적용 |
| 플래너 탭 | 사진 업로드 → 압축 → 저장 |
| 플래너 탭 | 저장 → +20P & AGI +0.5 보상 (일 1회) |
| 플래너 탭 | 월간 캘린더 열기 (보상형 광고 게이트) |
| DIY 연동 | DIY 퀘스트가 플래너 과제 목록에 표시 |
| DIY 연동 | 플래너에서 DIY 퀘스트 체크 → 퀘스트 탭 상태 반영 |
| 공유 | 플래너 이미지 저장/공유 |
| 공유 | 플래너 링크 복사 |
| 프로필 | 다른 유저 프로필 → 당일 플래너 보기 |
| 언어 전환 | 플래너 캘린더, 타임박스, 과제 다국어 정상 갱신 |
| reels 연동 | 플래너 사진 Day1 포스팅 정상 동작 |

---

## 9) 예상 결과

| 지표 | Quest 분리 후 | Planner 분리 후 |
|---|---:|---:|
| app.js 라인 수 | ~8,584줄 | **~7,010줄** |
| 제거 라인 | - | ~1,574줄 (18.3%↓) |
| modules/ 파일 수 | 15개 | **16개** |
| 원본 대비 총 추출 | 기존 14 모듈 | **Quest + Planner 포함 16개** |

---

## 10) 리스크 분석

| 리스크 | 영향도 | 확률 | 완화 전략 |
|---|---|---|---|
| `window.diarySelectedDate` 미정의 시 switchTab | 높음 | 낮음 | `window.loadPlannerForDate?.(window.diarySelectedDate)` 옵셔널 체이닝 |
| plannerPhotoData Object.defineProperty 이중 등록 | 중간 | 낮음 | `configurable: true` 설정 유지, app.js에서 기존 항목 제거 확인 |
| DOMContentLoaded 이벤트 리스너 중복 | 중간 | 낮음 | app.js init 블록에서 savePlannerEntry 리스너 제거 체크리스트 확인 |
| `savePlannerEntry` Firestore 쓰기 타이밍 | 낮음 | 매우 낮음 | 비동기 함수 패턴 유지, `window._setDoc` 경유로 일관성 보장 |
| reels 모듈 `window.getDiaryEntry` 의존 | 높음 | 낮음 | planner.js에서 최초 등록 시점 보장 (동적 import는 planner → reels 순서 유지) |

---

*본 문서는 검토 계획이며, 구현은 별도 승인 후 진행합니다.*
