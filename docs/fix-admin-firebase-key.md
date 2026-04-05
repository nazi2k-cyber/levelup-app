# 관리자 페이지 Firebase 인증 수정 이력

- **브랜치**: `claude/fix-admin-firebase-key-WJfZz`
- **작업일**: 2026-04-05
- **상태**: 수정 완료, 배포 후 테스트 필요

---

## 증상

- 관리자 페이지(`/admin/index.html`)에서 Google 로그인 후 즉시 로그아웃됨
- 페이지 새로고침 시 세션이 유지되지 않음
- 관리자 계정(MASTER/ADMIN) 확인 불가
- 모바일 Chrome에서 특히 심각

## 진단 결과

### 1차 분석: FIREBASE_WEB_API_KEY 확인

| 항목 | 결과 |
|------|------|
| GitHub Secret `FIREBASE_WEB_API_KEY` 호출 | **정상** (`deploy-firebase.yml:215`에서 사용) |
| `firebase-config.js` 생성 | **정상** (배포 시 생성, `www/`에 복사) |
| apiKey 유효성 | **검증 로직 없었음** (빈 값이어도 에러 없이 진행) |

### 2차 분석: 진단 로그 기반

```
[OK]   [Health] Firebase 설정 OK — 프로젝트: levelup-app-53d02
[INFO] [Auth]   로그아웃됨    ← 페이지 로드 시 세션 복원 안 됨
```

- API 키 자체는 유효 (Health check 통과)
- **실제 원인**: 모바일에서 `signInWithRedirect` 사용 시 cross-origin 세션 유실

---

## 원인 분석

### 핵심 원인: `signInWithRedirect` cross-origin 세션 유실

Firebase v10에서 `signInWithRedirect`는 다음 흐름으로 동작:

```
앱(web.app) → Google OAuth → firebaseapp.com → 앱(web.app)
```

이 과정에서 `authDomain`(`firebaseapp.com`)과 실제 호스팅 도메인(`web.app`)이 다르기 때문에,
리다이렉트 복귀 시 **세션 쿠키/IndexedDB가 공유되지 않아** 인증 상태가 유실됨.

### 부가 원인

1. **apiKey 유효성 검증 부재** — `firebase-init.js`에서 `__FIREBASE_CONFIG` 객체 존재만 확인, `apiKey`가 빈 문자열이어도 통과
2. **명시적 auth persistence 미설정** — `getAuth(app)` 호출 시 `setPersistence()` 미호출 (기본값 의존)
3. **진단 로그 부족** — `syncClaims` 실패 시 원인 불명, `getRedirectResult` 성공 케이스 미로깅
4. **배포 시 검증 없음** — `FIREBASE_WEB_API_KEY`가 비어있어도 배포가 성공적으로 완료됨

---

## 수정 내역

### 커밋 1: `39b88cd` — API 키 검증 + persistence + 진단 강화

#### `www/admin/js/firebase-init.js`
- `apiKey` 빈 값/무효 검증 추가 — 빈 키 시 화면에 에러 메시지 표시 (GitHub Secret 이름 포함)
- `setPersistence(auth, browserLocalPersistence)` 명시적 호출
- `authReady` promise export — persistence 설정 완료를 외부에서 추적 가능
- 초기화 성공 시 `console.log`로 프로젝트 정보 출력

```javascript
// Before
const auth = getAuth(app);

// After
const auth = getAuth(app);
const authReady = setPersistence(auth, browserLocalPersistence)
    .then(() => console.log('Auth persistence 설정 완료'))
    .catch(e => console.warn('Auth persistence 설정 실패:', e.message));
```

#### `www/admin/js/auth.js`
- `syncClaims` 결과 데이터 로깅 (`result.data` 출력)
- `functions/unauthenticated` 에러 시 API 키 문제 가능성 안내

#### `www/admin/index.html`
- `firebaseConfig` import 추가
- `terror` import 추가
- Firebase 설정 health check — apiKey 길이, projectId, authDomain 로그 패널 출력

#### `.github/workflows/deploy-firebase.yml`
- `firebase-config.js` 생성 후 `apiKey: ""` 체크, 비어있으면 배포 실패 처리

```yaml
- name: firebase-config.js API 키 검증
  run: |
    if grep -q 'apiKey: ""' www/firebase-config.js; then
      echo "::error::FIREBASE_WEB_API_KEY secret이 비어있습니다!"
      exit 1
    fi
```

### 커밋 2: `708358a` — 모바일 popup 우선 전략

#### `www/admin/js/auth.js` — `doLogin()` 전면 수정

```javascript
// Before: 모바일은 무조건 redirect
if (isMobileBrowser()) {
    await signInWithRedirect(auth, provider);
} else {
    await signInWithPopup(auth, provider);
}

// After: 모바일에서도 popup 우선, 차단 시에만 redirect fallback
try {
    await signInWithPopup(auth, provider);
} catch (e) {
    if (isMobileBrowser() && (e.code === 'auth/popup-blocked' || 
        e.code === 'auth/operation-not-supported-in-this-environment')) {
        await signInWithRedirect(auth, provider);
        return;
    }
    throw e;
}
```

#### `www/admin/js/auth.js` — `getRedirectResult` 성공 로깅

```javascript
// Before: 에러만 catch
getRedirectResult(auth).catch(e => { ... });

// After: 성공/실패 모두 로깅
getRedirectResult(auth).then(result => {
    if (result && result.user) {
        console.log("[Auth redirect] 리다이렉트 로그인 성공:", result.user.email);
    }
}).catch(e => { ... });
```

---

## 변경 파일 요약

| 파일 | 변경 | 목적 |
|------|------|------|
| `www/admin/js/firebase-init.js` | +18행 | apiKey 검증, persistence 명시, authReady export |
| `www/admin/js/auth.js` | +26행, -10행 | popup 우선 전략, redirect fallback, 진단 로그 |
| `www/admin/index.html` | +14행, -2행 | health check, import 추가 |
| `.github/workflows/deploy-firebase.yml` | +9행 | 배포 시 빈 apiKey 차단 |

---

## 검증 방법

### 배포 후 테스트 체크리스트

- [ ] 모바일 Chrome에서 Google 로그인 → 관리자 화면 진입 확인
- [ ] 로그인 후 페이지 새로고침 → 세션 유지 확인
- [ ] 로그 패널 확인: `[Health] Firebase 설정 OK` 메시지 출력
- [ ] 로그 패널 확인: `[syncClaims] Result:` 로그에서 admin/master 상태 확인
- [ ] PC 브라우저에서 동일 테스트
- [ ] 로그아웃 → 재로그인 정상 동작 확인

### 로그 패널 정상 출력 예시

```
[INFO] [Init]   Admin Diagnostics 페이지 로딩...
[OK]   [Health] Firebase 설정 OK — 프로젝트: levelup-app-53d02, authDomain: levelup-app-53d02.firebaseapp.com
[OK]   [Init]   Admin Diagnostics 준비 완료
[INFO] [Auth]   로그인: user@gmail.com (admin: true, master: true, operator: false)
```

---

## 참고: GitHub Secrets 필요 목록

| Secret 이름 | 용도 | 사용 위치 |
|-------------|------|----------|
| `FIREBASE_WEB_API_KEY` | Firebase 클라이언트 API 키 | `deploy-firebase.yml`, `build.yml` |
| `ADMIN_EMAILS` | 관리자 이메일 (쉼표 구분) | `functions/.env` |
| `MASTER_EMAILS` | 마스터 이메일 (쉼표 구분) | `functions/.env` |
