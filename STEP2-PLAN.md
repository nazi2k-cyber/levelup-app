# Step 2 실행 계획: 플래너 · 푸시알림 · 건강동기화 제거

## 개요

| 항목 | 내용 |
|------|------|
| 작업 브랜치 | `claude/write-step2-plan-GpIMH` |
| 대상 기능 | 플래너(플래너 UI·캘린더·저장), 푸시알림(FCM·토픽·스케줄), 건강동기화(HealthConnect·GoogleFit·걸음수) |
| 예상 제거량 | `app.js` ~3,519줄 + 기타 파일 ~2,148줄 |
| 난이도 | 중간 |

---

## 보존 필수 항목 (절대 삭제 금지)

| 항목 | 위치 | 보존 이유 |
|------|------|----------|
| `getDiaryEntry()` | `app.js` | `reels.js`에서 `window.getDiaryEntry` 접근 |
| `plannerPhotoData` 변수 | `app.js` | `reels.js`에서 `window.plannerPhotoData` 접근 |
| `diarySelectedDate` 변수 | `app.js` | `reels.js`에서 `window.diarySelectedDate` 접근 |
| `showInAppNotification()` | `app.js` | `meditation.js`, `pomodoro.js`, `reels.js` 사용 |
| `openAppSettings()` | `app.js` | `library.js`에서 `window.openAppSettings` 접근 |
| `syncToggleWithOSPermissions()` — GPS 섹션(`// 2)`) | `app.js` | GPS 기능은 Step 2 범위 외 |
| `showPermissionPrompts()` — 카메라·GPS 섹션 | `app.js` | 동일 |
| `getCleanDiaryStrForFirestore()` | `app.js` | `saveUserData()`에서 호출 |
| `compressToTargetSize()` | `app.js` | 앱 전역 사용 |
| `showPhotoSourceSheet()` | `app.js` | 프로필 이미지 업로드에서 사용 |
| `rareStepTitles` 배열 | `data.js` | 호칭 모달 렌더링에서 사용 |

---

## 단계별 구현 계획

### STEP 1. 사전 확인

1. `git checkout claude/write-step2-plan-GpIMH` — 작업 브랜치 확인
2. `wc -l www/app.js functions/index.js www/data.js` — 기준 라인 수 기록
3. 앱 로드 및 각 탭 정상 동작 확인 (브라우저 콘솔 오류 없음)

---

### STEP 2. 네이티브 플러그인 파일 삭제

4. `native-plugins/HealthConnectPlugin.java` 파일 삭제 (119줄)
5. `native-plugins/GoogleFitPlugin.java` 파일 삭제 (357줄)
6. `native-plugins/FCMPlugin.java` 파일 삭제 (117줄)

**검증:** `ls native-plugins/` — 세 파일 없음 확인

---

### STEP 3. 독립 모듈 파일 비우기

7. `www/firebase-messaging-sw.js` → 내용 전체를 아래로 교체 (61줄 → 1줄)
   ```javascript
   // Firebase Messaging SW — 기능 제거됨 (sw.js로 통합)
   ```

8. `www/modules/notification.js` → 내용 전체를 아래로 교체 (343줄 → 2줄)
   ```javascript
   // notification.js — 기능 제거됨 (Step 2 cleanup)
   window.NotificationModule = null;
   ```

9. `www/sw.js` — FCM 섹션 제거 (27–57줄: Firebase Messaging importScripts 블록 + `messaging.onBackgroundMessage` 핸들러)
   - `FIREBASE_CDN` 배열에서 `firebase-messaging.js` 항목 제거
   - 하단 `notificationclick` 핸들러 내 FCM 관련 부분 제거
   - (**~40줄 감소**)

---

### STEP 4. `functions/index.js` — 푸시 스케줄·알림 함수 제거

아래 순서로 각 항목을 정확한 줄 번호 확인 후 제거:

10. `handleGetTestUsers()`, `handleGetPushLogs()` 함수 제거 (~274–401줄, ~128줄)
11. `handleGetMyNotifications()` 함수 제거 (~430–455줄, ~26줄)
12. `writeUserNotification()` 함수 제거 (~457–479줄, ~23줄)
13. `handleSendTestNotification()` 함수 제거 (~480–578줄, ~99줄)
14. `handleSendAnnouncement()` 함수 제거 (~579–612줄, ~34줄)
15. `handleCreateAnnouncement()`, `handleUpdateAnnouncement()`, `handleDeleteAnnouncement()`, `handleGetAnnouncements()`, `handleGetActiveAnnouncements()` 제거 (~613–708줄, ~96줄)
16. `MESSAGES` 상수 제거 (~1839–1878줄, ~40줄)
17. `getLocalizedMessage()` 함수 제거 (~1880–1887줄, ~8줄)
18. `handleRaidAlert()` + `exports.sendRaidAlert0600/1130/1900` 제거 (~1896–1949줄, ~54줄)
19. `exports.sendDailyReminder` 제거 (~1953–2007줄, ~55줄)
20. `exports.sendStreakWarnings` 제거 (~2008–2121줄, ~114줄)
21. `exports.sendComebackPush` 제거 (~2122–2245줄, ~124줄)
22. `exports.sendAnnouncement` 제거 (~2247–2257줄, ~11줄)
23. `exports.cleanupInactiveTokens` 제거 (~2258–2300줄, ~43줄)
24. `exports.sendTestNotification`, `exports.getTestUsers`, `exports.getPushLogs` 제거 (~2301–2355줄, ~55줄)
25. `ping` 라우터 switch-case에서 아래 10개 case 제거 (~1672–1692줄):
    `getTestUsers`, `getPushLogs`, `sendTestNotification`, `sendAnnouncement`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `getAnnouncements`, `getActiveAnnouncements`, `getMyNotifications`

**검증:** `node --check functions/index.js` — 구문 오류 없음 확인

---

### STEP 5. `functions/index.js` — 플래너 관련 제거

26. `exports.cleanupExpiredPlannerPhotos` 제거 (~3686–3712줄, ~27줄)
27. `ALLOWED_PREFIXES` 배열에서 `"planner_photos/"` 항목 제거
28. 캐시 헤더 맵에서 `"planner_photos/": "no-cache"` 항목 제거

**검증:** `node --check functions/index.js` — 구문 오류 없음 확인

---

### STEP 6. `www/app.js` — 건강동기화 함수 제거 (리프 → 루트 순)

아래 순서대로 각 함수 전체 제거:

29. `tryHealthConnectSteps()` (~7959–7993줄, ~35줄)
30. `tryGoogleFitNativeSteps()` (~7994–8023줄, ~30줄)
31. `checkStepRareTitles()` (~2791–2811줄, ~21줄)
32. `syncHealthData()` (~8024–8111줄, ~88줄)
33. `requestFitnessScope()` (~7913–7958줄, ~46줄)
34. `updateStepCountUI()` (~8112–8183줄, ~72줄)
35. `toggleHealthSync()` (~7779–7844줄, ~66줄)
36. `syncToggleWithOSPermissions()` — `// 3) 건강 데이터` 블록만 제거 (~50줄), 함수·GPS 섹션 보존

---

### STEP 7. `www/app.js` — 건강동기화 호출 지점 제거

37. ~1520–1521줄: `updateStepCountUI()` + `if (AppState.user.syncEnabled) syncHealthData(false)` 2줄 제거
38. ~1772줄: `sync-toggle` 이벤트 리스너 1줄 제거
39. ~4452줄: `changeLanguage()` 내 `updateStepCountUI()` 1줄 제거
40. ~7644–7668줄: `showPermissionPrompts()` 내 `// 3) 건강 데이터` 블록 제거 (~25줄)

**체크포인트:** `grep -n "syncHealthData\|toggleHealthSync\|updateStepCountUI\|checkStepRareTitles\|tryHealthConnect\|tryGoogleFit\|requestFitnessScope" www/app.js` → 정의 0건

---

### STEP 8. `www/app.js` — 푸시 알림 함수 제거 (리프 → 루트 순)

41. `subscribeNativeTopics()` (~8851–8866줄, ~16줄)
42. `unsubscribeNativeTopics()` (~8867–8906줄, ~40줄)
43. `updateTopicSubscriptionForLanguage()` (~8894–8908줄, ~15줄)
44. `requestNativePushPermission()` (~8461–8521줄, ~61줄)
45. `requestWebPushPermission()` (~8522–8549줄, ~28줄)
46. `setupNativePushListeners()` (~8550–8585줄, ~36줄)
47. `setupWebPushListeners()` (~8837–8850줄, ~14줄)
48. `registerEarlyPushListeners()` (~8589–8688줄, ~100줄)
49. `togglePushNotifications()` (~8395–8460줄, ~65줄)
50. `initPushNotifications()` (~8324–8394줄, ~71줄)

---

### STEP 9. `www/app.js` — 푸시 알림 호출 지점 제거

51. Firebase Messaging import 제거: `getMessaging`, `getToken`, `onMessage` + `messaging` 변수 초기화 (~9줄)
52. ~1395줄: `DOMContentLoaded` 내 `registerEarlyPushListeners()` 호출 1줄 제거
53. ~1525–1531줄: 로그인 초기화 내 `initPushNotifications()` 호출 제거
54. ~1770줄: `push-toggle` 이벤트 리스너 1줄 제거
55. ~1737–1739줄: `btn-settings-push-guide`, `btn-settings-fitness-guide` 이벤트 리스너 2줄 제거
56. ~4415줄: `changeLanguage()` 내 `updateTopicSubscriptionForLanguage()` 호출 1줄 제거
57. ~4380–4392줄: `refreshSettingsStatusMessages()` 내 `push-status` 블록 제거 (~8줄)
58. ~8993–8998줄: SW 메시지 리스너 내 `NotificationModule.addNotification()` 블록 제거 (~5줄)
59. `showInAppNotification()` 내 `NotificationModule.addNotification()` 참조 블록 제거 (~5줄) — 함수 자체는 보존
60. `syncToggleWithOSPermissions()` — `// 1) 푸시 알림` 블록만 제거 (~55줄), 함수·GPS 섹션 보존
61. `showPermissionPrompts()` — `// 1) 푸시 알림` 블록만 제거 (~30줄)

**체크포인트:** `grep -n "initPushNotifications\|requestNativePushPermission\|setupNativePushListeners\|togglePushNotifications\|updateTopicSubscriptionForLanguage" www/app.js` → 정의 0건

---

### STEP 10. `www/app.js` — 플래너 함수 제거 (리프 → 루트 순)

62. `window.toggleTaskRank()`, `window.toggleTaskDone()`, `window.updateTaskText()`, `window.removeTask()` (~6900–6940줄, ~40줄)
63. `window.addPlannerTask()` (~6923–6941줄, ~18줄)
64. `window.copyPrevDayTasks()`, `window.copyPrevDaySchedule()` (~6942–6980줄, ~38줄)
65. `getTaskOptions()` (~6819–6847줄, ~28줄)
66. `renderPlannerTasks()` (~6848–6922줄, ~75줄)
67. `renderTimeboxGrid()` (~7107–7156줄, ~50줄)
68. `renderMonthlyCalendar()` (~6663–6808줄, ~145줄)
69. `renderPlannerCalendar()` (~6612–6662줄, ~50줄)
70. `getCaptionByteLength()`, `window.updateCaptionCounter()` (~7503–7540줄, ~37줄)
71. `loadPlannerPhoto()` (~7450–7487줄, ~38줄)
72. `window.removePlannerPhoto()` (~7488–7502줄, ~15줄)
73. `loadPlannerForDate()` (~7157–7313줄, ~157줄)
74. `savePlannerEntry()` (~7314–7444줄, ~131줄)
75. `openPlannerInfoModal()` (~5886–5950줄, ~65줄)
76. `openShareModal()` (~6008–6080줄, ~72줄)
77. `renderPlannerDiyQuests()` 빈 함수 제거 (~3356–3358줄, ~3줄)

---

### STEP 11. `www/app.js` — 플래너 상태 변수·호출 지점 제거

78. 플래너 상태 변수 제거: `plannerWeekOffset`, `monthlyCalendarYear`, `monthlyCalendarMonth`, `_monthlyCalendarUnlocked`, `plannerTasks`, `_plannerPhotoBase64`, `_plannerPhotoCompressing` (~7줄)
    - **보존:** `diarySelectedDate`, `plannerPhotoData`
79. ~1735줄: `btn-planner-info` 이벤트 리스너 제거
80. ~1826–1882줄: 플래너 이벤트 리스너 블록 전체 제거 (~57줄)
81. ~4309줄: `switchTab()` 내 `renderPlannerCalendar()`, `loadPlannerForDate()` 호출 제거 (`updateReelsResetTimer` 호출은 유지)
82. ~4443줄: `changeLanguage()` 내 `renderPlannerCalendar()` 호출 1줄 제거
83. ~4400–4415줄: `refreshSettingsStatusMessages()` 내 fitness 상태 렌더링 블록 제거 (~10줄)
84. `openSettingsGuideModal()` 내 `push`, `fitness` 항목의 colors/icons 맵 제거 (~4줄)

**체크포인트:** `grep -n "renderPlannerCalendar\|loadPlannerForDate\|savePlannerEntry\|renderPlannerTasks\|renderTimeboxGrid\|renderMonthlyCalendar\|addPlannerTask\|copyPrevDayTasks" www/app.js` → 정의 0건

---

### STEP 12. `www/data.js` — i18n 번역 키 제거

85. 플래너 관련 키 제거 — ko/en/ja 3언어 모두 (~60줄):
    `planner_tab_priority`, `planner_tab_schedule`, `profile_planner_btn`, `profile_view_planner`, `profile_no_today_plan`, `planner_weekly`, `planner_monthly`, `planner_weekly_short`, `planner_reward`, `planner_placeholder`, `planner_photo_required`, `planner_photo_warning`, `planner_caption_placeholder`, `planner_caption_limit_ko`, `btn_planner_info`, `planner_add_btn`, `planner_task_placeholder`, `reels_copy_planner`, `reels_copy_confirm_title`, `apply_today_confirm_msg`, `apply_today_success`, `apply_today_no_data`
    - **보존:** `nav_diary` (탭 네비게이션 이름)

86. 푸시·건강동기화 관련 키 제거 — ko/en/ja 3언어 모두 (~90줄):
    `step_title`, `step_unit`, `step_next_reward`, `step_req_title`, `step_req_1`, `step_req_2`, `step_req_3`, `step_req_reward`, `sync_req`, `sync_done`, `sync_off`, `sync_off_by_os`, `sync_revoke_confirm`, `push_on`, `push_off`, `push_off_by_os`, `push_denied`, `push_requesting`, `push_err`, `settings_guide_push_title`, `settings_guide_push_desc`, `settings_guide_fitness_title`, `settings_guide_fitness_desc`, `sync_complete_msg`, `sync_reward_msg`, `sync_no_steps`, `sync_next_reward`, `fitness_needs_google_signin`, `fitness_email_disabled`, `noti_announcements`, `noti_push_history`, `noti_no_announcements`, `noti_no_history`, `noti_pinned`, `noti_clear_history`, `noti_clear_confirm`, `noti_new_badge`

---

### STEP 13. 최종 검증

87. 라인 수 확인:
    ```bash
    wc -l www/app.js www/modules/notification.js www/sw.js functions/index.js www/data.js
    ```

    | 파일 | 현재 | 기대값 |
    |------|------|-------|
    | `www/app.js` | 9,159줄 | ~5,640줄 |
    | `www/modules/notification.js` | 343줄 | ~2줄 |
    | `www/firebase-messaging-sw.js` | 61줄 | ~1줄 |
    | `www/sw.js` | 311줄 | ~271줄 |
    | `functions/index.js` | 3,777줄 | ~2,817줄 |
    | `www/data.js` | 1,981줄 | ~1,831줄 |

88. 함수 정의 잔여 확인 (0건이어야 함):
    ```bash
    grep -n "syncHealthData\|toggleHealthSync\|initPushNotifications\|renderPlannerCalendar\|loadPlannerForDate\|savePlannerEntry" www/app.js
    ```

89. Cloud Functions 구문 검사:
    ```bash
    node --check functions/index.js
    ```

90. 보존 항목 존재 확인:
    ```bash
    grep -n "showInAppNotification\|openAppSettings\|getDiaryEntry\|plannerPhotoData\|diarySelectedDate" www/app.js
    ```

91. 앱 브라우저 로드 → 콘솔 오류 없음
92. 로그인 정상 → Quests, Social, Settings 탭 정상 동작
93. Pomodoro 완료 시 인앱 알림 (`showInAppNotification`) 정상 동작

---

### STEP 14. 커밋 및 푸시

94. 변경 파일 스테이징:
    ```bash
    git add www/app.js functions/index.js www/data.js www/sw.js www/modules/notification.js www/firebase-messaging-sw.js
    git add -u native-plugins/
    ```
95. 커밋:
    ```bash
    git commit -m "Step 2: remove planner, push notifications, health sync (~3,510 lines from app.js)"
    ```
96. 푸시:
    ```bash
    git push -u origin claude/write-step2-plan-GpIMH
    ```

---

## 예상 라인 감소 요약

| 파일 | 제거 전 | 예상 감소 | 예상 잔여 |
|------|---------|----------|---------|
| `www/app.js` | 9,159줄 | ~3,519줄 | ~5,640줄 |
| `www/modules/notification.js` | 343줄 | ~341줄 | ~2줄 |
| `www/firebase-messaging-sw.js` | 61줄 | ~60줄 | ~1줄 |
| `www/sw.js` | 311줄 | ~40줄 | ~271줄 |
| `functions/index.js` | 3,777줄 | ~960줄 | ~2,817줄 |
| `www/data.js` | 1,981줄 | ~150줄 | ~1,831줄 |
| `native-plugins/FCMPlugin.java` | 117줄 | ~117줄 | 0 (삭제) |
| `native-plugins/HealthConnectPlugin.java` | 119줄 | ~119줄 | 0 (삭제) |
| `native-plugins/GoogleFitPlugin.java` | 357줄 | ~357줄 | 0 (삭제) |
| **합계** | | **~5,663줄** | |

---

## 위험 요소 요약

| 위험도 | 항목 | 대응 방법 |
|--------|------|----------|
| 높음 | `syncToggleWithOSPermissions()` GPS 섹션(`// 2)`) 실수 삭제 | 수정 전후 `// 2)` 주석 존재 확인 |
| 높음 | `showPermissionPrompts()` 카메라·GPS 섹션 실수 삭제 | 동일 |
| 높음 | `getDiaryEntry`, `plannerPhotoData`, `diarySelectedDate` 실수 삭제 | reels.js grep 확인 후 진행 |
| 중간 | `functions/index.js` switch-case 부분 제거 시 구문 오류 | `node --check` 매번 실행 |
| 중간 | `handleGetTestUsers/PushLogs` 실제 줄 번호 (~274–401줄) 확인 필요 | 구현 전 Read로 정확한 위치 확인 |
| 낮음 | Firebase Messaging import 제거 순서 | 함수 제거 후 import 제거 순서 준수 |
