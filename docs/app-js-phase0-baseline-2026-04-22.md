# app.js 도메인 모듈 분리 Phase 0 — Baseline (2026-04-22)

- 작성일: 2026-04-22 (UTC)
- 목적: 리팩토링 전 기준선(Baseline) 고정 및 회귀 감지 기준 명시
- 대상: `www/app.js`

## 1) 정량 기준선

- 파일 라인 수: **9,469 lines**
- 파일 크기: **459,384 bytes**
- `window.<symbol> =` 수: **116**
- `Object.defineProperty(window, ...)` 수: **2**

## 2) 콘솔 에러 수집 규칙 (고정)

Phase 0 이후 모든 단계에서 아래 **3개 시점**을 동일하게 수집한다.

1. **초기 로드 직후**
   - 조건: 첫 화면 완전 렌더 후 10초 이내
   - 수집: Console `error`/`warn`, Network 실패 요청
2. **탭 전환 직후**
   - 조건: 주요 탭(예: Quest/Planner/Profile) 3회 이상 이동 후
   - 수집: 전역 핸들러 누락, 렌더링 예외, 비동기 모듈 로드 실패
3. **로그인 직후**
   - 조건: 로그인 성공 이벤트 후 30초 이내
   - 수집: 권한/Firestore/Auth/AppCheck 관련 에러

### 수집 포맷

- Timestamp (UTC)
- Build/Branch
- 시점(초기 로드/탭 전환/로그인 직후)
- 에러 원문(요약)
- 재현 절차
- 판정(`new`/`known`)

## 3) 산출물 링크

- 도메인별 수동 QA 체크리스트:
  - `docs/app-js-phase0-도메인별-수동-QA-체크리스트-2026-04-22.md`
- `window.*` export 스냅샷:
  - `docs/app-js-phase0-window-export-스냅샷-2026-04-22.md`

## 4) 확인 로그 (1회)

- 실행 일시(UTC): 2026-04-22
- 확인 명령:
  - `wc -l www/app.js`
  - `wc -c www/app.js`
  - `rg -n "window\.[A-Za-z0-9_\$]+\s*=" www/app.js | wc -l`
- 결과:
  - `9469 www/app.js`
  - `459384 www/app.js`
  - `116`

> 본 문서는 Phase 0 완료 기준인 “현행 기준(Baseline) 문서 + 확인 로그 1회”를 충족한다.
