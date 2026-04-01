# Firestore Permission-Denied 수정 — 머지 후 조치 사항

> **브랜치:** `claude/fix-firestore-permissions-uJvKF`
> **수정일:** 2026-04-01
> **관련 오류:** 16건 (PERMISSION 6건, UNKNOWN 5건, NETWORK 5건)

---

## 수정 요약

| # | 원인 | 수정 내용 |
|---|---|---|
| 1 | `nameLastChanged` 레거시 문자열 값이 merge 시 규칙 검증 실패 | 항상 payload에 포함 (null 허용) |
| 2 | 레거시 `streak` 맵의 extra key로 `isValidStreakMap` 실패 | `normalizeStreakMapForFirestore()` 추가, 매 저장 시 덮어쓰기 |
| 3 | 디바운스 + 진단 getDoc 사이 auth 소실 race condition | `setDoc` 직전 `auth.currentUser` 재확인 가드 |

---

## 즉시 조치 (코드 배포 후)

### 1. Firestore 보안 규칙 배포 확인

```bash
firebase deploy --only firestore:rules
```

- 현재 `firestore.rules`는 수정 불필요 — 클라이언트 쪽 정규화로 해결
- 단, 로컬 rules와 프로덕션 rules가 동일한지 반드시 확인

### 2. 레거시 `streak` 맵 일괄 정리 (선택적)

코드 수정으로 매 저장 시 자동 덮어쓰기되지만, **저장 한 번도 안 한 비활성 유저**의 문서엔 레거시 데이터가 잔존한다.
Cloud Functions 일회성 마이그레이션 스크립트로 정리 권장:

```javascript
// 관리자 콘솔 또는 일회성 스크립트
const users = await db.collection('users').get();
const batch = db.batch();
let count = 0;
users.forEach(doc => {
    const data = doc.data();
    if (data.streak && typeof data.streak === 'object') {
        const keys = Object.keys(data.streak);
        const validKeys = new Set(['currentStreak', 'lastActiveDate', 'multiplier']);
        if (keys.some(k => !validKeys.has(k))) {
            batch.update(doc.ref, {
                streak: {
                    currentStreak: data.streak.currentStreak || 0,
                    lastActiveDate: data.streak.lastActiveDate || null,
                    multiplier: data.streak.multiplier || 1.0
                }
            });
            count++;
        }
    }
});
if (count > 0) await batch.commit();
console.log(`${count}건 streak 맵 정리 완료`);
```

### 3. `nameLastChanged` 레거시 문자열 정리 (선택적)

```javascript
const users = await db.collection('users').get();
const batch = db.batch();
let count = 0;
users.forEach(doc => {
    const data = doc.data();
    if ('nameLastChanged' in data && typeof data.nameLastChanged === 'string') {
        batch.update(doc.ref, { nameLastChanged: null });
        count++;
    }
});
if (count > 0) await batch.commit();
console.log(`${count}건 nameLastChanged 정리 완료`);
```

---

## Firebase 콘솔 설정 (코드 외)

### 4. AdMob 동의 양식 설정

- Firebase 콘솔 → AdMob → 앱 설정
- App ID `ca-app-pub-6654057059754695~3529972498`에 대한 **동의 양식(Consent Form)** 생성
- 이걸 하지 않으면 `Publisher misconfiguration` 오류 계속 발생
- GDPR/ATT 동의 관련이므로 법적 검토 후 양식 작성 권장

---

## 모니터링 (배포 후 24시간)

### 5. 오류 재발 여부 확인

- AppLogger에서 `[DB] 저장 실패: permission-denied` 검색 → **0건**이어야 정상
- `[SaveData] setDoc 직전 auth 소실` 로그 → race condition 방어 동작 확인
- `[Firestore] WebChannel error` 빈도 → 감소 추세 확인

### 6. 성공 지표

| 지표 | 기대값 |
|---|---|
| `permission-denied` 오류 | 0건 |
| WebChannel error | 90%+ 감소 |
| `[SaveData] Firestore 저장 성공` | 정상 증가 |
| AdMob 오류 | 콘솔 설정 전까지 유지 (코드 무관) |

---

## 우선순위 요약

| 순위 | 조치 | 긴급도 |
|---|---|---|
| 1 | 코드 배포 (이미 push 완료) | **즉시** |
| 2 | Firestore rules 프로덕션 동기화 확인 | **즉시** |
| 3 | AdMob 동의 양식 설정 | **금주 내** |
| 4 | 레거시 데이터 마이그레이션 스크립트 | **권장** |
| 5 | 24시간 모니터링 | **배포 직후** |
