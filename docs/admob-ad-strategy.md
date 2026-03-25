# AdMob 광고 전략 및 구현 가이드

> **앱:** LEVEL UP: REBOOT (com.levelup.reboot)
> **플랫폼:** Android (Capacitor 6.2)
> **광고 SDK:** Google AdMob
> **퍼블리셔 ID:** pub-6654057059754695
> **작성일:** 2026-03-24

---

## 1. 광고 전략 개요

### 1.1 목표

| 항목 | 목표 |
|------|------|
| **주 수익원** | AdMob 광고 (배너 + 전면 + 보상형) |
| **유저 경험** | 게임 몰입감을 해치지 않는 자연스러운 광고 노출 |
| **ARPMAU 목표** | 900원/월 (기준 시나리오) |
| **BEP 도달** | MAU 2,800+ 시 월 흑자 전환 |

### 1.2 광고 유형별 전략

| 광고 유형 | 역할 | 수익 비중 (목표) | 노출 빈도 |
|-----------|------|------------------|-----------|
| **배너 (Banner)** | 안정적 기본 수익 | 30~40% | 상시 노출 |
| **전면 (Interstitial)** | 주요 수익원 | 35~45% | 자연스러운 전환점에서 노출 |
| **보상형 (Rewarded)** | 유저 주도 + 높은 eCPM | 20~30% | 유저 선택 시 노출 |
| **네이티브 고급형 (Native Advanced)** | 피드 내 자연스러운 광고 | 10~15% | 소셜탭 랭킹 리스트 내 |

---

## 2. 광고 배치 전략

### 2.1 앱 탭 구조 및 배너 위치

```
┌──────────────────────────────┐
│  앱 콘텐츠 영역               │
│  (상태창/플래너/퀘스트/...    │
│   던전/Day1/소셜)             │
│                              │
│                              │
├──────────────────────────────┤
│  🔲 배너 광고 (320×50)        │  ← 하단 고정 배너
├──────────────────────────────┤
│  👤  🗓️  📜  ⚔️  🎬  🏆      │  ← 하단 네비게이션
└──────────────────────────────┘
```

### 2.2 배너 광고 (Banner Ad)

| 항목 | 설정 |
|------|------|
| **사이즈** | Adaptive Banner (화면 너비에 맞춰 자동 조정) |
| **위치** | 하단 네비게이션 바 바로 위 |
| **노출 페이지** | 상태창, 플래너, 소셜, 설정 |
| **비노출 페이지** | 퀘스트 수행 중, 던전 레이드 중, Day1 릴스 작성 중 |
| **갱신 주기** | 60초 (AdMob 기본값, 최소 30초 이상 권장) |

**비노출 기준 이유:**
- 퀘스트 수행 중: 체크리스트 조작 시 오탭 방지
- 던전 레이드: 몰입감 유지 (핵심 게이미피케이션 요소)
- 릴스 작성: 사진 업로드/글 작성 시 UX 방해 방지

### 2.3 전면 광고 (Interstitial Ad)

자연스러운 **전환점(transition point)**에서만 노출하여 유저 이탈을 최소화합니다.

| 노출 시점 | 이유 | 빈도 제한 |
|-----------|------|-----------|
| **탭 전환 시 (3회마다 1회)** | 자연스러운 화면 전환 시점 | 5분 간격, 세션당 최대 3회 |
| **퀘스트 완료 후** | 달성감 이후 자연스러운 전환 | 1일 2회 제한 |
| **던전 레이드 결과 확인 후** | 결과 확인 → 광고 → 메인으로 복귀 | 레이드당 최대 1회 |
| **앱 포그라운드 복귀 시** | 세션 재시작 시점 | 30분 이상 백그라운드 후에만 |

**전면 광고 프리로드:**
- 앱 시작 시 1개 프리로드
- 노출 후 즉시 다음 광고 프리로드
- 로드 실패 시 30초 후 재시도 (최대 3회)

### 2.4 보상형 광고 (Rewarded Ad)

유저가 **자발적으로 시청**하며, 게임 내 보상을 제공합니다.

| 보상 시나리오 | 보상 내용 | 위치 |
|--------------|----------|------|
| **일일 보너스 EXP** | EXP +50 (일반 퀘스트의 ~50%) | 상태창 > "보너스 EXP 받기" 버튼 |
| **스트릭 복구** | 끊어진 연속 출석 1회 복구 | 스트릭 경고 팝업 > "광고 보고 복구" |
| **레이드 추가 참여** | 일일 레이드 1회 추가 | 던전 탭 > "추가 레이드" 버튼 |
| **Day1 릴스 하이라이트** | 릴스 상단 고정 24시간 | Day1 탭 > "하이라이트 등록" |

**보상형 광고 정책:**
- 각 보상 유형별 일일 1회 제한 (총 최대 4회/일)
- 광고 시청 완료 후에만 보상 지급 (30초 미만 이탈 시 보상 없음)
- 보상 지급은 서버(Cloud Functions)에서 검증

### 2.5 네이티브 광고 고급형 (Native Advanced Ad) — 소셜탭

소셜탭의 글로벌/친구 랭킹 리스트 내에 **인라인 네이티브 광고**를 삽입합니다.
유저 카드와 동일한 시각적 스타일로 렌더링하여 자연스러운 UX를 제공합니다.

| 항목 | 설정 |
|------|------|
| **Ad Unit ID** | `ca-app-pub-6654057059754695/8612252339` |
| **테스트 Ad Unit ID** | `ca-app-pub-3940256099942544/2247696110` |
| **삽입 위치** | 랭킹 리스트 5번째 유저 카드 뒤 |
| **노출 조건** | 소셜탭 활성 + 유저 수 5명 이상 |
| **렌더링 방식** | 커스텀 Capacitor 플러그인 (NativeAdPlugin) + Native Android 오버레이 |

**아키텍처:**

```
WebView (app.js)                    Native Android Layer
════════════════                    ════════════════════
renderUsers()에서                   NativeAdPlugin.java
  placeholder <div> 삽입              → AdLoader로 NativeAd 로드
  (5번째 유저 카드 뒤)                 → NativeAdView 생성 (정책 준수)
                                      → Activity root에 오버레이
scroll 이벤트 →
  requestAnimationFrame 스로틀        → NativeAdView Y좌표 동기화
  IntersectionObserver               → 화면 밖 시 hide, 복귀 시 show

탭 전환 → cleanupNativeAd()          → 오버레이 제거 및 리소스 해제
```

**네이티브 광고 구성 요소:**
- 광고 아이콘 (30×30dp, 라운드) — 유저 프로필 사진과 동일 크기
- Headline 텍스트 — 유저 이름 위치에 표시
- Body 텍스트 — 부가 설명
- MediaView — 미디어 콘텐츠 (비율 제한)
- CTA 버튼 — neon-blue 스타일
- "광고" 라벨 뱃지 — 우상단

**기술적 이유 — 커스텀 플러그인 필요:**
- `@capacitor-community/admob` 플러그인은 네이티브 광고를 지원하지 않음 (배너/전면/보상형만)
- AdMob 정책상 네이티브 광고는 반드시 `NativeAdView`로 렌더링해야 노출/클릭 추적 정상 작동
- 기존 `native-plugins/` 디렉토리에 `GoogleFitPlugin.java`, `AppSettingsPlugin.java` 등 커스텀 플러그인 패턴 활용

**구현 파일:**

| 파일 | 작업 |
|------|------|
| `native-plugins/NativeAdPlugin.java` | 신규 — 네이티브 광고 로드/표시/위치동기화/정리 플러그인 |
| `www/app.js` | 수정 — renderUsers()에 placeholder 삽입, 광고 컨트롤러 함수, switchTab() 정리 |
| `www/style.css` | 수정 — `.native-ad-slot` 스타일 추가 |
| `MainActivity.java` | 수정 — `registerPlugin(NativeAdPlugin.class)` 등록 |

---

## 3. 빈도 제한 (Frequency Capping)

과도한 광고 노출은 유저 이탈의 주요 원인입니다. 아래 제한을 엄격히 적용합니다.

### 3.1 전체 제한

| 규칙 | 제한 |
|------|------|
| **전면 광고 간 최소 간격** | 5분 |
| **전면 광고 세션당 최대** | 3회 |
| **전면 광고 일일 최대** | 8회 |
| **보상형 광고 일일 최대** | 4회 (보상별 1회) |
| **앱 복귀 시 전면 광고** | 백그라운드 30분 이상일 때만 |
| **신규 유저 광고 유예** | 최초 3세션 동안 전면 광고 없음 |

### 3.2 신규 유저 온보딩 보호

| 단계 | 광고 정책 |
|------|-----------|
| **1~3세션** | 배너만 노출, 전면/보상형 없음 |
| **4~7세션** | 배너 + 보상형 허용, 전면 없음 |
| **8세션 이후** | 전체 광고 유형 활성화 |

---

## 4. 기술 구현 가이드

### 4.1 필수 패키지

```bash
# Capacitor AdMob 플러그인
npm install @capacitor-community/admob

# Capacitor 동기화
npx cap sync android
```

### 4.2 Android 설정

**`android/app/build.gradle`에 추가:**
```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-ads:23.6.0'
}
```

**`android/app/src/main/AndroidManifest.xml`에 추가:**
```xml
<manifest>
    <application>
        <!-- AdMob App ID -->
        <meta-data
            android:name="com.google.android.gms.ads.APPLICATION_ID"
            android:value="ca-app-pub-6654057059754695~XXXXXXXXXX"/>

        <!-- 선택: COPPA 대응 (13세 미만 타겟팅 시) -->
        <!-- <meta-data android:name="com.google.android.gms.ads.flag.NATIVE_AD_DEBUGGER" android:value="true"/> -->
    </application>
</manifest>
```

### 4.3 AdMob 초기화 코드

```javascript
import { AdMob, BannerAdSize, BannerAdPosition, AdmobConsentStatus } from '@capacitor-community/admob';

// 앱 시작 시 초기화
async function initializeAdMob() {
    await AdMob.initialize({
        initializeForTesting: false, // 프로덕션: false
        testingDevices: ['DEVICE_ID_HERE'], // 개발 시에만
    });

    // GDPR/동의 상태 확인 (유럽 유저 대응)
    const consentInfo = await AdMob.requestConsentInfo();
    if (consentInfo.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
    }
}
```

### 4.4 배너 광고 구현

```javascript
const AD_UNITS = {
    banner: 'ca-app-pub-6654057059754695/BANNER_ID',
    interstitial: 'ca-app-pub-6654057059754695/INTERSTITIAL_ID',
    rewarded: 'ca-app-pub-6654057059754695/REWARDED_ID',
};

// 배너 비노출 탭 목록
const BANNER_HIDDEN_TABS = ['quests', 'dungeon', 'reels'];

async function showBannerAd() {
    await AdMob.showBanner({
        adId: AD_UNITS.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 56, // 하단 네비게이션 높이(px)
    });
}

async function hideBannerAd() {
    await AdMob.hideBanner();
}

// 탭 전환 시 배너 표시/숨김
function onTabChange(tabName) {
    if (BANNER_HIDDEN_TABS.includes(tabName)) {
        hideBannerAd();
    } else {
        showBannerAd();
    }
}
```

### 4.5 전면 광고 구현

```javascript
let lastInterstitialTime = 0;
let sessionInterstitialCount = 0;
let tabSwitchCount = 0;
const INTERSTITIAL_MIN_INTERVAL = 5 * 60 * 1000; // 5분
const MAX_SESSION_INTERSTITIALS = 3;

async function preloadInterstitial() {
    await AdMob.prepareInterstitial({
        adId: AD_UNITS.interstitial,
    });
}

async function showInterstitialIfAllowed(trigger) {
    const now = Date.now();
    if (now - lastInterstitialTime < INTERSTITIAL_MIN_INTERVAL) return false;
    if (sessionInterstitialCount >= MAX_SESSION_INTERSTITIALS) return false;

    // 신규 유저 보호 (8세션 미만)
    if (getUserSessionCount() < 8) return false;

    try {
        await AdMob.showInterstitial();
        lastInterstitialTime = now;
        sessionInterstitialCount++;
        preloadInterstitial(); // 다음 광고 프리로드
        return true;
    } catch (e) {
        console.warn('Interstitial not ready:', e);
        preloadInterstitial();
        return false;
    }
}

// 탭 전환 시 3회마다 1회 전면 광고
function onTabSwitch(newTab) {
    tabSwitchCount++;
    if (tabSwitchCount % 3 === 0) {
        showInterstitialIfAllowed('tab_switch');
    }
}
```

### 4.6 보상형 광고 구현

```javascript
const dailyRewardCounts = {
    bonus_exp: 0,
    streak_recovery: 0,
    extra_raid: 0,
    highlight: 0,
};

async function showRewardedAd(rewardType) {
    if (dailyRewardCounts[rewardType] >= 1) {
        showToast('오늘은 이미 이 보상을 받았습니다.');
        return null;
    }

    // 보상형 광고 4세션 이후 허용
    if (getUserSessionCount() < 4) return null;

    await AdMob.prepareRewardItem({
        adId: AD_UNITS.rewarded,
    });

    const result = await AdMob.showRewardItem();

    if (result && result.type === 'rewarded') {
        dailyRewardCounts[rewardType]++;
        return applyReward(rewardType);
    }
    return null;
}

function applyReward(type) {
    switch (type) {
        case 'bonus_exp':
            addExp(50);
            return { message: 'EXP +50 획득!' };
        case 'streak_recovery':
            recoverStreak();
            return { message: '스트릭이 복구되었습니다!' };
        case 'extra_raid':
            grantExtraRaid();
            return { message: '추가 레이드 참여권 획득!' };
        case 'highlight':
            highlightReel();
            return { message: '릴스가 24시간 하이라이트됩니다!' };
    }
}
```

### 4.7 네이티브 광고 고급형 구현 (커스텀 Capacitor 플러그인)

`@capacitor-community/admob`은 네이티브 광고를 지원하지 않으므로 커스텀 Capacitor 플러그인으로 구현합니다.

**Step 1: NativeAdPlugin.java (Android 커스텀 플러그인)**

```java
// native-plugins/NativeAdPlugin.java
@CapacitorPlugin(name = "NativeAd")
public class NativeAdPlugin extends Plugin {
    // 주요 메서드:
    // loadAd(adId, isTesting) → AdLoader로 NativeAd 로드
    // showAd(x, y, width, height) → NativeAdView를 Activity root에 오버레이
    // updatePosition(y) → 스크롤 시 Y좌표 업데이트
    // hideAd() → 오버레이 숨김
    // destroyAd() → 리소스 해제
}
```

**Step 2: WebView 측 (app.js)**

```javascript
// 광고 단위 ID
const NATIVE_AD_UNIT_ID = 'ca-app-pub-6654057059754695/8612252339';
const NATIVE_AD_TEST_ID = 'ca-app-pub-3940256099942544/2247696110';
const NATIVE_AD_POSITION = 5; // 5번째 유저 카드 뒤

// renderUsers() 내에서 placeholder 삽입
// → loadAndShowNativeAd() 호출
// → setupNativeAdScrollSync() 스크롤 동기화
// → switchTab() 시 cleanupNativeAd() 정리
```

**Step 3: MainActivity 등록**

```java
import com.levelup.reboot.plugins.NativeAdPlugin;
// onCreate 내:
registerPlugin(NativeAdPlugin.class);
```

---

## 5. AdMob 광고 단위 ID 관리

### 5.1 필요한 광고 단위

| 광고 유형 | 용도 | Ad Unit ID | 상태 |
|-----------|------|------------|------|
| Adaptive Banner | 하단 배너 | 생성 필요 | ❌ 미생성 |
| Interstitial | 전면 광고 | 생성 필요 | ❌ 미생성 |
| Rewarded | 보상형 광고 | `ca-app-pub-6654057059754695/8552907541` | ✅ 구현 완료 |
| **Native Advanced** | **소셜탭 인라인 광고** | **`ca-app-pub-6654057059754695/8612252339`** | **🔧 구현 중** |

### 5.2 테스트용 Ad Unit ID (개발 시 사용)

```javascript
const TEST_AD_UNITS = {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
    native: 'ca-app-pub-3940256099942544/2247696110',
};
```

> ⚠️ **프로덕션 빌드 시 반드시 실제 Ad Unit ID로 교체 필요**

---

## 6. 수익 최적화 전략

### 6.1 eCPM 최적화

| 전략 | 설명 | 예상 효과 |
|------|------|-----------|
| **AdMob 미디에이션** | 여러 광고 네트워크 경쟁 입찰 | eCPM +20~40% |
| **워터폴 방식** | 고단가 네트워크 → 저단가 순서로 요청 | Fill Rate 95%+ 유지 |
| **A/B 테스트** | 배너 위치/전면 빈도 테스트 | ARPMAU +10~20% |

### 6.2 추천 미디에이션 네트워크

| 네트워크 | 강점 | 우선순위 |
|----------|------|----------|
| **AdMob** (기본) | 높은 Fill Rate, 안정성 | 1순위 |
| **Meta Audience Network** | 높은 eCPM (소셜 앱 적합) | 2순위 |
| **Unity Ads** | 보상형 광고 특화, 게임 카테고리 강점 | 3순위 |
| **AppLovin MAX** | 미디에이션 통합 관리 | Phase 2 |

### 6.3 시즌별 eCPM 변동 대응

| 시기 | eCPM 변동 | 전략 |
|------|-----------|------|
| **1~2월** | -20~30% (연초 광고주 예산 축소) | 보상형 광고 비중 확대 |
| **3~5월** | 평균 수준 | 기본 전략 유지 |
| **6~8월** | +5~10% | 전면 광고 빈도 소폭 증가 가능 |
| **11~12월** | +30~50% (블프, 연말 시즌) | 전면 광고 적극 노출, eCPM 극대화 |

---

## 7. 개인정보 및 규정 준수

### 7.1 필수 대응 사항

| 규정 | 대응 | 상태 |
|------|------|------|
| **개인정보처리방침** | AdMob 데이터 수집 명시 | ✅ 완료 (privacy.html) |
| **이용약관** | 광고 표시 조항 포함 | ✅ 완료 (terms.html) |
| **ads.txt** | 퍼블리셔 ID 등록 | ✅ 완료 (ads.txt) |
| **GDPR (유럽)** | UMP SDK 동의 양식 | 🔲 구현 필요 |
| **COPPA (미국)** | 13세 미만 대상 여부 설정 | 🔲 AdMob 콘솔 설정 필요 |
| **Google Play 광고 정책** | 광고 배치 가이드라인 준수 | 🔲 출시 전 검토 필요 |

### 7.2 Google Play 정책 체크리스트

- [ ] 광고가 앱 콘텐츠를 가리지 않음
- [ ] 실수로 광고를 클릭하기 어려운 배치
- [ ] 전면 광고에 닫기 버튼 명확히 표시
- [ ] 보상형 광고 시청이 앱 핵심 기능 이용의 전제 조건이 아님
- [ ] 아동 대상 콘텐츠에 맞춤 광고 미표시 (해당 시)

---

## 8. 구현 로드맵

### Phase 1: 기본 광고 (출시 시점)

| 태스크 | 우선순위 | 예상 소요 |
|--------|----------|-----------|
| AdMob 계정에서 Ad Unit ID 3개 생성 | 🔴 높음 | 10분 |
| `@capacitor-community/admob` 플러그인 설치 | 🔴 높음 | 30분 |
| AndroidManifest.xml App ID 설정 | 🔴 높음 | 10분 |
| 하단 Adaptive Banner 구현 | 🔴 높음 | 2시간 |
| 전면 광고 (탭 전환 + 퀘스트 완료) 구현 | 🔴 높음 | 3시간 |
| 빈도 제한 로직 구현 | 🔴 높음 | 2시간 |
| 신규 유저 광고 유예 로직 | 🟡 중간 | 1시간 |
| 테스트 Ad Unit으로 QA | 🔴 높음 | 2시간 |

### Phase 2: 보상형 광고 + 최적화 (출시 후 1~2주)

| 태스크 | 우선순위 | 예상 소요 |
|--------|----------|-----------|
| 보상형 광고 4종 구현 | 🟡 중간 | 4시간 |
| 보상 지급 서버 검증 (Cloud Functions) | 🟡 중간 | 3시간 |
| Remote Config로 광고 빈도 원격 조정 | 🟡 중간 | 2시간 |
| 광고 노출/클릭 Analytics 이벤트 추가 | 🟡 중간 | 1시간 |

### Phase 3: 미디에이션 + 수익 극대화 (출시 후 1~2개월)

| 태스크 | 우선순위 | 예상 소요 |
|--------|----------|-----------|
| AdMob 미디에이션 설정 (Meta, Unity Ads) | 🟢 낮음 | 반일 |
| A/B 테스트 (배너 위치, 전면 빈도) | 🟢 낮음 | 반일 |
| eCPM 모니터링 대시보드 구축 | 🟢 낮음 | 반일 |

---

## 9. KPI 및 모니터링

### 9.1 핵심 지표

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| **ARPMAU** | ≥ 900원/월 | AdMob 수익 ÷ MAU |
| **광고 Fill Rate** | ≥ 95% | AdMob 대시보드 |
| **eCPM (배너)** | ≥ $0.5 | AdMob 대시보드 |
| **eCPM (전면)** | ≥ $3.0 | AdMob 대시보드 |
| **eCPM (보상형)** | ≥ $8.0 | AdMob 대시보드 |
| **Day-7 리텐션** | ≥ 25% (광고 적용 후 변화 없음) | Firebase Analytics |
| **광고 기인 이탈률** | < 5% | 광고 노출 후 세션 종료 비율 |

### 9.2 알림 기준

| 상황 | 조치 |
|------|------|
| Fill Rate < 90% | 미디에이션 네트워크 추가 검토 |
| Day-7 리텐션 3%p 이상 하락 | 전면 광고 빈도 즉시 축소 |
| eCPM 전월 대비 30% 이상 하락 | 광고 단위/배치 재검토 |

---

## 10. 예상 수익 시뮬레이션

> firebase-cost-estimation.md 및 손익추정 보고서 기반

| MAU | 배너 수익 | 전면 수익 | 보상형 수익 | **월 총 수익** | Firebase 비용 | **순수익** |
|-----|-----------|-----------|-------------|----------------|---------------|------------|
| 1,000 | $2 | $3 | $2 | **~$7** | $0 | **+$7** |
| 5,000 | $10 | $18 | $12 | **~$40** | ~$2 | **+$38** |
| 10,000 | $20 | $40 | $30 | **~$90** | ~$6 | **+$84** |
| 30,000 | $65 | $130 | $95 | **~$290** | ~$20 | **+$270** |
| 50,000 | $110 | $220 | $160 | **~$490** | ~$35 | **+$455** |
| 100,000 | $220 | $450 | $330 | **~$1,000** | ~$65 | **+$935** |

> **가정:** 한국 시장 기준, DAU/MAU = 30%, 배너 eCPM $0.5, 전면 eCPM $3.0, 보상형 eCPM $8.0
> 보상형 참여율: DAU의 20%가 일 1회 시청

---

## 11. 리스크 및 완화 방안

| 리스크 | 영향 | 완화 방안 |
|--------|------|-----------|
| **광고 과다로 유저 이탈** | 리텐션 하락, MAU 감소 | 빈도 제한 엄격 적용 + Remote Config로 실시간 조절 |
| **AdMob 정책 위반으로 계정 정지** | 수익 전면 중단 | 정책 체크리스트 사전 검토 + 테스트 광고로 충분히 QA |
| **낮은 eCPM (한국 시장)** | 목표 ARPMAU 미달 | 미디에이션으로 광고 네트워크 다변화 |
| **광고 SDK 앱 크기 증가** | 설치 전환율 하락 | ProGuard/R8로 미사용 코드 제거 (~2MB 증가 예상) |
| **오프라인 시 광고 미노출** | 수익 기회 손실 | 현재 온라인 전용 앱이므로 영향 없음 |

---

## 12. 참고 자료

- [AdMob 정책 센터](https://support.google.com/admob/answer/6128543)
- [@capacitor-community/admob 문서](https://github.com/capacitor-community/admob)
- [Google UMP SDK (동의 관리)](https://developers.google.com/admob/android/privacy)
- 내부 문서: `docs/firebase-cost-estimation.md` — Firebase 비용 및 AdMob 수익 추정
- 내부 문서: `docs/플레이스토어_출시_무마케팅_시나리오별_손익추정_보고서.md` — 시나리오별 손익 분석
