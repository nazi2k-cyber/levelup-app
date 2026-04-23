# AdMob 네이티브 광고 적용 전수조사 (2026-04-23)

## 조사 범위
- 웹앱 코드(`www/`) 기준 실제 노출 지점, 로드 트리거, 조건문, 플러그인 연동부를 전수 확인.
- 네이티브 플러그인(`native-plugins/NativeAdPlugin.java`) 구현 및 런타임 제약 확인.

## 결론 요약
현재 **실제 네이티브 광고가 적용된 슬롯은 총 3곳**입니다.

1. `social` 탭 (랭킹 카드 5번째 뒤)
2. `reels` 탭 (Day1 카드 3번째 뒤)
3. `dungeon` 탭 (섹션 하단 고정 placeholder)

> 공통적으로 `isNativePlatform`(네이티브 런타임)일 때만 로드되며, 웹에서는 노출되지 않습니다.

## 상세 결과

### 1) 광고 코어 설정 / 공통 로직
- 네이티브 광고 유닛 ID: `ca-app-pub-6654057059754695/8612252339`
- 슬롯 기준 위치 상수:
  - `NATIVE_AD_POSITION = 5` (social)
  - `REELS_NATIVE_AD_POSITION = 3` (reels)
- 어댑터 우선순위:
  1) `Capacitor.Plugins.NativeAd`
  2) `Capacitor.Plugins.AdMob`의 Native Advanced API
- 플러그인 부재 시 네이티브 광고 비활성화 후 배너 폴백.

### 2) social 탭
- 삽입 위치: 유저 카드 렌더링 시 5번째 카드 뒤 placeholder 삽입.
- 로드 조건:
  - 리스트 길이가 5개 이상
  - `isNativePlatform === true`
- 로드 호출: `window.AdManager.loadNativeAd('social')`

### 3) reels(Day1) 탭
- 삽입 위치: 포스트 렌더링 시 3번째 카드 뒤 placeholder 삽입.
- 로드 조건:
  - 포스트 길이가 3개 이상
  - `isNativePlatform === true`
- 로드 호출: `window.AdManager.loadNativeAd('reels')`
- 검색/재렌더링 경로에서도 동일 조건으로 재호출.

### 4) dungeon 탭
- 삽입 위치: `#native-ad-placeholder-dungeon` (섹션 하단 고정 영역)
- 로드 트리거:
  - 탭 전환 `switchTab('dungeon')` 시 `loadNativeAd('dungeon')`
- 주석상 diary 네이티브는 제거되고 dungeon만 유지.

### 5) 탭 전환/모달/스크롤 동작
- 탭 전환 시 현재 활성 탭과 다르면 기존 네이티브 광고 `cleanupNativeAd()` 수행.
- 모달 오버레이 시 `hideForModal()`로 네이티브/배너 숨김, 닫히면 `resumeFromModal()`로 복원.
- `IntersectionObserver + requestAnimationFrame`으로 표시/숨김 및 위치 동기화.

### 6) 네이티브(Android) 플러그인 상태
- `NativeAdPlugin`은 `loadAd/showAd/updatePosition/hideAd/resumeAd/destroyAd` 제공.
- 내부적으로 `destroyAdInternal()` 후 새 광고를 로드하므로 **동시 다중 슬롯 유지가 아닌 단일 활성 슬롯 구조**.
- `npa` 파라미터(`non-personalized ads`)를 AdRequest에 전달.

## 미적용/제외 확인
- `planner` 탭: 네이티브 슬롯/로드 호출 없음(보상형 광고 로직 중심).
- `diary` 탭: 주석으로 네이티브 대신 보상형으로 전환되었음.

## 빠른 체크리스트
- [x] social 네이티브 슬롯/로드 적용
- [x] reels 네이티브 슬롯/로드 적용
- [x] dungeon 네이티브 슬롯/로드 적용
- [x] 탭 전환 시 정리 로직 적용
- [x] 플러그인 미지원 시 배너 폴백 적용
- [ ] iOS 네이티브 전용 구현 파일은 저장소에서 확인되지 않음 (이번 범위: Android/Capacitor JS)
