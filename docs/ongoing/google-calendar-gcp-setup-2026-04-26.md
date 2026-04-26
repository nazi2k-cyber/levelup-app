# Google Calendar 연동 GCP 설정 가이드

- 작성일: 2026-04-26
- 브랜치: `claude/add-google-calendar-sync-G6wAy`
- 연관 문서: `planner-excel-google-calendar-2026-04-25.md`

---

## 개요

플래너 헤더의 "📅 구글 연동" 버튼이 실제로 동작하려면 아래 GCP 설정이 선행되어야 한다.  
구현 코드(`www/modules/planner-gcal.js`)는 완료되어 있으며, 인증 인프라 설정만 남은 상태다.

---

## 1. Google Cloud Console 접속

- URL: [console.cloud.google.com](https://console.cloud.google.com)
- **Firebase 프로젝트와 동일한 GCP 프로젝트** 선택 필수
  - Firebase 프로젝트는 내부적으로 GCP 프로젝트와 1:1로 연결됨
  - 다른 프로젝트를 선택하면 OAuth 클라이언트 ID가 불일치하여 인증 실패

---

## 2. Google Calendar API 활성화

```
왼쪽 메뉴 → API 및 서비스 → 라이브러리
→ 검색창에 "Google Calendar API" 입력
→ 결과에서 "Google Calendar API" 선택
→ [사용 설정] 버튼 클릭
```

- 활성화 후 [API 및 서비스 → 사용 설정된 API 및 서비스]에서 확인 가능
- 활성화하지 않으면 Calendar REST API 호출 시 `403 accessNotConfigured` 오류 발생

---

## 3. OAuth 동의 화면 — calendar.events 범위 추가

```
API 및 서비스 → OAuth 동의 화면
→ [앱 수정] 클릭
→ "범위" 섹션으로 이동
→ [범위 추가 또는 삭제] 클릭
→ 필터 입력창에 "calendar" 입력
→ "https://www.googleapis.com/auth/calendar.events" 체크
→ [업데이트] → [저장 후 계속] → [대시보드로 돌아가기]
```

> Firebase Auth 로그인 시 요청하는 `profile`, `email` 범위는 그대로 유지.  
> `calendar.events` 범위를 **추가**하는 것이며, 기존 범위를 교체하는 것이 아님.

---

## 4. 승인된 JavaScript 원본 확인

GIS(Google Identity Services) 라이브러리는 등록된 출처에서만 OAuth 팝업을 허용한다.

```
API 및 서비스 → 사용자 인증 정보
→ 기존 "웹 클라이언트 (자동으로 생성됨)" 또는 앱용 OAuth 2.0 클라이언트 ID 클릭
→ "승인된 JavaScript 원본" 섹션에 아래 항목 추가:
    http://localhost            (로컬 개발용)
    https://your-domain.com     (운영 PWA 도메인)
→ [저장]
```

- Android 네이티브 앱은 JavaScript 원본이 아닌 SHA-1 지문 기반이므로 별도 추가 불필요
- 미등록 원본에서 팝업 시 `idpiframe_initialization_failed` 오류 발생

---

## 5. 웹 클라이언트 ID 확인

```
API 및 서비스 → 사용자 인증 정보
→ OAuth 2.0 클라이언트 ID 목록에서 웹 클라이언트 선택
→ "클라이언트 ID" 값 복사
   형태 예시: 123456789012-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

이 값이 코드 내 `GOOGLE_WEB_CLIENT_ID_PLACEHOLDER`를 대체할 실제 값이다.

---

## 6. 빌드 파이프라인 — CLIENT_ID 주입

코드에서 `GOOGLE_WEB_CLIENT_ID_PLACEHOLDER`는 빌드 시 실제 값으로 치환된다.  
기존 `app.js`와 동일한 패턴을 `planner-gcal.js`에도 적용한다.

### 기존 GitHub Actions 스크립트에 파일 추가

```yaml
# .github/workflows/deploy.yml (또는 기존 CI 파일)
- name: Inject Google Client ID
  run: |
    sed -i "s/GOOGLE_WEB_CLIENT_ID_PLACEHOLDER/${{ secrets.GOOGLE_WEB_CLIENT_ID }}/g" \
      www/app.js \
      www/modules/planner-gcal.js    # ← 신규 추가
```

### GitHub Secret 등록 (미등록 시)

```
GitHub Repository → Settings → Secrets and variables → Actions
→ [New repository secret]
→ Name: GOOGLE_WEB_CLIENT_ID
→ Value: (5번에서 복사한 클라이언트 ID)
→ [Add secret]
```

---

## 7. 테스트 사용자 등록 (앱 검수 전 필수)

OAuth 동의 화면이 **"테스트" 상태**인 경우, 등록된 계정만 Calendar 범위에 접근 가능하다.

```
OAuth 동의 화면 → "테스트 사용자" 섹션
→ [+ ADD USERS] 클릭
→ 테스트할 Google 계정 이메일 입력 (최대 100개)
→ [저장]
```

- 미등록 계정으로 시도 시 `access_denied: App is not verified` 화면 표시
- **프로덕션 배포 후**: Google OAuth 앱 검수(verification)를 통과해야 외부 사용자 전체가 사용 가능

---

## 8. Native Android 주의사항

### 문제

`@codetrix-studio/capacitor-google-auth` 플러그인은 내부적으로 Android `GoogleSignInClient`를 공유한다.  
Calendar scope로 `GoogleAuth.signIn()`을 별도 호출하면 아래 위험이 있다.

| 위험 | 설명 |
|------|------|
| scope 변경으로 세션 교체 | 기존 `profile/email` scope와 다른 scope로 초기화 시 마지막 계정 교체 가능 |
| 계정 선택 화면 재표시 | 이미 로그인된 상태에서 다시 Google 계정 선택 팝업 노출 → UX 혼란 |
| 로그아웃 연쇄 | `GoogleAuth.signOut()` 호출 시 Calendar 세션까지 함께 해제될 수 있음 |

### 권장 해결책

| 방법 | 설명 | 적합한 상황 |
|------|------|------------|
| **A. WebView GIS 팝업 통일** | Native에서도 GIS 웹 방식 사용, GoogleAuth 플러그인 우회 | 빠른 출시, 안전 우선 |
| **B. 로그인 시 scope 통합** | 첫 로그인 때 `calendar.events` scope 함께 요청 | Calendar이 핵심 기능일 때 |
| **C. 현재 구현 유지 + 테스트** | 실제 기기에서 세션 충돌 여부 검증 후 판단 | 검증 후 결정 |

### 방법 A 적용 코드 예시

```javascript
// planner-gcal.js의 getAccessTokenNative()를 아래로 교체
async function getAccessTokenNative() {
    // Capacitor WebView 안에서도 GIS 팝업 사용 (GoogleAuth 우회)
    await loadGisScript();
    return getAccessTokenWeb();
}
```

### 실기기 검증 시나리오 (방법 C 선택 시)

```
1. Google 로그인 → 앱 정상 진입 확인
2. 플래너 → 📅 구글 연동 클릭 → Calendar 동의 화면 확인
3. 동기화 완료 후 앱 재시작
4. Firebase 로그인 세션 유지 여부 확인 (자동 로그인)
5. 로그아웃 → 재로그인 시 기존 계정 정상 복귀 확인
6. 구글 연동 재시도 시 계정 선택 팝업 재표시 여부 확인
```

---

## 9. 완료 체크리스트

- [ ] Google Calendar API 활성화
- [ ] OAuth 동의 화면에 `calendar.events` 범위 추가
- [ ] 승인된 JavaScript 원본에 도메인 등록
- [ ] GitHub Secret `GOOGLE_WEB_CLIENT_ID` 등록
- [ ] CI/CD 스크립트에 `planner-gcal.js` sed 대상 추가
- [ ] 테스트 사용자 등록 (검수 전)
- [ ] Android 실기기 세션 충돌 테스트
- [ ] (프로덕션) Google OAuth 앱 검수 신청

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `www/modules/planner-gcal.js` | Google Calendar 연동 모듈 (IIFE) |
| `www/app.html` | CSP script-src에 `accounts.google.com` 추가됨 |
| `www/data.js` | gcal 관련 i18n 키 (ko/en/ja) |
