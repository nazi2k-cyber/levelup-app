# Step 1: 모듈 분리 난이도 가이드

## 개요
app.js (11,631줄 → ~200줄 목표) 모듈 분리 5단계 계획 중 **Step 1** 대상 기능들의 난이도순 정리.

기존 8개 모듈이 `/modules/` 디렉토리에 IIFE + `window.*` 패턴으로 이미 추출되어 있으며, 동일 패턴을 따름.

---

## 난이도순 정리 (쉬운 → 어려운)

### 1. 약관 (Terms) — ★☆☆☆☆ [완료]
| 항목 | 내용 |
|------|------|
| 위치 | app.js ~6529-6539 (활성 코드), ~6541-6715 (주석 레거시) |
| 함수 | 0개 (정적 콘텐츠) |
| 결합도 | 없음 |
| 상태 | **완료** — 법적 콘텐츠는 이미 독립 HTML 페이지로 이전됨 (`terms.html`, `usage-policy.html`, `privacy.html`, `oss.html`). 주석 처리된 레거시 코드 175줄 제거 완료 |

**작업 내용:**
- `_legalContents_removed` 주석 블록 (175줄) 삭제
- `openLegalPage()` 함수는 유지 (HTML 페이지 오픈 기능)
- app.js: 11,629줄 → 11,454줄

---

### 2. 명언 (Quotes) — ★☆☆☆☆
| 항목 | 내용 |
|------|------|
| 위치 | app.js 4415-4503 |
| 함수 | `renderQuote()`, `copyQuoteText()` |
| 결합도 | 낮음 |
| 의존성 | `AppState.currentLang`, `i18n` (읽기 전용) |

**분리 포인트:**
- 외부 API 호출만 사용 (korean-advice-open-api, dummyjson)
- localStorage/Firestore 사용 안 함
- 캐시 변수 `_lastQuoteLang` 1개
- `modules/quotes.js`로 이동, `window.renderQuote`, `window.copyQuoteText` 노출

---

### 3. D-Day + Caption — ★★☆☆☆
| 항목 | 내용 |
|------|------|
| 위치 | app.js 10853-11228 |
| 함수 | 12개 |
| 결합도 | 중간 |
| 의존성 | `AppState.ddays`, `AppState.ddayCaption`, `i18n`, `saveUserData()`, `window.AdManager`, Capacitor LocalNotifications |

**분리 포인트:**
- D-Day (8함수): `renderDDayList`, `openDDayAddModal`, `openDDayEditModal`, `_openDDayFormModal`, `selectDDayType`, `saveDDayFromModal`, `deleteDDay`, `closeDDayModal`, `scheduleDDayNotifications`
- Caption (4함수): `renderDDayCaption`, `openDDayCaptionEdit`, `saveDDayCaption`, `closeDDayCaptionModal`
- `modules/dday.js`로 합쳐서 이동

---

### 4. Life Status (인생 현황) — ★★★☆☆
| 항목 | 내용 |
|------|------|
| 위치 | app.js 11232-11555 |
| 함수 | 9개 |
| 결합도 | 중간 |
| 의존성 | `AppState.currentLang`, `i18n`, `saveUserData()`, localStorage (`life_status_config`, `life_status_privacy_consent`) |

**분리 포인트:**
- GDPR 스타일 개인정보 동의 모달 포함 (복잡도 약간 높음)
- `modules/life-status.js`로 이동

---

### 5. 챌린지 (Weekly Challenges) — ★★★☆☆
| 항목 | 내용 |
|------|------|
| 위치 | app.js 6718-6815 |
| 함수 | 4개 (`getWeeklyChallenges`, `updateChallengeProgress`, `renderWeeklyChallenges`, `claimChallenge`) |
| 결합도 | 중간 |
| 의존성 | `AppState.user.points`, `AppState.user.pendingStats`, `statKeys`, `getWeekStartDate()`, localStorage |

**분리 포인트:**
- 퀘스트/던전 완료 데이터에 의존 → 인터페이스 설계 필요
- 룰렛과 합쳐서 `modules/challenge-roulette.js`로 이동 권장

---

### 6. 룰렛 (Daily Bonus Roulette) — ★★★★☆
| 항목 | 내용 |
|------|------|
| 위치 | app.js 6818-7040 |
| 함수 | 8개 |
| 결합도 | 높음 |
| 의존성 | `AppState.quest.completedState`, `AppState.user.points/pendingStats`, `getTodayKST()`, Canvas 2D API, localStorage |

**분리 포인트:**
- Canvas 2D 룰렛 휠 + 스핀 애니메이션
- 24시간 쿨다운 타이머
- 퀘스트 1개 이상 완료 시 활성화 조건
- 챌린지와 합쳐서 `modules/challenge-roulette.js`로 이동 권장

---

### 7. Reels (릴스/Day1) — ★★★★★
| 항목 | 내용 |
|------|------|
| 위치 | app.js 7638-9354 |
| 함수 | 50개+ |
| 결합도 | 매우 높음 |
| 의존성 | Firebase (Firestore + Storage), `window.SocialModule`, `window.AdManager`, 이미지 압축 유틸, `AppState.user` 전체 |

**분리 포인트:**
- Step 1 최대 덩어리 (~1,720줄)
- SNS 피드: 이미지 업로드/압축, 좋아요/댓글/신고, 친구 정렬, 플래너 복사
- Firebase 3개 서비스 사용 (Auth, Firestore, Storage)
- 소셜 모듈과 강하게 결합
- **마지막에 분리 권장**

---

## 예상 제거량 요약

| 순서 | 기능 | 제거량 | 누적 |
|------|------|--------|------|
| 1 | 약관 (완료) | 175줄 | 175줄 |
| 2 | 명언 | ~90줄 | ~265줄 |
| 3 | D-Day + Caption | ~380줄 | ~645줄 |
| 4 | Life Status | ~325줄 | ~970줄 |
| 5 | 챌린지 | ~100줄 | ~1,070줄 |
| 6 | 룰렛 | ~225줄 | ~1,295줄 |
| 7 | Reels | ~1,720줄 | ~3,015줄 |

## 기존 모듈 패턴 (준수 필수)

```javascript
// modules/example.js
(function() {
    'use strict';
    const AppState = window.AppState;
    const i18n = window.i18n;

    // ... 모듈 코드 ...

    // Public API
    window.functionName = function() { ... };
})();
```

app.js 하단에 dynamic import 추가:
```javascript
import('./modules/example.js').catch(e => console.error('[Example] 모듈 로드 실패:', e));
```
