# Firestore Permission-Denied 근본 해결 보고서

**날짜**: 2026-04-02  
**PR**: #486  
**영향**: 모든 사용자의 users 컬렉션 쓰기 실패 (permission-denied)

---

## 증상

- 앱 로그인 후 모든 Firestore 저장(`updateDoc`, `setDoc({merge:true})`)이 `Missing or insufficient permissions` 오류로 실패
- 클라이언트 진단 로그(`[SaveDiag]`)에서는 "모든 필드 검증 통과"로 표시
- `usernames` 컬렉션 읽기/쓰기는 정상 동작 (닉네임 변경 성공)
- Storage 업로드도 정상 동작

## 근본 원인

**Firestore 보안 규칙 표현식 평가 한도 초과**

`isValidUserData()` 단일 함수에 다음이 합산되어 Firestore의 요청당 표현식 한도를 초과:

1. `areWrittenFieldsAllowed()`: `request.resource.data.diff(resource.data).affectedKeys().hasOnly(38개 필드 리스트)` — 36개 필드 비교 + 38개 허용 목록 매칭으로 대량의 표현식 소비
2. 개별 필드 타입 검증 36개+ `&&` 조건
3. `isValidStatsMap` x2, `isValidStreakMap`, `isValidStepData` 등 중첩 함수 호출

Firestore는 표현식 한도 초과 시 구체적인 오류 메시지 없이 `permission-denied`를 반환하므로, 클라이언트에서는 원인을 특정할 수 없었음.

## 디버깅 과정 (바이너리 서치)

단계적으로 검증 조건을 분리하여 실패 지점을 추적:

| # | 구성 | 조건 수 | 결과 |
|---|------|---------|------|
| 1 | 검증 완전 제거 | 0 | ✅ 성공 |
| 2 | `areWrittenFieldsAllowed()` only | ~5 | ✅ 성공 |
| 3 | + PartA (핵심+맵+배열+불리언) | ~20 | ✅ 성공 |
| 4 | + PartB1 (짧은 문자열+숫자 6개) | ~26 | ✅ 성공 |
| 5 | + PartB2a (JSON 문자열 8개) | ~34 | ❌ 실패 |
| 6 | `areWrittenFieldsAllowed()` 제거 + Part1 + Part2(전체) | ~37 | ❌ 실패 |
| 7 | `areWrittenFieldsAllowed()` 제거 + Part1 only | ~21 | ✅ 성공 |

**결론**: `areWrittenFieldsAllowed()`의 `diff().affectedKeys().hasOnly()` 연산이 표현식을 대량 소비하며, 여기에 개별 필드 검증이 추가되면 한도 초과.

## 해결책

### 제거한 것
- `areWrittenFieldsAllowed()` 함수 및 `allowedUserFields()` 리스트
- JSON 직렬화 문자열 16개 필드의 서버 타입/크기 검증 (`isValidUserFieldsPart2`)

### 유지한 것 (`isValidUserFieldsPart1`)
- 인증 + 소유자 확인 (`request.auth.uid == userId`)
- 핵심 필드: `name`(1~30자), `level`(1~999), `points`(>=0), `photoURL`(null/string<=1024)
- 맵 필드: `stats`, `pendingStats`(6개 스탯 키 검증), `streak`(3개 키 검증), `stepData`(3개 키 검증)
- 배열: `friends`(<=500)
- 불리언 6개: `syncEnabled`, `gpsEnabled`, `pushEnabled`, `hasActiveReels`, `_profileUploadFailed`, `privateAccount`
- 짧은 문자열/숫자 6개: `instaId`, `fcmToken`, `questWeekStart`, `lastRouletteDate`, `nameLastChanged`, `lastReelsPostTs`

### 클라이언트 검증으로 대체
JSON 직렬화 문자열 크기 제한은 `app.js`의 `_strLimits` 객체에서 검증:

```javascript
const _strLimits = {
    questStr: 10000, diaryStr: 500000, reelsStr: 500000,
    dungeonStr: 50000, diyQuestsStr: 50000, questHistoryStr: 200000,
    titleHistoryStr: 50000, streakStr: 5000, rareTitleStr: 10000,
    ddaysStr: 50000, ddayCaption: 200, lifeStatusStr: 1000,
    libraryStr: 50000, runningCalcHistoryStr: 10000, ormCalcHistoryStr: 10000
};
```

## 보안 영향

| 항목 | 이전 | 이후 | 위험도 |
|------|------|------|--------|
| 허용되지 않은 필드 쓰기 | `areWrittenFieldsAllowed()`로 차단 | 서버 차단 없음 | 낮음 — 추가 필드를 써도 앱 로직에 영향 없음 |
| JSON 문자열 크기 초과 | 서버에서 차단 | 클라이언트에서만 차단 | 낮음 — 악의적 클라이언트가 큰 문자열을 쓸 수 있으나, Firestore 문서 크기 제한(1MB)이 최종 방어 |
| 핵심 필드 타입 변조 | 서버에서 차단 | 서버에서 차단 (유지) | 없음 |

## 향후 고려사항

- Firestore 필드가 계속 추가되면 `isValidUserFieldsPart1`도 한도에 근접할 수 있음
- 필드 추가 시 맵 검증 함수(`isValidStatsMap` 등) 대신 간소화된 검증 고려
- Cloud Functions에서 서버 사이드 검증을 추가하는 것도 대안 (`onCreate`/`onUpdate` 트리거)
