# 스트릭(Streak) 시스템 기술 문서

---

## 목차

1. [개요](#1-개요)
2. [데이터 구조](#2-데이터-구조)
3. [핵심 로직](#3-핵심-로직)
4. [스탯 감소 메커니즘](#4-스탯-감소-메커니즘)
5. [보상 배율 시스템](#5-보상-배율-시스템)
6. [희귀 칭호 시스템](#6-희귀-칭호-시스템)
7. [주간 챌린지 연동](#7-주간-챌린지-연동)
8. [푸시 알림](#8-푸시-알림)
9. [UI 표시](#9-ui-표시)
10. [데이터 플로우](#10-데이터-플로우)
11. [엣지 케이스 및 주의사항](#11-엣지-케이스-및-주의사항)

---

## 1. 개요

스트릭 시스템은 사용자의 **연속 접속 일수**를 추적하고, 이에 따라 보상 배율 증가·스탯 감소·희귀 칭호 해금 등을 관리하는 게이미피케이션 핵심 모듈이다.

### 주요 기능

| 기능 | 설명 |
|------|------|
| 연속 접속 추적 | 매일 퀘스트/던전 완료 시 스트릭 +1 |
| 보상 배율 | 스트릭 일수에 따라 1.0x ~ 3.0x 배율 적용 |
| 스탯 감소 | 4일 이상 미접속 시 전체 스탯 자동 감소 |
| 희귀 칭호 | 7/14/30/60/100일 마일스톤 달성 시 칭호 해금 |
| 푸시 알림 | 2일 미접속 경고, 3일+ 끊김 알림 |
| 주간 챌린지 | 5일 연속 접속 챌린지 연동 |

---

## 2. 데이터 구조

### 2.1 Firestore 스키마 (`users/{uid}`)

```
streak: {
  currentStreak: number    // 현재 연속 접속 일수 (>= 0)
  lastActiveDate: string   // 마지막 활동일 (YYYY-MM-DD) 또는 null
  multiplier: number       // 보상 배율 (1.0 / 1.2 / 1.5 / 2.0 / 3.0)
}
```

> **참고:** `streakStr` 필드에 JSON 문자열로 직렬화한 백업 데이터도 저장된다 (최대 5000자). `streak` 맵 파싱 실패 시 폴백으로 사용.

### 2.2 Firestore 규칙 (`firestore.rules:27-34`)

```
streak: {
  currentStreak: number (>= 0)
  lastActiveDate: string | null
  multiplier: number (>= 0)
}
streakStr: string (max 5000 chars)
```

### 2.3 초기값 (`app.js:685`)

```javascript
streak: {
  currentStreak: 0,
  lastActiveDate: null,
  multiplier: 1.0
}
```

---

## 3. 핵심 로직

### 3.1 날짜 유틸리티

#### `getTodayStr()` — `app.js:2281`

```javascript
function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
```

브라우저 로컬 타임존 기준으로 오늘 날짜를 `YYYY-MM-DD` 형식으로 반환한다.

#### `getDaysBetween(dateStr1, dateStr2)` — `app.js:2286`

```javascript
function getDaysBetween(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return Infinity;
    const d1 = new Date(dateStr1); d1.setHours(0,0,0,0);
    const d2 = new Date(dateStr2); d2.setHours(0,0,0,0);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}
```

두 날짜 문자열 간 **정수 일수 차이**를 계산한다. 시간 성분을 0으로 초기화하여 순수 날짜 차이만 반환.

### 3.2 배율 계산

#### `getStreakMultiplier(streak)` — `app.js:2293`

```javascript
function getStreakMultiplier(streak) {
    if (streak >= 30) return 3.0;
    if (streak >= 14) return 2.0;
    if (streak >= 7)  return 1.5;
    if (streak >= 3)  return 1.2;
    return 1.0;
}
```

| 연속 일수 | 배율 |
|:---------:|:----:|
| 1~2일 | 1.0x |
| 3~6일 | 1.2x |
| 7~13일 | 1.5x |
| 14~29일 | 2.0x |
| 30일+ | 3.0x |

### 3.3 스트릭 초기화 및 감소 적용

#### `applyStreakAndDecay()` — `app.js:2301-2336`

앱 로딩(사용자 데이터 로드) 시 호출된다.

**처리 흐름:**

```
1. lastActiveDate가 null → 오늘로 설정, 감소 없음 (최초 접속)
2. gap = getDaysBetween(lastActiveDate, today) 계산
3. gap <= 1 → 변경 없음 (당일 또는 어제 접속)
4. gap > 1 (2일 이상 미접속):
   a. currentStreak = 0 (스트릭 초기화)
   b. gap > 3 → 스탯 감소 적용 (§4 참조)
   c. multiplier 재계산
```

### 3.4 일일 스트릭 갱신

#### `updateStreak()` — `app.js:2338-2363`

퀘스트 완료·DIY 퀘스트 완료·던전 보스 처치 시 호출된다.

**트리거 위치:**
- 퀘스트 완료 — `app.js:2974`
- DIY 퀘스트 완료 — `app.js:3058`
- 던전 보스 처치 — `app.js:3935`

**처리 흐름:**

```
1. lastActiveDate === today → 이미 갱신됨, 종료
2. gap = getDaysBetween(lastActiveDate, today)
3. gap === 1 → currentStreak++ (연속 접속)
4. gap > 1 또는 lastActive 없음 → currentStreak = 1 (새로 시작)
5. lastActiveDate = today 갱신
6. multiplier 재계산
7. 주간 챌린지 진행도 업데이트 (streak_days)
8. 스트릭 기반 희귀 칭호 확인
9. 뱃지 렌더링 및 데이터 저장
```

---

## 4. 스탯 감소 메커니즘

### 4.1 발동 조건

- **미접속 4일 이상** (gap > 3)부터 스탯 감소 시작
- `applyStreakAndDecay()` 내에서 처리 (`app.js:2319-2321`)

### 4.2 감소 공식

```
decayAmount = Math.min(gap - 3, 30) × 0.1
```

| 미접속 일수 | 감소량 (스탯당) | 비고 |
|:-----------:|:---------------:|:----:|
| 1~3일 | 0 | 감소 없음 |
| 4일 | 0.1 | 최소 감소 |
| 5일 | 0.2 | |
| 10일 | 0.7 | |
| 20일 | 1.7 | |
| 33일+ | 3.0 | **최대 캡** |

### 4.3 적용 대상

6개 전체 스탯에 동일 감소량 적용:

| 스탯 | 약자 |
|------|------|
| 근력 | STR |
| 지능 | INT |
| 매력 | CHA |
| 체력 | VIT |
| 재력 | WLTH |
| 민첩 | AGI |

- **최소값:** 0 (음수 방지)
- 감소 후 사용자에게 `stat_decay_warning` 메시지 표시

---

## 5. 보상 배율 시스템

### 5.1 적용 범위

스트릭 배율은 **퀘스트/던전 보상**에 적용된다.

#### 퀘스트 보상 적용 (`app.js:2955, 3039`)

```javascript
const mult = AppState.user.streak.multiplier || 1.0;

let pointReward = 20;     // 기본 20포인트
let statReward = 0.5;     // 기본 0.5 스탯

pointReward *= mult;      // 배율 적용
statReward *= mult;       // 배율 적용

// 크리티컬 히트와 중첩 가능
if (rollCritical()) {
    const critMult = getCriticalMultiplier();
    pointReward *= critMult;
    statReward *= critMult;
}
```

### 5.2 배율 갱신 시점

- `applyStreakAndDecay()` 실행 시 (앱 로딩)
- `updateStreak()` 실행 시 (퀘스트/던전 완료)
- 세션 중간에 감소하지 않음 (스트릭 리셋 시에만 변경)

---

## 6. 희귀 칭호 시스템

### 6.1 칭호 목록 (`data.js:885-891`)

| 마일스톤 | 아이콘 | 등급 | 한국어 | English | 日本語 |
|:--------:|:------:|:----:|--------|---------|--------|
| 7일 | 🔥 | Uncommon | 주간 전사 | Weekly Warrior | 週間戦士 |
| 14일 | ⚡ | Rare | 불굴의 투사 | Indomitable Fighter | 不屈の闘士 |
| 30일 | 💫 | Rare | 월간 수호자 | Monthly Guardian | 月間守護者 |
| 60일 | 🌟 | Epic | 강철 의지 | Iron Will | 鋼鉄の意志 |
| 100일 | 🏆 | Legendary | 전설의 불꽃 | Legendary Flame | 伝説の炎 |

### 6.2 해금 로직 (`app.js:2400-2421`)

#### `checkStreakRareTitles()`

```javascript
function checkStreakRareTitles() {
    const streak = AppState.user.streak.currentStreak;
    
    rareStreakTitles.forEach(rt => {
        const titleId = `streak_${rt.days}`;
        // 이미 해금된 칭호는 건너뜀
        if (streak >= rt.days && !AppState.user.rareTitle.unlocked.find(u => u.id === titleId)) {
            AppState.user.rareTitle.unlocked.push({
                id: titleId,
                type: 'streak',
                rarity: rt.rarity,
                icon: rt.icon,
                title: rt.title,
                unlockedAt: new Date().toISOString()
            });
        }
    });
}
```

- `updateStreak()` 내에서 매번 호출
- 한 번 해금된 칭호는 스트릭이 초기화되어도 유지됨
- `unlockedAt` 타임스탬프로 해금 시점 기록

---

## 7. 주간 챌린지 연동

### 7.1 챌린지 정의 (`app.js:6083-6102`)

```javascript
{
  id: 'streak_days',
  target: 5,                    // 5일 연속 접속
  reward: {
    points: 200,
    stat: 'random',
    statVal: 1.5
  },
  name: {
    ko: '연속 접속 달인',
    en: 'Streak Champion',
    ja: 'ストリーク達人'
  },
  desc: {
    ko: '이번 주 5일 연속 접속',
    en: 'Login 5 days in a row this week',
    ja: '今週5日連続ログイン'
  }
}
```

### 7.2 진행도 업데이트 (`app.js:2358`)

```javascript
const streakCh = chData.challenges.find(c => c.id === 'streak_days');
if (streakCh && !streakCh.claimed) {
    streakCh.progress = Math.min(streakCh.target, AppState.user.streak.currentStreak);
}
```

- `updateStreak()` 호출 시 자동으로 현재 스트릭 카운트를 챌린지 진행도에 반영
- 이미 보상을 수령한 경우(`claimed`) 갱신하지 않음

---

## 8. 푸시 알림

### 8.1 스케줄 함수 (`functions/index.js:1446-1515`)

#### `sendStreakWarnings`

- **실행 주기:** 매일 21:00 KST
- **대상:** `pushEnabled: true` && 유효한 `fcmToken`을 가진 사용자

### 8.2 알림 유형

#### 경고 (2일 미접속)

| 언어 | 제목 | 본문 |
|------|------|------|
| KO | 🔥 스트릭이 위험해요! | 2일째 미접속 중입니다. 내일까지 접속하지 않으면 스탯이 감소합니다! |
| EN | 🔥 Your streak is at risk! | You've been away for 2 days. Log in before tomorrow or your stats will decay! |
| JA | 🔥 ストリークが危険です! | 2日間未接続です。明日までにログインしないとステータスが減少します! |

#### 끊김 알림 (3일+ 미접속)

| 언어 | 제목 | 본문 |
|------|------|------|
| KO | 💔 스트릭이 끊어졌습니다 | 스탯 감소가 시작됩니다. 지금 접속하여 다시 쌓아보세요! |
| EN | 💔 Streak broken | Stat decay has begun. Log in now to start rebuilding! |
| JA | 💔 ストリークが途切れました | ステータス減少が始まりました。今すぐログインして立て直しましょう! |

### 8.3 비활성 토큰 정리 (`functions/index.js:1560-1587`)

#### `cleanupInactiveTokens`

- **실행 주기:** 매주 일요일 03:00 KST
- **동작:** 30일 이상 미접속 사용자의 FCM 토큰 제거
- `streak.lastActiveDate` 기준으로 비활성 판단

---

## 9. UI 표시

### 9.1 스트릭 뱃지 HTML (`app.html:175-177`)

```html
<div class="streak-badge d-none" id="streak-badge" title="Streak">
    <span class="streak-icon">🔥</span>
    <span id="streak-count">0</span>
    <span id="streak-day-label">일</span>
</div>
```

### 9.2 CSS 스타일링 (`style.css:612-625`)

- **배경:** 오렌지 그라데이션 (`rgba(255,100,0,0.15)`)
- **테두리:** `1px solid #ff6a00`
- **폰트:** 0.75rem, font-weight 900
- **불꽃 애니메이션:** 7일 이상 스트릭 시 `.fire` 클래스 활성화
  - `streakPulse` 키프레임 애니메이션
  - 오렌지 글로우 그림자 효과

### 9.3 렌더링 로직 (`app.js:2365-2380`)

#### `renderStreakBadge()`

```javascript
function renderStreakBadge() {
    const badge = document.getElementById('streak-badge');
    const countEl = document.getElementById('streak-count');
    const dayLabel = document.getElementById('streak-day-label');

    const streak = AppState.user.streak.currentStreak;
    if (streak > 0) {
        badge.classList.remove('d-none');
        badge.classList.toggle('fire', streak >= 7);  // 7일+ 불꽃 애니메이션
        countEl.textContent = streak;
        dayLabel.textContent = i18n[currentLang]?.streak_day || '일';
    } else {
        badge.classList.add('d-none');
    }
}
```

**표시 규칙:**
- `currentStreak === 0` → 뱃지 숨김
- `currentStreak > 0` → 일수 표시
- `currentStreak >= 7` → 불꽃 애니메이션 활성화

---

## 10. 데이터 플로우

### 10.1 전체 흐름도

```
┌─────────────────────────────────────────────────────────┐
│                    클라이언트 (브라우저)                    │
│                                                         │
│  퀘스트/던전 완료                                         │
│       │                                                 │
│       ▼                                                 │
│  updateStreak()                                         │
│   ├─ currentStreak 갱신                                  │
│   ├─ multiplier 재계산                                   │
│   ├─ 주간 챌린지 진행도 업데이트                             │
│   ├─ 희귀 칭호 확인                                       │
│   └─ renderStreakBadge()                                │
│       │                                                 │
│       ▼                                                 │
│  saveUserData() (2초 디바운스)                             │
│       │                                                 │
└───────┼─────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────┐     ┌───────────────────────────┐
│    Firestore           │     │   Cloud Functions          │
│                       │     │                           │
│  users/{uid}          │◄────│  sendStreakWarnings()      │
│   ├─ streak (map)     │     │   매일 21:00 KST          │
│   └─ streakStr (JSON) │     │   streak 기반 알림 발송     │
│                       │     │                           │
│                       │◄────│  cleanupInactiveTokens()  │
│                       │     │   매주 일요일 03:00 KST     │
│                       │     │   30일+ 비활성 토큰 정리    │
└───────────────────────┘     └───────────────────────────┘
```

### 10.2 앱 로딩 시 흐름

```
앱 시작 → Firestore에서 사용자 데이터 로드
       → applyStreakAndDecay() 호출
         ├─ 미접속 기간 계산
         ├─ 스트릭 초기화 (2일+ 미접속 시)
         ├─ 스탯 감소 적용 (4일+ 미접속 시)
         └─ multiplier 재계산
       → renderStreakBadge()
```

---

## 11. 엣지 케이스 및 주의사항

### 11.1 최초 로그인

- `lastActiveDate`가 `null`인 경우 오늘 날짜로 초기화
- 스탯 감소 없음
- `currentStreak`은 0 유지 (첫 퀘스트 완료 시 1로 설정)

### 11.2 타임존 처리

- `getTodayStr()`는 **브라우저 로컬 타임존** 사용 (UTC 변환 없음)
- 다른 타임존에서 접속할 경우 같은 날이라도 날짜 문자열이 달라질 수 있음
- 해외 여행 등으로 타임존 변경 시 의도치 않은 스트릭 초기화 가능성 존재

### 11.3 멀티 탭/디바이스 동기화

- Firestore 로컬 캐시를 통한 동기화
- 동시 업데이트 시 **last-write-wins** 정책
- `saveUserData()`의 2초 디바운스로 빈번한 연속 저장 방지

### 11.4 배율 유지 규칙

- 세션 중간에는 배율이 감소하지 않음
- `applyStreakAndDecay()` 또는 `updateStreak()`에서만 재계산
- 스트릭이 0으로 초기화되면 배율도 1.0으로 리셋

### 11.5 칭호 영구 보존

- 한 번 해금된 희귀 칭호는 스트릭 초기화 후에도 유지
- `rareTitle.unlocked` 배열에 영구 저장

---

## 참조 파일 목록

| 파일 | 역할 | 주요 라인 |
|------|------|-----------|
| `www/app.js` | 핵심 스트릭 로직 및 UI | 685, 2281-2421, 2953-2976, 3035-3068, 3935, 6083-6102 |
| `www/data.js` | 상수, 칭호 데이터, i18n | 63-70, 293-298, 885-891 |
| `www/app.html` | 스트릭 뱃지 HTML | 175-177 |
| `style.css` | 뱃지 스타일링 및 애니메이션 | 612-625 |
| `functions/index.js` | Cloud Functions (알림, 정리) | 289-297, 913-921, 1340-1349, 1446-1515, 1560-1587 |
| `firestore.rules` | Firestore 스키마 검증 | 27-34 |

---

## i18n 키 목록

| 키 | 용도 |
|----|------|
| `streak_label` | 표시 라벨 ("연속" / "Streak") |
| `streak_day` | 단위 ("일" / "days") |
| `streak_bonus` | "스트릭 보너스" / "Streak Bonus" |
| `streak_lost` | "스트릭이 초기화되었습니다!" / "Streak has been reset!" |
| `streak_multiplier` | "보상 배율" / "Reward Multiplier" |
| `stat_decay_warning` | "미접속으로 스탯이 감소했습니다." / "Stats decreased due to inactivity." |
| `rare_title_streak_label` | "스트릭 호칭" / "Streak Title" |
| `rare_title_streak_section` | "스트릭 달성 호칭" / "Streak Titles" |
