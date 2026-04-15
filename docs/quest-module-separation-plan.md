# Quest 도메인 모듈 분리 계획

- 대상 앱: **LEVEL UP: REBOOT**
- 작성일: **2026-04-15**
- 참고: `app_js_도메인_모듈_분리_검토_보고서.md`, `iife-module-additional-separation-plan.md`
- 목적: app.js 내 퀘스트 도메인(일반 퀘스트 + DIY 퀘스트 + 통계) 코드를 `modules/quest.js`로 분리

---

## 1) 현황 분석

### 1-1. 현재 상태

| 항목 | 수치 |
|---|---:|
| app.js 현재 라인 수 | 9,886줄 |
| Quest 도메인 추출 예정 라인 | ~1,303줄 |
| 추출 후 예상 app.js | ~8,583줄 |

### 1-2. 추출 대상 섹션 (app.js 라인 기준)

| # | 섹션 | 라인 범위 | 크기 |
|---:|---|---|---:|
| 1 | 크리티컬 히트 헬퍼 | 2986-3001 | ~16줄 |
| 2 | 루트 드롭 함수 + checkDailyAllClear | 3003-3078 | ~76줄 |
| 3 | 퀘스트 목록 / DIY 퀘스트 | 3315-3644 | ~330줄 |
| 4 | 퀘스트 통계 (Qstats) | 3646-4355 | ~710줄 |
| 5 | 퀘스트 안내 모달 (`openQuestInfoModal`) | 6287-6402 | ~116줄 |
| 6 | DIY 안내 모달 (`openDiyQuestInfoModal`) | 6404-6456 | ~53줄 |

**추출 합계: 약 1,301줄**

---

## 2) 외부 의존성 매핑

모든 외부 참조는 `window.*` 경유. 신규 추가 필요한 Bridge 노출은 ❌로 표시.

| 현재 참조 | Module Bridge 매핑 | 상태 |
|---|---|---|
| `AppState` | `window.AppState` | ✅ 이미 노출 |
| `i18n` | `window.i18n` | ✅ 이미 노출 |
| `statKeys` | `window.statKeys` | ✅ 이미 노출 |
| `weeklyQuestData` | 전역 (data.js 비모듈 로드) | ✅ 전역 접근 가능 |
| `lootTable` | 전역 (data.js 비모듈 로드) | ✅ 전역 접근 가능 |
| `getTodayStr()` | `window.getTodayStr` | ✅ 이미 노출 |
| `getTodayKST()` | `window.getTodayKST` | ✅ 이미 노출 |
| `saveUserData()` | `window.saveUserData` | ✅ 이미 노출 |
| `updatePointUI()` | `window.updatePointUI` | ✅ 이미 노출 |
| `drawRadarChart()` | `window.drawRadarChart` | ✅ 이미 노출 |
| `checkRankRareTitles()` | `window.checkRankRareTitles` | ✅ 이미 노출 |
| `updateStreak()` | `window.updateStreak` | ❌ **Bridge 추가 필요** |

---

## 3) 크로스 도메인 결합점

퀘스트 모듈은 플래너 모듈의 `renderPlannerTasks()`를 호출한다.  
`toggleDiyQuest` 완료 시 플래너 탭의 DIY 퀘스트 체크 상태를 즉시 반영하기 위함.

| 호출 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| `toggleDiyQuest` 내부 | `renderPlannerTasks()` | `if (window.renderPlannerTasks) window.renderPlannerTasks()` |

**반대 방향:** 플래너 모듈의 `savePlannerEntry`가 `renderPlannerDiyQuests()`를 호출.  
Quest 모듈에서 `window.renderPlannerDiyQuests`로 등록하여 플래너가 방어적으로 호출 가능하도록 설계.

---

## 4) `modules/quest.js` 설계

### 4-1. 파일 구조

```javascript
// modules/quest.js
(function() {
    'use strict';

    // ── 1. Private: 크리티컬 히트 헬퍼 ──────────────────────────
    function rollCritical() { ... }
    function getCriticalMultiplier() { ... }
    function showCriticalFlash() { ... }

    // ── 2. Private: 루트 드롭 ────────────────────────────────────
    function rollLootDrop() { ... }
    function applyLootReward(loot) { ... }
    function showLootModal(loot) { ... }

    // ── 3. Public: 일일 올클리어 체크 ───────────────────────────
    function checkDailyAllClear() { ... }
    window.checkDailyAllClear = checkDailyAllClear;

    // ── 4. Public: 퀘스트 목록 렌더링 ───────────────────────────
    function renderQuestList() { ... }
    window.renderQuestList = renderQuestList;

    function updateQuestHistory() { ... }

    // ── 5. Public: 퀘스트 토글 (HTML onclick 호환) ──────────────
    window.toggleQuest = (i) => { ... };

    // ── 6. DIY 퀘스트 ────────────────────────────────────────────
    function checkDiyDailyReset() { ... }
    function renderDiyQuestList() { ... }
    function renderPlannerDiyQuests() { ... }
    window.renderPlannerDiyQuests = renderPlannerDiyQuests;

    window.toggleDiyQuest = (questId) => {
        // ...
        if (window.renderPlannerTasks) window.renderPlannerTasks(); // 크로스 도메인 호출
        // ...
    };
    window.showDiyQuestModal = ...;
    window.saveDiyQuest = ...;
    window.deleteDiyQuest = ...;
    window.closeDiyQuestModal = ...;
    window.selectDiyStat = ...;

    // ── 7. 퀘스트 주간 캘린더 ────────────────────────────────────
    function renderCalendar() { ... }
    window.renderCalendar = renderCalendar;

    // ── 8. 퀘스트 통계 (Qstats) ─────────────────────────────────
    let _qstatsMonth = new Date();
    // ... 상태 변수들

    function renderQstatsCalendar() { ... }
    window.changeQstatsWeek = ...;
    window.openQstatsMonthly = ...;
    window.closeQstatsMonthly = ...;
    window.selectQstatsDate = ...;
    // ... 기타 Qstats 함수들

    function renderQuestStats() { ... }
    window.renderQuestStats = renderQuestStats;

    // ── 9. 안내 모달 ─────────────────────────────────────────────
    function openQuestInfoModal() { ... }
    window.openQuestInfoModal = openQuestInfoModal;

    function openDiyQuestInfoModal() { ... }
    window.openDiyQuestInfoModal = openDiyQuestInfoModal;

    // ── 10. 초기화 ───────────────────────────────────────────────
    function initQuest() {
        // 필요 시 초기화 로직
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initQuest);
    } else {
        initQuest();
    }
})();
```

### 4-2. window 등록 목록 (HTML onclick 호환)

| 함수 | 용도 |
|---|---|
| `window.toggleQuest` | 퀘스트 완료 토글 |
| `window.toggleDiyQuest` | DIY 퀘스트 완료 토글 |
| `window.showDiyQuestModal` | DIY 퀘스트 추가/수정 모달 |
| `window.saveDiyQuest` | DIY 퀘스트 저장 |
| `window.deleteDiyQuest` | DIY 퀘스트 삭제 |
| `window.closeDiyQuestModal` | DIY 모달 닫기 |
| `window.selectDiyStat` | DIY 스탯 선택 |
| `window.changeQstatsWeek` | 통계 탭 주간 이동 |
| `window.openQstatsMonthly` | 통계 월간 뷰 열기 |
| `window.closeQstatsMonthly` | 통계 월간 뷰 닫기 |
| `window.selectQstatsDate` | 통계 날짜 선택 |
| `window.toggleQstatsDailyDropdown` | 통계 드롭다운 토글 |
| `window.selectQstatsDailyQuest` | 통계 데일리 퀘스트 선택 |
| `window.toggleQstatsDiyDropdown` | DIY 통계 드롭다운 토글 |
| `window.selectQstatsDiyQuest` | DIY 통계 퀘스트 선택 |
| `window.openQuestInfoModal` | 퀘스트 안내 모달 열기 |
| `window.openDiyQuestInfoModal` | DIY 퀘스트 안내 모달 열기 |

**내부 함수이지만 외부 호출 필요 (app.js, planner 모듈에서 호출):**

| 함수 | 호출 출처 |
|---|---|
| `window.renderQuestList` | `switchTab`, DOMContentLoaded init, `changeLanguage` |
| `window.renderCalendar` | `switchTab`, DOMContentLoaded init, `changeLanguage` |
| `window.renderQuestStats` | `switchTab` (퀘스트 통계 탭 전환 시) |
| `window.renderPlannerDiyQuests` | `savePlannerEntry` (planner 모듈에서 방어적 호출) |
| `window.checkDailyAllClear` | (내부 전용이지만 안전을 위해 노출) |

---

## 5) app.js 수정 사항

### 5-1. 코드 제거 대상

| 대상 | 라인 | 크기 |
|---|---|---:|
| `// --- 크리티컬 히트 & 루트 드롭 ---` ~ `showLootModal()` | 2985-3056 | ~72줄 |
| `checkDailyAllClear()` | 3058-3078 | ~21줄 |
| `renderQuestList()` ~ `renderCalendar()` | 3315-3644 | ~330줄 |
| `// --- 퀘스트 통계 렌더링 ---` ~ `renderAnnualChart()` | 3646-4355 | ~710줄 |
| `openQuestInfoModal()` | 6287-6402 | ~116줄 |
| `openDiyQuestInfoModal()` | 6404-6456 | ~53줄 |

**총 제거: ~1,302줄**

### 5-2. Module Bridge 수정

```javascript
// 추가 (app.js Module Bridge 블록에 삽입)
window.updateStreak = updateStreak;   // Quest 모듈의 toggleQuest/toggleDiyQuest에서 필요
```

### 5-3. 직접 함수 호출 → window-based 호출로 변경

| 위치 | 현재 코드 | 변경 후 |
|---|---|---|
| `switchTab()` line 4923 | `renderQuestList(); renderCalendar();` | `window.renderQuestList?.(); window.renderCalendar?.();` |
| DOMContentLoaded init line 1511 | `renderCalendar();` | `window.renderCalendar?.();` |
| DOMContentLoaded init line 1518 | `renderQuestList();` | `window.renderQuestList?.();` |
| `changeLanguage()` lines 5056-5057 | `renderQuestList(); renderCalendar();` | `window.renderQuestList?.(); window.renderCalendar?.();` |

### 5-4. 동적 import 추가

```javascript
// --- Quest 모듈 동적 로드 ---
import('./modules/quest.js').catch(e => console.error('[Quest] 모듈 로드 실패:', e));
```

### 5-5. 주석 추가 (제거된 위치에)

```javascript
// --- Quest / DIY Quest / Stats: modules/quest.js로 분리됨 ---
```

---

## 6) 검증 체크리스트

| 영역 | 검증 항목 |
|---|---|
| 앱 로드 | 콘솔 에러 없음 |
| 퀘스트 탭 | 퀘스트 목록 정상 렌더링 |
| 퀘스트 탭 | 퀘스트 완료 토글 → 포인트 증가, 스탯 증가 |
| 퀘스트 탭 | 크리티컬 히트 발생 (15% 확률) → 보상 2~3배 |
| 퀘스트 탭 | 일일 올클리어 → 루트 드롭 모달 표시 |
| DIY 퀘스트 | DIY 퀘스트 추가 → 저장 → 목록 표시 |
| DIY 퀘스트 | DIY 퀘스트 완료 토글 → 포인트/스탯 증가 |
| DIY 퀘스트 | DIY 퀘스트 삭제 |
| DIY 퀘스트 | 플래너 탭에서 DIY 퀘스트 체크 → 퀘스트 탭 상태 반영 |
| 퀘스트 통계 | 통계 탭 주간 캘린더 렌더링 |
| 퀘스트 통계 | 이전/다음 주 이동 |
| 퀘스트 통계 | 월간 통계 열기 (보상형 광고 게이트) |
| 퀘스트 통계 | 데일리/DIY 퀘스트 필터 드롭다운 |
| 언어 전환 | 퀘스트 목록, 캘린더, 통계 다국어 정상 갱신 |

---

## 7) 예상 결과

| 지표 | 현재 | 목표 |
|---|---:|---:|
| app.js 라인 수 | 9,886줄 | ~8,584줄 |
| 제거 라인 | - | ~1,302줄 (13.2%↓) |
| modules/ 파일 수 | 14개 | 15개 |

---

## 8) 리스크 분석

| 리스크 | 영향도 | 확률 | 완화 전략 |
|---|---|---|---|
| `updateStreak` Bridge 누락 | 높음 | 낮음 | Step 5-2에서 명시적 추가 |
| `renderPlannerTasks` 미로드 시 toggleDiyQuest | 중간 | 낮음 | `if (window.renderPlannerTasks)` 방어적 호출 |
| switchTab 직접 호출 미변경 | 높음 | 낮음 | Step 5-3 체크리스트로 누락 방지 |
| Qstats 상태 변수(`_qstatsMonth` 등) 초기화 | 낮음 | 낮음 | 모듈 내 let 변수로 유지, 전역 오염 없음 |

---

*본 문서는 검토 계획이며, 구현은 별도 승인 후 진행합니다.*
