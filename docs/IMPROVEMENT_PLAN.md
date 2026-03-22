# 모바일앱 완성도 보고서 기반 — 시스템 영향도 낮은 단계별 개선 계획

- 기준 문서: `모바일앱_완성도_분석_및_예상이용자수_산출_보고서.md`
- 작성일: 2026-03-22
- 현재 종합 완성도: **74/100점**

## Context

**문제**: 모바일앱 완성도 분석 보고서(74/100점)에서 기술/품질(62점)이 가장 낮은 점수를 받았고, 보안 취약점, 테스트 부재, 분석 도구 미비, 리텐션 장치 부족 등이 지적됨. 12개월 MAU 1.2만→3만 성장을 위해 리텐션 개선과 성장 루프 구축이 필수.

**목표**: 기존 시스템을 파괴하지 않는 **추가적(additive)** 변경으로, 보고서에서 지적된 핵심 약점을 단계적으로 해소. 각 단계는 독립 배포 가능하며, 1~2일 작업 분량.

**구현 범위**: Phase 1~3 (보안 강화 → Analytics 퍼널 → 리텐션 장치). Phase 4~5는 향후 참고용.

**기술 스택**: Vanilla JS PWA + Capacitor 6.2 / Firebase BaaS / 단일 app.js(7,339줄)

---

## Phase 1: 보안 강화 및 입력 검증 보완 (기술/품질 ↑)

> 영향도: **매우 낮음** — 기존 sanitize 함수 활용, innerHTML 호출부에 래핑 추가만

**배경**: `sanitizeText()`, `sanitizeAttr()`, `sanitizeInstaId()`, `sanitizeURL()` 함수가 이미 app.js:7315-7339에 존재. innerHTML 사용 84곳 중 사용자 입력이 직접 들어가는 곳을 점검하여 누락된 sanitize 호출 추가.

### 작업 항목

1. **innerHTML에 사용자 입력이 들어가는 곳 전수 점검 및 sanitize 래핑**
   - 파일: `www/app.js`
   - `.replace(/</g,'&lt;')` 부분 호출(7곳)을 `sanitizeText()`로 일괄 교체
   - 소셜 피드/댓글 렌더링 코드에서 사용자 이름, 댓글 내용 등 sanitize 통일

2. **logger.js XSS 취약점 수정**
   - 파일: `www/logger.js`
   - `openViewer()` 함수(line 236-247)에서 `l.msg`, `l.stack`이 sanitize 없이 innerHTML에 삽입됨
   - `escapeHtml()` 헬퍼 추가 후 적용

3. **CSP(Content Security Policy) 메타 태그 추가**
   - 파일: `www/app.html`
   - `<meta http-equiv="Content-Security-Policy">` 추가

4. **Firestore Rules 입력값 추가 검증**
   - 파일: `firestore.rules`
   - 문자열 필드 길이 제한 강화 (name ≤30자, instaId ≤30자)

### 대상 파일
- `www/app.js` — sanitize 호출 통일 (`.replace` → `sanitizeText`)
- `www/logger.js` — openViewer HTML 출력 sanitize
- `www/app.html` — CSP 메타 태그
- `firestore.rules` — 필드 길이 검증 강화

---

## Phase 2: Firebase Analytics 퍼널 계측 도입 (성장 준비도 ↑)

> 영향도: **낮음** — Firebase Analytics SDK import 추가 + 이벤트 로깅 함수 삽입만

**배경**: 현재 앱에 analytics/이벤트 추적이 전혀 없음. `measurementId: "G-4DBGG03CCJ"`가 config에 이미 존재하지만 SDK를 import하지 않음. 보고서에서 "퍼널 계측(노출→설치→가입→7일 유지) 고도화 필요"로 지적.

### 작업 항목

1. **Firebase Analytics SDK import 및 초기화**
   - 파일: `www/app.js` (상단 import 영역)
   - `firebase-analytics.js` import + `getAnalytics(app)` 초기화

2. **핵심 퍼널 이벤트 로깅**
   - `sign_up` / `login` / `quest_complete` / `raid_join`
   - `streak_milestone` / `level_up` / `day1_post` / `friend_add`
   - 각 이벤트 발생 지점에 `logEvent()` 호출 1줄 추가

3. **Service Worker 캐시에 analytics SDK 추가**
   - 파일: `www/sw.js` (FIREBASE_CDN 배열)

### 대상 파일
- `www/app.js` — import + logEvent 호출들
- `www/sw.js` — CDN 캐시 목록

---

## Phase 3: 리텐션 강화 장치 (제품 경쟁력 유지 + 운영/사업성 ↑)

> 영향도: **낮음** — 신규 UI 컴포넌트 추가 + Cloud Functions 스케줄러 보강

**배경**: 보고서 Phase 1(0-30일) 권고 — "신규 가입 24시간 내 2회 이상 재방문 유도 장치 도입"

### 작업 항목

1. **신규 유저 환영 보상 시스템 (Welcome Bonus)**
   - 가입 후 첫 로그인 시 "환영 보상" 모달 (보너스 포인트 + 첫 퀘스트 안내)
   - Firestore `users/{uid}` 필드에 `welcomeBonusClaimed: boolean` 추가

2. **컴백 보상 알림 강화**
   - `functions/index.js`에 `sendNewUserReminder` 스케줄 함수 추가
   - 가입 후 24시간 내 미방문 유저 대상 리마인드 푸시

3. **일일 출석 체크 보상 UI**
   - 앱 진입 시 "오늘의 출석 보상" 토스트 표시
   - 연속 출석 일수에 따른 보너스 포인트 차등 지급 (기존 streak 연동)

4. **다국어 번역 추가**
   - `www/data.js` (KO/EN/JP 번역 키 추가)

### 대상 파일
- `www/app.js` — 환영 보상 로직 + 출석 체크 UI
- `www/app.html` — 모달 마크업
- `www/style.css` — 스타일
- `www/data.js` — 번역
- `functions/index.js` — 신규 유저 리마인드 함수
- `firestore.rules` — 필드 추가

---

## Phase 4: 초대/추천 시스템 구축 (성장 준비도 ↑↑) — *향후 참고*

> 영향도: **중간-낮음**

- 유저별 고유 초대 코드 자동 생성 + 양방향 보상
- 설정 탭 내 초대 UI + 회원가입 시 코드 입력
- Cloud Function으로 보상 처리

---

## Phase 5: 주간 시즌 이벤트 프레임워크 (운영/사업성 ↑↑) — *향후 참고*

> 영향도: **중간-낮음**

- Firestore `app_config/events` 기반 서버 주도 이벤트 시스템
- 이벤트 배너 + 보상 배율 적용
- Admin 이벤트 관리 UI

---

## 완성도 점수 예상 변화

| 평가영역 | 현재 | Phase 1 후 | Phase 2 후 | Phase 3 후 |
|---|---:|---:|---:|---:|
| 제품 경쟁력 (30%) | 88 | 88 | 88 | 90 |
| 기술/품질 (30%) | 62 | 68 | 72 | 72 |
| 운영/사업성 (20%) | 68 | 68 | 68 | 72 |
| 성장 준비도 (20%) | 77 | 77 | 82 | 85 |
| **총점** | **74.0** | **76.2** | **78.8** | **80.4** |

> Phase 1~3 완료 시 총점 74.0 → **80.4** (+6.4점 향상)

---

## 검증 방법

### 각 Phase 공통
1. `sync-www` 스크립트로 www/ 동기화 확인
2. 브라우저에서 `app.html` 로드 → 콘솔 에러 없음 확인
3. Firebase Emulator 또는 실제 환경에서 Firestore rules 테스트

### Phase별 검증
- **Phase 1**: XSS 페이로드 입력 → 렌더링 시 실행 안 됨 확인
- **Phase 2**: Firebase Console > Analytics 대시보드에서 이벤트 수신 확인
- **Phase 3**: 신규 계정 생성 후 환영 보상 모달 표시 + 출석 체크 포인트 지급 확인

### 회귀 테스트 체크리스트
- [ ] 로그인/로그아웃 정상 동작
- [ ] 퀘스트 완료 및 포인트 적립
- [ ] 레이드 참여 및 데미지 기록
- [ ] Day1 포스트 작성/삭제
- [ ] 친구 추가/삭제
- [ ] 설정 변경 (언어, 테마, 푸시)
- [ ] 오프라인→온라인 전환 시 데이터 동기화
