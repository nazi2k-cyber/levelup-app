# app.js Phase 0 — `window.*` export 스냅샷 (Baseline)

- 작성일: 2026-04-22 (UTC)
- 대상 파일: `www/app.js`

## 측정 규칙

- 1차 집계: `window.<symbol> =` 패턴을 export 목록으로 간주
- 보조 집계: `Object.defineProperty(window, '<symbol>', ...)` 패턴 별도 집계

## 집계 결과

- `window.<symbol> =` 매칭 수: **116**
- 고유 심볼 수(중복 제외): **110**
- `Object.defineProperty(window, ...)` 수: **2**

## `window.<symbol> =` 목록 (라인 오름차순)

| Line | Symbol |
|---:|---|
| 995 | `_pendingPermissionPrompts` |
| 1080 | `_pendingPermissionPrompts` |
| 1212 | `_reelsSortMode` |
| 1213 | `_reelsFeedLastKey` |
| 1221 | `_reelsCategoryFilter` |
| 1222 | `_reelsFeedLastKey` |
| 1844 | `renderBig5Card` |
| 1847 | `refreshRunningCalcSummary` |
| 1848 | `refreshOrmCalcSummary` |
| 2850 | `toggleQuest` |
| 2939 | `toggleDiyQuest` |
| 2980 | `showDiyQuestModal` |
| 3016 | `saveDiyQuest` |
| 3064 | `deleteDiyQuest` |
| 3081 | `closeDiyQuestModal` |
| 3089 | `selectDiyStat` |
| 3210 | `changeQstatsWeek` |
| 3216 | `openQstatsMonthly` |
| 3266 | `closeQstatsMonthly` |
| 3275 | `selectQstatsDate` |
| 3337 | `toggleQstatsDailyDropdown` |
| 3349 | `selectQstatsDailyQuest` |
| 3396 | `toggleQstatsDiyDropdown` |
| 3401 | `selectQstatsDiyQuest` |
| 3943 | `syncGlobalDungeon` |
| 4275 | `joinDungeon` |
| 4317 | `simulateRaidAction` |
| 4365 | `completeDungeon` |
| 4568 | `refreshRunningCalcSummary` |
| 4569 | `refreshOrmCalcSummary` |
| 4570 | `_reelsFeedLastKey` |
| 5159 | `renderBig5ForProfile` |
| 5207 | `openProfileStatsModal` |
| 5208 | `closeProfileStatsModal` |
| 5217 | `toggleProfileModalFollow` |
| 5286 | `viewUserTodayPlanner` |
| 5289 | `saveProfileCardAsImage` |
| 6315 | `sharePlannerAsImage` |
| 6719 | `sharePlannerLink` |
| 6766 | `openLegalPage` |
| 6927 | `changePlannerWeek` |
| 6989 | `selectMonthlyDate` |
| 7010 | `changeMonthlyCalendar` |
| 7018 | `openMonthlyCalendar` |
| 7081 | `closeMonthlyCalendar` |
| 7172 | `toggleTaskRank` |
| 7184 | `toggleTaskDone` |
| 7190 | `updateTaskText` |
| 7195 | `addPlannerTask` |
| 7200 | `removeTask` |
| 7214 | `copyPrevDayTasks` |
| 7233 | `copyPrevDaySchedule` |
| 7292 | `openApplyTodayModal` |
| 7325 | `closeApplyTodayModal` |
| 7330 | `confirmApplyToday` |
| 7422 | `selectPlannerDate` |
| 7773 | `removePlannerPhoto` |
| 7796 | `updateCaptionCounter` |
| 9082 | `_backPressedOnce` |
| 9084 | `_backPressedOnce` |
| 9347 | `AppState` |
| 9348 | `saveUserData` |
| 9349 | `updatePointUI` |
| 9350 | `drawRadarChart` |
| 9351 | `getTodayKST` |
| 9352 | `getWeekStartDate` |
| 9353 | `statKeys` |
| 9354 | `isNativePlatform` |
| 9355 | `_auth` |
| 9358 | `_db` |
| 9359 | `_setDoc` |
| 9360 | `_doc` |
| 9361 | `_analytics` |
| 9362 | `_fbLogEvent` |
| 9363 | `i18n` |
| 9364 | `getMsUntilNextKSTMidnight` |
| 9365 | `formatCountdown` |
| 9366 | `applyBonusExpReward` |
| 9367 | `applyRewardedInterstitialBonus` |
| 9370 | `_getDocs` |
| 9371 | `_collection` |
| 9372 | `_arrayUnion` |
| 9373 | `_arrayRemove` |
| 9374 | `switchTab` |
| 9375 | `sanitizeText` |
| 9376 | `sanitizeURL` |
| 9377 | `sanitizeAttr` |
| 9378 | `sanitizeInstaId` |
| 9379 | `sanitizeLinkedInId` |
| 9380 | `openLinkedInProfile` |
| 9381 | `buildUserTitleBadgeHTML` |
| 9382 | `checkRankRareTitles` |
| 9385 | `_storage` |
| 9386 | `_ref` |
| 9387 | `_uploadBytes` |
| 9388 | `_uploadBytesResumable` |
| 9389 | `_getDownloadURL` |
| 9390 | `_deleteObject` |
| 9391 | `NetworkMonitor` |
| 9394 | `_getDoc` |
| 9395 | `getDiaryEntry` |
| 9396 | `getTodayStr` |
| 9407 | `showInAppNotification` |
| 9408 | `changeLanguage` |
| 9409 | `_httpsCallable` |
| 9410 | `_functions` |
| 9411 | `checkReadingRareTitles` |
| 9412 | `checkMovieRareTitles` |
| 9413 | `checkSavingsRareTitles` |
| 9414 | `updateCameraToggleUI` |
| 9415 | `openAppSettings` |
| 9418 | `_query` |
| 9419 | `_where` |
| 9420 | `_orderBy` |
| 9421 | `_limit` |
| 9422 | `_deleteDoc` |

## `Object.defineProperty(window, ...)` 목록

| Line | Symbol |
|---:|---|
| 9397 | `plannerPhotoData` |
| 9401 | `diarySelectedDate` |
