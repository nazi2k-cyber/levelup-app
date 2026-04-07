# app.js 저결합 모듈 분리 (광고 → 소셜 순서, IIFE 패턴 유지)

> **상태: ✅ 전체 완료** (Phase 1 · 2 · 3 모두 구현 및 검증 완료)

## Context
app.js가 15,225줄(788KB)의 모놀리식 파일. 소셜 탭과 광고(AdMob) 코드를 별도 IIFE 모듈로 추출하여 결합도를 낮추고, 기존 exercise-calc.js 모듈 패턴과 일관성을 유지한다.

## 기존 모듈 패턴 (exercise-calc.js 참고)
- IIFE `(function() { 'use strict'; ... })()` 패턴
- `window` 객체에 함수 부착
- app.js 말미에서 `import('./modules/exercise-calc.js')` 로 동적 로드
- Module Bridge (app.js line 14112)에서 `window.AppState`, `window.saveUserData` 등 공유 상태 노출

---

# Phase 1: 광고 모듈 (`modules/ad-manager.js`) ✅ 완료

## 1-1. 추출 대상 코드 (app.js)

| 영역 | 라인 | 내용 |
|------|------|------|
| 광고 상수/상태 | 6849~6877 | AD_UNIT_ID, 상태 플래그 (`_admobInitialized`, `_rewardedAdReady` 등) |
| GDPR/초기화 | 6878~7094 | `resetAdMobConsent()`, `canShowPersonalizedAds()`, `initAdMob()` + 이벤트 리스너 |
| 보상형 광고 | 7096~7117 | `preloadRewardedAd()` |
| 보상형 전면 | 7119~7159 | `preloadRewardedInterstitial()`, `showRewardedInterstitial()` |
| 배너 광고 | 7161~7220 | `_getBannerMargin()`, `showBannerAd()`, `hideBannerAd()` |
| RI 던전 카운터 | 7222~7266 | `getRiDungeonCountToday()`, `incrementRiDungeonCount()`, `applyRewardedInterstitialBonus()` |
| 보너스 EXP | 7268~7458 | `_bonusExpKey()` ~ `applyBonusExpReward()` 전체 |
| 네이티브 광고 | 7460~7691 | `loadAndShowNativeAd()` ~ `cleanupNativeAd()` 전체 |
| 플래너 보상형 | 5131~5176 | `_showPlannerRewardedAd()` |

## 1-2. 결합도 해소 전략

### 게임 로직 콜백 처리
`applyRewardedInterstitialBonus(context)`와 `applyBonusExpReward()`는 게임 스탯(`AppState.user.points`, `AppState.user.pendingStats`, `rouletteSlots`, `getBossRewardMultiplier` 등)에 깊이 의존 → **app.js에 유지**하고 `window` 노출:

```js
// app.js에 유지 + window 노출
window.applyRewardedInterstitialBonus = applyRewardedInterstitialBonus;
window.applyBonusExpReward = applyBonusExpReward;
```

광고 모듈 내부에서는 `window.applyRewardedInterstitialBonus(context)`, `window.applyBonusExpReward()` 로 호출.

### 월간 캘린더 광고 (lines 7860~7921)
기존 코드가 ad 내부 상태(`_admobInitialized`, `_rewardedAdReady`, `_rewardedAdContext` 등)를 직접 조작 → `AdManager.showRewarded({ context, onSuccess, onFail })` 공개 API로 교체.

## 1-3. IIFE 공개 API (`window.AdManager`)

```js
window.AdManager = {
    init,                          // initAdMob()
    canShowPersonalizedAds,
    resetConsent,                  // resetAdMobConsent()
    // 보상형
    preloadRewarded,               // preloadRewardedAd()
    showRewarded,                  // 범용: showRewarded({ context, onSuccess, onFail })
    isRewardedReady,               // () => _rewardedAdReady
    // 보상형 전면
    preloadRewardedInterstitial,
    showRewardedInterstitial,
    isRewardedInterstitialReady,   // () => _rewardedInterstitialReady
    // 배너
    showBanner,                    // showBannerAd()
    hideBanner,                    // hideBannerAd()
    // 네이티브
    loadNativeAd,                  // loadAndShowNativeAd(tabId)
    cleanupNativeAd,
    NATIVE_AD_POSITION,            // 5 (소셜탭)
    REELS_NATIVE_AD_POSITION,      // 3 (Day1탭)
    // 보너스 EXP
    renderBonusExp,
    canClaimBonusExp,
    claimBonusExp,
    // RI 던전 카운터
    getRiDungeonCountToday,
    incrementRiDungeonCount,
    // 플래너 보상형
    showPlannerRewardedAd,
};
// 기존 window 직접 부착 호환
window.claimBonusExp = claimBonusExp;
```

## 1-4. Module Bridge 확장 (app.js, 광고 모듈용)

```js
// 광고 모듈이 필요로 하는 함수/상태
window._db = db;
window._setDoc = setDoc;
window._doc = doc;
window._analytics = analytics;
window._fbLogEvent = fbLogEvent;
window.getMsUntilNextKSTMidnight = getMsUntilNextKSTMidnight;
window.formatCountdown = formatCountdown;
```

## 1-5. app.js 호출부 수정 (광고 관련)

| 위치 | 기존 | 변경 |
|------|------|------|
| L1487 | `renderBonusExp()` | `if(window.AdManager) window.AdManager.renderBonusExp()` |
| L4048 | `showRewardedInterstitial('dungeon')` | `if(window.AdManager) window.AdManager.showRewardedInterstitial('dungeon')` |
| L4063 | `renderBonusExp()` | `if(window.AdManager) window.AdManager.renderBonusExp()` |
| L4070 | `cleanupNativeAd()` | `if(window.AdManager) window.AdManager.cleanupNativeAd()` |
| L4075 | `loadAndShowNativeAd('dungeon')` | `if(window.AdManager) window.AdManager.loadNativeAd('dungeon')` |
| L5106 | `_showPlannerRewardedAd(lang)` | `if(window.AdManager) await window.AdManager.showPlannerRewardedAd(lang)` |
| L6839 | `showRewardedInterstitial('spin')` | `if(window.AdManager) window.AdManager.showRewardedInterstitial('spin')` |
| L7860~7921 | 월간캘린더 직접 ad 상태 조작 | `window.AdManager.showRewarded({...})` 으로 교체 |

## 1-6. app.js에서 제거할 코드

- Lines 5131~5176 (`_showPlannerRewardedAd`)
- Lines 6849~7691 (광고 전체)

## 1-7. 생성 파일

- `/home/user/levelup-app/modules/ad-manager.js` (875줄)
- `/home/user/levelup-app/www/modules/ad-manager.js` (www 동기화)

---

# Phase 2: 소셜 모듈 (`modules/social.js`) ✅ 완료

## 2-1. 추출 대상 코드 (app.js)

| 영역 | 라인 | 내용 |
|------|------|------|
| 소셜 데이터 로드 | 4322~4373 | `fetchSocialData()` |
| 유저 랭킹 렌더링 | 4375~4491 | `renderUsers(criteria, btn)` |
| window 노출 | 4493 | `window.fetchSocialData = fetchSocialData` |
| 프로필 동기화 | 4496~4507 | `updateSocialUserData()` |
| 팔로우 토글 | 4509~4516 | `window.toggleFriend` |
| 모드 전환 | 4518~4523 | `toggleSocialMode()` |
| 팔로우 카운트 | 4525~4543 | `formatFollowCount()`, `updateProfileFollowCounts()` |
| 소셜 탭 이동 | 4545~4550 | `window.goToSocialTab` |

## 2-2. 의존성

### 소셜 모듈이 참조하는 window 전역 (Module Bridge 통해 노출 필요)
- **Firestore**: `db`, `getDocs`, `collection`, `setDoc`, `doc`, `arrayUnion`, `arrayRemove`
- **Auth**: `auth` (= `window._auth`)
- **State**: `AppState`, `i18n`
- **UI 헬퍼**: `sanitizeText`, `sanitizeURL`, `sanitizeAttr`, `sanitizeInstaId`, `buildUserTitleBadgeHTML`
- **게임 로직**: `checkRankRareTitles`, `switchTab`, `renderReelsFeed`, `openProfileStatsModal`
- **광고 모듈**: `window.AdManager.NATIVE_AD_POSITION`, `window.AdManager.loadNativeAd`

### 소셜 모듈을 호출하는 app.js 내 코드
- L1483: 로그인 후 `fetchSocialData()`
- L1710~1711: 이벤트 리스너 바인딩 (`toggleSocialMode`, `renderUsers`)
- L2882, 2897, 4925: 프로필 변경 시 `updateSocialUserData()`
- L4078: 탭 전환 시 `fetchSocialData()`
- L4211: 테마 변경 시 `renderUsers()`
- L9363, 9386~9387: Reels에서 `toggleFriend`, `formatFollowCount` 사용

## 2-3. IIFE 공개 API (`window.SocialModule`)

```js
window.SocialModule = {
    fetchData,           // fetchSocialData
    renderUsers,
    updateUserData,      // updateSocialUserData
    toggleFriend,
    toggleMode,          // toggleSocialMode
    formatFollowCount,
    updateFollowCounts,  // updateProfileFollowCounts
    goToTab,             // goToSocialTab
};

// HTML onclick 호환 (기존 window 직접 부착 유지)
window.fetchSocialData = fetchData;
window.toggleFriend = toggleFriend;
window.goToSocialTab = goToTab;
```

## 2-4. Module Bridge 확장 (app.js, 소셜 모듈용)

```js
// 소셜 모듈이 필요로 하는 추가 함수/상태
window._getDocs = getDocs;
window._collection = collection;
window._arrayUnion = arrayUnion;
window._arrayRemove = arrayRemove;
window.switchTab = switchTab;
window.sanitizeText = sanitizeText;
window.sanitizeURL = sanitizeURL;
window.sanitizeAttr = sanitizeAttr;
window.sanitizeInstaId = sanitizeInstaId;
window.buildUserTitleBadgeHTML = buildUserTitleBadgeHTML;
window.checkRankRareTitles = checkRankRareTitles;
window.renderReelsFeed = renderReelsFeed;
```

## 2-5. app.js 호출부 수정 (소셜 관련)

| 위치 | 기존 | 변경 |
|------|------|------|
| L1483 | `fetchSocialData()` | `window.fetchSocialData()` |
| L1710 | `toggleSocialMode(btn.dataset.mode, btn)` | `window.SocialModule.toggleMode(btn.dataset.mode, btn)` |
| L1711 | `renderUsers(btn.dataset.sort, btn)` | `window.SocialModule.renderUsers(btn.dataset.sort, btn)` |
| L2882,2897,4925 | `updateSocialUserData()` | `if(window.SocialModule) window.SocialModule.updateUserData()` |
| L4078 | `fetchSocialData()` | `window.fetchSocialData()` |
| L4211 | `renderUsers(AppState.social.sortCriteria)` | `if(window.SocialModule) window.SocialModule.renderUsers(AppState.social.sortCriteria)` |

## 2-6. app.js에서 제거할 코드

- Lines 4322~4551 (소셜 탭 전체)

## 2-7. 생성 파일

- `/home/user/levelup-app/modules/social.js` (283줄)
- `/home/user/levelup-app/www/modules/social.js` (www 동기화)

---

# Phase 3: 동적 로드 등록 & www 동기화 ✅ 완료

## 3-1. app.js 말미 동적 import 추가 (Module Bridge 뒤, exercise-calc.js 앞)

```js
// --- Ad Manager 모듈 동적 로드 ---
import('./modules/ad-manager.js').catch(e => console.error('[AdManager] 모듈 로드 실패:', e));

// --- Social 모듈 동적 로드 ---
import('./modules/social.js').catch(e => console.error('[Social] 모듈 로드 실패:', e));

// --- Exercise Calculator 모듈 (기존) ---
import('./modules/exercise-calc.js').catch(e => console.error('[ExerciseCalc] 모듈 로드 실패:', e));
```

**로드 순서**: Module Bridge → ad-manager.js → social.js → exercise-calc.js  
(소셜 모듈이 `window.AdManager.NATIVE_AD_POSITION` 참조하므로 광고 모듈이 먼저)

## 3-2. www 동기화

```bash
cp modules/ad-manager.js www/modules/ad-manager.js
cp modules/social.js www/modules/social.js
```

app.html 변경 불필요 (ES6 동적 import로 처리).

---

# 수정 대상 파일 요약

| 파일 | 작업 | Phase | 상태 |
|------|------|-------|------|
| `modules/ad-manager.js` | 광고 IIFE 모듈 (875줄) | 1 | ✅ |
| `app.js` | 광고 코드 제거 + 호출부 수정 + Module Bridge 확장 | 1 | ✅ |
| `modules/social.js` | 소셜 IIFE 모듈 (283줄) | 2 | ✅ |
| `app.js` | 소셜 코드 제거 + 호출부 수정 + Module Bridge 추가 확장 | 2 | ✅ |
| `app.js` | 동적 import 등록 (L14147-14154) | 3 | ✅ |
| `www/modules/ad-manager.js` | www 동기화 | 3 | ✅ |
| `www/modules/social.js` | www 동기화 | 3 | ✅ |

---

# 검증 결과

| 항목 | 결과 |
|------|------|
| 구문 검증 (`node --check`) | ✅ ad-manager.js, social.js 모두 통과 |
| 참조 무결성 (직접 호출 없음, `window.*` 경유만) | ✅ 확인 완료 |
| 로드 순서 (Module Bridge → ad-manager → social → exercise-calc) | ✅ app.js L14147-14154 |
| 방어적 호출 가드 (`if(window.AdManager)`, `if(window.SocialModule)`) | ✅ 모든 호출부 적용 |
| window 노출 (`fetchSocialData`, `toggleFriend`, `goToSocialTab`, `claimBonusExp`) | ✅ HTML onclick 호환 |
| www/ 동기화 (modules + app.js) | ✅ 루트 ↔ www 동일 |

---

# 최종 아키텍처

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

**리팩토링 성과**: app.js 15,225줄 → 14,154줄 (약 1,071줄 모듈로 추출, 7% 감소)
