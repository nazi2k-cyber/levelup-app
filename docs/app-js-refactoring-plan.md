# app.js 시스템 영향도에 따른 단계별 리팩토링 방안 계획서

> 작성일: 2026-04-17  
> 대상 파일: `www/app.js` (9,940줄 / 477KB)  
> 현황: 단일 파일에 Firebase 초기화, 인증, 상태 관리, UI 렌더링, 게임 로직 등이 혼재

---

## 1. 현황 분석

### 1-1. 주요 섹션별 구조

| 섹션 | 라인 범위 | 설명 |
|------|-----------|------|
| Firebase 초기화 | 1 – 50 | SDK 임포트, 앱/Auth/DB/Storage 설정, Analytics, RemoteConfig |
| 전환율 추적 / A·B 테스트 | 51 – 135 | ConversionTracker, RemoteConfig 헬퍼, 실험 변형 조회 |
| 네트워크 인프라 | 136 – 272 | Firestore 오프라인 복구, NetworkMonitor, FCM 초기화 |
| Storage · 이미지 처리 | 274 – 644 | 업로드 직렬화 큐, 재전송 큐, 이미지 압축, Blob URL 캐시 |
| 앱 상태 & 초기화 | 660 – 1 410 | AppState 정의, Auth 리스너, 사용자 데이터 로드, 온보딩 |
| UI 관리 & 내비게이션 | 708 – 1 915 | 테마, 햄버거 메뉴, 탭 전환, 상태 카드 재정렬 |
| 사용자 데이터 퍼시스턴스 | 1 917 – 2 537 | `saveUserData`, `loadUserDataFromDB`, 마이그레이션 |
| 스트릭 시스템 | 2 539 – 2 843 | 스트릭 계산, 감쇠 로직, 배지 렌더링 |
| 희귀 타이틀 시스템 | 2 805 – 3 023 | 타이틀 컬렉션, 조건별 잠금 해제 검사 (5개 유사 함수) |
| 게임 메커닉 | 3 025 – 3 442 | 크리티컬 히트, 루트 드롭, 올클리어 보상, 레벨업 |
| 퀘스트 시스템 | 3 354 – 3 724 | 주간 퀘스트, DIY 퀘스트, 히스토리, 달력 렌더링 |
| 퀘스트 통계 | 3 686 – 4 395 | 월·연간 분석, 히트맵, 일일 진행도, 필터 |
| 던전·레이드 시스템 | 4 396 – 4 939 | 보스 메커닉, 참가자 싱크, GPS 근접 보너스, 보상 |
| 공통 UI & 프로필 | 4 940 – 5 768 | 탭 전환, 포인트 UI, 프로필 모달, 타이틀 배지 |
| 인증 | 5 126 – 5 455 | 로그인/회원가입, 구글 인증 (Native·Web), 계정 삭제 |
| 프로필 이미지 & 사진 | 5 397 – 5 538 | 이미지 선택(카메라·갤러리), 업로드, 압축, 미리보기 |
| 프로필 공유 & 모달 | 5 541 – 6 789 | 타이틀 가이드, 스탯 모달, 프로필 카드 이미지 내보내기 |
| 설정 & 언어 | 5 022 – 5 120 | 언어 전환, 상태 메시지 갱신, 테마 토글 |
| 플래너 시스템 | 6 605 – 7 155 | 다이어리, 태스크 관리, 이미지 공유 (일부 modules/ 분리) |
| 안내 모달 & 가이드 | 6 114 – 6 725 | 퀘스트·던전·설정·플래너 도움말 텍스트 |

### 1-2. 전역 상태 변수

| 변수 | 유형 | 위험도 | 비고 |
|------|------|--------|------|
| `AppState` | Object | 매우 높음 | 10개+ 함수 그룹에서 산발적 변이 |
| `_uploadRetryQueue` | Array | 중간 | 업로드 재전송 큐 |
| `_saveInFlight` / `_savePendingAfterFlight` | Boolean | 높음 | 저장 경쟁 방지 플래그 |
| `_initializedUid` | String | 높음 | 로그인당 1회 설정 |
| `_qstatsMonth`, `_qstatsYear` | Primitive | 낮음 | 퀘스트 통계 필터 상태 |
| `diarySelectedDate` | String | 낮음 | 다이어리 선택일 |

---

## 2. 시스템 영향도 분석

### 2-1. 영향도 매트릭스

| 섹션 | 결합도 | 변경 영향 | 추출 위험도 |
|------|--------|-----------|------------|
| `loadUserDataFromDB` | 매우 높음 | 로그인 시 전체 상태 초기화 — 버그 시 앱 진입 불가 | 🔴 매우 높음 |
| `saveUserData` / `_doSaveUserData` | 매우 높음 | 모든 퀘스트·스탯 변경마다 호출 — 데이터 유실 위험 | 🔴 매우 높음 |
| `updateDungeonStatus` | 높음 | 30초마다 글로벌 동기화 — 실시간 기능 전체 | 🟠 높음 |
| `changeLanguage` | 높음 | 10개+ 렌더 함수 순차 호출 — 번역 전체 영향 | 🟠 높음 |
| `toggleQuest` | 높음 | 스트릭→타이틀→루트→저장 연쇄 호출 | 🟠 높음 |
| `switchTab` | 중간 | 탭별 초기화 로직 분기 — 탭 진입 오류 가능 | 🟡 중간 |
| `renderQuestStats` | 중간 | 순수 렌더링, 상태 변이 없음 | 🟡 중간 |
| 희귀 타이틀 검사 (×5) | 중간 | AppState 읽기 전용 — 직접 손상 낮음 | 🟢 낮음 |
| NetworkMonitor | 낮음 | 독립 싱글톤 — 공개 API만 사용 | 🟢 낮음 |
| 이미지 유틸리티 | 낮음 | 외부 의존성 없음 — 순수 함수 | 🟢 낮음 |
| ConversionTracker | 낮음 | Analytics·RemoteConfig에만 의존 | 🟢 낮음 |

### 2-2. 핵심 의존성 그래프

```
[Authentication]
  └─ simulateLogin / GoogleLogin
       └─ loadUserDataFromDB  ──→  [AppState 전체 초기화]
                                        │
              ┌─────────────────────────┼──────────────────────┐
              ▼                         ▼                      ▼
       [Quest System]           [Streak System]        [Dungeon System]
       toggleQuest()            applyStreakAndDecay()  syncGlobalDungeon()
         ├─ updateStreak()      checkRareTitles×5()   updateDungeonStatus()
         ├─ checkDailyAllClear()
         ├─ updateQuestHistory()
         └─ saveUserData()  ──→  [Firestore Write]

[changeLanguage]  ──→  10+ 렌더 함수 순차 호출 (전역 재렌더)
```

---

## 3. 현재 코드 품질 이슈

### 3-1. 중복 로직 — 희귀 타이틀 검사 함수 (×5)

```javascript
// 라인 2823, 2846, 2869, 2892, 2914 — 동일 패턴 반복
checkStreakRareTitles()
checkStepRareTitles()
checkReadingRareTitles()
checkMovieRareTitles()
checkSavingsRareTitles()
```

모두 동일한 루프 구조 + 다른 데이터 소스. 팩토리 패턴으로 단일화 가능.

### 3-2. 장문 함수 (200줄 이상)

| 함수 | 줄수 | 문제 |
|------|------|------|
| `_doSaveUserData()` | ~280줄 | 검증 + 진단 로그 + Firestore 쓰기 혼재 |
| `loadUserDataFromDB()` | ~273줄 | 역직렬화 + 마이그레이션 + localStorage 캐시 혼재 |
| `sharePlannerAsImage()` | ~356줄 | Canvas 렌더링 + 4단계 폴백 저장 혼재 |
| `saveProfileCardAsImage()` | ~241줄 | Canvas 렌더링 + 플랫폼별 공유 로직 혼재 |

### 3-3. 관심사 혼재 사례

- **`loadUserDataFromDB`**: Firestore 읽기 + 역직렬화 + 이름 마이그레이션 + 프로필 이미지 마이그레이션 + localStorage 동기화
- **`_doSaveUserData`**: 데이터 정규화 + 유효성 검사 + 진단 로깅 + Firestore 쓰기
- **`switchTab`**: 내비게이션 + 탭별 초기화 + 광고 호출

### 3-4. 기타

- 인라인 i18n 키 하드코딩: `i18n[lang]?.KEY || fallback` 패턴 수십 곳 반복
- Canvas 기반 이미지 저장에 4단계 폴백 중복 (두 함수에서 동일 구조)

---

## 4. 단계별 리팩토링 계획

> **원칙**: 시스템 영향도가 낮은(독립적) 섹션부터 추출 → 중간 → 핵심 순으로 진행  
> 각 단계는 독립적으로 배포 가능하며, 이전 단계가 안정화된 후 다음 단계 진행

---

### Phase 1 — 독립 모듈 추출 (위험도: 🟢 낮음)

**목표**: 외부 의존성이 거의 없는 유틸리티·인프라 코드를 별도 모듈로 분리  
**소요 예상**: 1~2주  
**배포 후 검증**: 이미지 업로드, 오프라인·온라인 전환, 전환율 이벤트 로그 확인

#### 1-A. `modules/image-utils.js` 생성

추출 대상 (라인 274–644):
- `compressBase64Image()` — 이미지 압축
- `compressToTargetSize()` — 목표 크기 기반 적응형 압축
- `dataURLtoBlob()` — 변환 헬퍼
- `canvasToOptimalDataURL()` — WebP/JPEG 선택
- `_fetchAsBlobUrl()`, `_blobUrlCache` — Blob URL 캐시
- `uploadImageToStorage()`, `_uploadImageToStorageImpl()` — 업로드 로직
- `_uploadRetryQueue`, `_flushRetryQueue()` — 재전송 큐
- `showUploadProgress()`, `hideUploadProgress()` — 진행률 토스트 UI

```javascript
// modules/image-utils.js (예시 인터페이스)
export {
  compressBase64Image,
  compressToTargetSize,
  uploadImageToStorage,
  getThumbnailURL,
  showUploadProgress,
  hideUploadProgress,
};
```

#### 1-B. `modules/network-monitor.js` 생성

추출 대상 (라인 216–272):
- `NetworkMonitor` 싱글톤 전체
- `navigator.connection` 리스너

```javascript
// modules/network-monitor.js (예시 인터페이스)
export const NetworkMonitor = { getQuality, isUsable, checkNow, onQualityChange };
```

#### 1-C. `modules/conversion-tracker.js` 생성

추출 대상 (라인 51–135):
- `ConversionTracker` 모듈 전체
- `initRemoteConfig()`, `getExperimentVariant()`

---

### Phase 2 — 렌더링 모듈 추출 (위험도: 🟡 중간)

**목표**: 상태를 변이하지 않는 순수 렌더링 함수를 별도 모듈로 분리  
**소요 예상**: 2~3주  
**배포 후 검증**: 퀘스트 통계 화면, 희귀 타이틀 모달, 스트릭 배지 UI 기능 검증

#### 2-A. `modules/quest-stats.js` 생성

추출 대상 (라인 3686–4395):
- `renderQuestStats()` 및 서브 렌더러 4개
- `renderMonthlySummary()`, `renderMonthlyHeatmap()`, `renderMonthlyDailyProgress()`
- `renderAnnualChart()` — SVG 바차트
- `_getDailyQuestDoneTotal()`, `_getDiyQuestDoneTotal()` — 조회 헬퍼

#### 2-B. `modules/rare-titles.js` 생성 + 중복 통합

추출 대상 (라인 2805–3023):
- 5개의 `check*RareTitles()` 함수를 팩토리 패턴으로 통합

```javascript
// 리팩토링 전 (×5 중복)
function checkStreakRareTitles() { /* ... */ }
function checkStepRareTitles()   { /* ... */ }

// 리팩토링 후 (팩토리)
function checkRareTitles(config) { /* 공통 로직 */ }
export const checkStreakRareTitles  = () => checkRareTitles({ source: 'streak',  ... });
export const checkStepRareTitles    = () => checkRareTitles({ source: 'step',    ... });
```

#### 2-C. `modules/streak-ui.js` 생성

추출 대상 (라인 2633–2725):
- `renderStreakBadge()`, `renderStreakHistory()`
- `getStreakStatusText()`

#### 2-D. `modules/info-modals.js` 생성

추출 대상 (라인 6114–6725):
- `openQuestInfoModal()`, `openDungeonInfoModal()`, `openPlannerInfoModal()` 등 안내 모달 5개+

---

### Phase 3 — 핵심 로직 분리 (위험도: 🟠 높음)

**목표**: 결합도가 높은 핵심 비즈니스 로직을 책임 단위로 분리  
**소요 예상**: 3~4주  
**전제 조건**: Phase 1·2 완료 및 안정화 확인  
**배포 후 검증**: 로그인 전 과정, 퀘스트 완료·스트릭 갱신, 저장·불러오기 전체 시나리오 E2E 테스트

#### 3-A. `saveUserData` 3계층 분리

```
현재: saveUserData() — 검증 + 정규화 + 로깅 + Firestore 쓰기 (280줄)

분리 후:
  ├─ validateUserData(state)     → 유효성 검사만 담당 (순수 함수)
  ├─ normalizeUserData(state)    → 정규화 변환 (순수 함수)
  └─ persistUserData(normalized) → Firestore 쓰기만 담당
```

#### 3-B. `loadUserDataFromDB` 3단계 분리

```
현재: loadUserDataFromDB() — 읽기 + 역직렬화 + 마이그레이션 + 캐시 (273줄)

분리 후:
  ├─ fetchUserDocument(uid)         → Firestore 읽기
  ├─ deserializeUserData(doc)       → 역직렬화 (순수 함수)
  └─ migrateUserDataIfNeeded(data)  → 마이그레이션 (순수 함수)
```

#### 3-C. `switchTab` 관심사 분리

```
현재: switchTab() — 내비게이션 + 탭별 초기화 + 광고 호출

분리 후:
  ├─ navigateToTab(tabName)       → DOM 전환만
  └─ initTabOnFirstVisit(tabName) → 탭별 초기화 (lazy init 맵)
```

---

### Phase 4 — 아키텍처 개선 (위험도: 🔴 높음, 선택적)

**목표**: 장기 유지보수성을 위한 구조적 개선  
**소요 예상**: 4~6주  
**전제 조건**: Phase 1–3 완료 및 충분한 안정화 기간  
**배포 후 검증**: 전체 기능 회귀 테스트 필수

#### 4-A. AppState 중앙화

`AppState`에 대한 산발적 직접 변이를 방지하는 래퍼 도입:

```javascript
// 현재: 10개+ 위치에서 직접 변이
AppState.stats.points += reward;

// 개선: 명시적 업데이트 함수
function updatePoints(delta) {
  AppState.stats.points += delta;
  _notifyPointsChanged();
}
```

#### 4-B. `changeLanguage` 렌더링 배치화

10개+ 순차 렌더 호출을 `requestAnimationFrame` 배치로 최적화:

```javascript
// 현재: 순차 동기 호출 (UI 블로킹 가능)
changeLanguage(lang) {
  renderQuestList(); renderDiyList(); renderStreakBadge(); // ...×10
}

// 개선: 배치 큐
function scheduleRender(fn) { _renderQueue.add(fn); }
requestAnimationFrame(flushRenderQueue);
```

#### 4-C. 타입 안전 i18n

인라인 `i18n[lang]?.KEY || fallback` 패턴을 헬퍼 함수로 중앙화:

```javascript
// 현재: 수십 곳에 중복
i18n[AppState.currentLang]?.save_btn || '저장'

// 개선
t('save_btn') // 언어는 내부적으로 참조
```

#### 4-D. 탭별 모듈 지연 로딩

탭 최초 진입 시 해당 모듈만 동적 임포트하여 초기 로드 시간 단축:

```javascript
// switchTab() 내부
case 'stats':
  if (!_tabInitialized.stats) {
    const { renderQuestStats } = await import('./modules/quest-stats.js');
    _tabInitialized.stats = true;
  }
  break;
```

---

## 5. 리팩토링 우선순위 매트릭스

```
                  낮은 노력          중간 노력          높은 노력
                ┌──────────────┬──────────────┬──────────────┐
  높은 영향도   │ 이미지 유틸  │ saveUserData │ AppState     │
                │ (Phase 1-A)  │ 분리(3-A)   │ 중앙화(4-A)  │
                │ 희귀타이틀  │ loadUserData │              │
                │ 통합(2-B)   │ 분리(3-B)   │              │
                ├──────────────┼──────────────┼──────────────┤
  중간 영향도   │ NetworkMon.  │ i18n 헬퍼   │ 지연 로딩   │
                │ (Phase 1-B)  │ (4-C)       │ (4-D)        │
                │ 스트릭 UI   │ switchTab   │              │
                │ (Phase 2-C)  │ 분리(3-C)   │              │
                ├──────────────┼──────────────┼──────────────┤
  낮은 영향도   │ 안내 모달   │ 퀘스트통계  │ 렌더 배치화 │
                │ (Phase 2-D)  │ (Phase 2-A)  │ (4-B)        │
                │ ConvTracker  │              │              │
                │ (Phase 1-C)  │              │              │
                └──────────────┴──────────────┴──────────────┘
```

---

## 6. 각 단계 작업 체크리스트

### Phase 1 체크리스트

- [ ] `modules/image-utils.js` 생성 및 함수 이동
- [ ] `app.js`에서 해당 함수 제거 후 import 추가
- [ ] 이미지 업로드·오프라인 복구·진행률 토스트 테스트
- [ ] `modules/network-monitor.js` 생성 및 싱글톤 이동
- [ ] 온라인·오프라인 전환 동작 테스트
- [ ] `modules/conversion-tracker.js` 생성
- [ ] Analytics 이벤트 로그 확인

### Phase 2 체크리스트

- [ ] `modules/quest-stats.js` 생성 및 렌더러 이동
- [ ] 월별·연간 통계 화면 회귀 테스트
- [ ] `modules/rare-titles.js` 생성 및 5개 함수 통합
- [ ] 타이틀 잠금 해제 조건 모두 검증
- [ ] `modules/streak-ui.js` 생성
- [ ] 스트릭 배지·히스토리 UI 검증
- [ ] `modules/info-modals.js` 생성
- [ ] 각 안내 모달 표시 검증

### Phase 3 체크리스트

- [ ] `validateUserData`, `normalizeUserData`, `persistUserData` 분리
- [ ] 저장·불러오기 E2E 시나리오 테스트 (신규·기존 계정)
- [ ] `fetchUserDocument`, `deserializeUserData`, `migrateUserDataIfNeeded` 분리
- [ ] 로그인 전체 플로우 테스트 (이메일·구글·신규·기존)
- [ ] `switchTab` 관심사 분리
- [ ] 모든 탭 초기화 동작 검증

### Phase 4 체크리스트 (선택적)

- [ ] AppState 업데이트 함수 정의 및 직접 변이 코드 교체
- [ ] `changeLanguage` 렌더 배치화
- [ ] `t()` 헬퍼 도입 및 인라인 i18n 교체
- [ ] 탭별 동적 임포트 적용
- [ ] Lighthouse 성능 점수 비교

---

## 7. 리스크 및 완화 방안

| 리스크 | 영향도 | 완화 방안 |
|--------|--------|-----------|
| `loadUserDataFromDB` 분리 중 데이터 손실 | 매우 높음 | 분리 전 Firestore 백업 스냅샷 생성; 스테이징 환경에서 충분한 검증 |
| 모듈 순환 임포트 | 높음 | 의존성 방향 단방향 유지 (`app.js` → modules, modules끼리 상호 참조 금지) |
| `AppState` 중앙화 시 타이밍 오류 | 높음 | 비동기 업데이트에 락(lock) 메커니즘 적용; 기존 `_saveInFlight` 패턴 유지 |
| 희귀 타이틀 통합 후 조건 누락 | 중간 | 단위 테스트로 5개 조건 모두 커버 후 배포 |
| 지연 로딩 적용 후 탭 진입 지연 | 낮음 | 사전 프리페치(`link rel=modulepreload`) 또는 유휴 시점 로딩 |

---

## 8. 목표 아키텍처 (리팩토링 완료 후)

```
www/
├── app.js                      # 진입점: Firebase 초기화, Auth 리스너, 탭 라우팅
├── modules/
│   ├── image-utils.js          # 이미지 압축·업로드·Blob 캐시 (Phase 1-A)
│   ├── network-monitor.js      # 네트워크 품질 모니터링 (Phase 1-B)
│   ├── conversion-tracker.js   # 전환율 추적·A·B 테스트 (Phase 1-C)
│   ├── quest-stats.js          # 퀘스트 통계 렌더링 (Phase 2-A)
│   ├── rare-titles.js          # 희귀 타이틀 시스템 (Phase 2-B)
│   ├── streak-ui.js            # 스트릭 배지·히스토리 UI (Phase 2-C)
│   ├── info-modals.js          # 안내 모달 컨텐츠 (Phase 2-D)
│   ├── user-data.js            # 저장·불러오기·마이그레이션 (Phase 3-A·B)
│   ├── tab-router.js           # 탭 전환·지연 초기화 (Phase 3-C)
│   ├── ad-manager.js           # (기존)
│   ├── reels.js                # (기존)
│   ├── social.js               # (기존)
│   └── ...                     # (기존 15개 모듈)
└── logger.js                   # (기존)
```

**최종 목표**: `app.js`를 1,000줄 이하의 진입점·조합 레이어로 축소
