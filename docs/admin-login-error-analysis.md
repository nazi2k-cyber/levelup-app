# 관리자 페이지 로그인 에러 분석 보고서

**작성일**: 2026-04-04
**상태**: 분석 완료 / 코드 수정 적용

---

## 1. 증상 요약

| 페이지 | URL | 증상 |
|--------|-----|------|
| Admin Diagnostics | `levelup-app-53d02.web.app/admin/index.html` | Google 로그인 후 인증 실패 가능성 |
| Push Admin | `bravecat.studio/push-test.html` | **"Firebase 설정 오류: firebase-config.js를 로드할 수 없습니다"** 에러 표시 |

---

## 2. 근본 원인 분석

### 원인 A: `bravecat.studio`에서 firebase-config.js 로드 실패 (핵심 원인)

**문제**: `bravecat.studio` 도메인이 GitHub Pages로 서빙되고 있으나, `firebase-config.js`가 GitHub Pages에 존재하지 않음.

**상세 경로**:

```
bravecat.studio (DNS) → GitHub Pages (CNAME 파일 기반)
                        → repo root 서빙
                        → firebase-config.js 없음 (.gitignore에 포함)
                        → push-test.html에서 <script src="firebase-config.js"> 로드 실패
                        → __FIREBASE_CONFIG undefined → 에러 표시
```

**관련 파일**:
- `CNAME` — `bravecat.studio`를 GitHub Pages에 매핑
- `.gitignore` 라인 5-6 — `firebase-config.js`, `www/firebase-config.js` 제외
- `www/push-test.html` 라인 832 — `<script src="firebase-config.js">` 로드
- `www/push-test.html` 라인 908-910 — 에러 표시 로직

**반면 Firebase Hosting**에서는 CI/CD 배포 시 `deploy-firebase.yml` (라인 212-230)에서 `firebase-config.js`를 동적 생성하여 `www/` 디렉토리에 복사하므로 정상 동작.

### 원인 B: 이중 호스팅 아키텍처로 인한 혼선

현재 동일 콘텐츠가 두 개의 서로 다른 호스팅에서 서빙됨:

| 도메인 | 호스팅 | firebase-config.js | 상태 |
|--------|--------|-------------------|------|
| `levelup-app-53d02.web.app` | Firebase Hosting | CI/CD에서 생성됨 | 정상 |
| `bravecat.studio` | GitHub Pages | 없음 (.gitignore) | **에러** |

`www/admin/index.html` 라인 16에서 Push Admin 링크가 `https://bravecat.studio/push-test.html`(GitHub Pages)로 하드코딩되어 있어, Firebase Hosting에서 정상 동작하는 환경에서도 에러가 발생하는 GitHub Pages 도메인으로 이동하게 됨.

### 원인 C: authDomain 반복 변경

| 버전 | 변경 내용 | 결과 |
|------|-----------|------|
| v1.0.168 | `authDomain`을 `bravecat.studio`로 변경 | 커스텀 도메인 설정 없이 변경하여 로그인 실패 |
| v1.0.171 | `authDomain`을 `firebaseapp.com`으로 복원 | 기본값 복원 |

`authDomain`에 커스텀 도메인을 사용하려면 해당 도메인에서 Firebase Auth의 `__/auth/handler` 경로를 서빙해야 하며, 이는 Firebase Hosting 커스텀 도메인 설정을 통해서만 가능. GitHub Pages에서는 지원되지 않음.

---

## 3. 수정 사항

### 3.1 CNAME 파일 삭제

GitHub Pages가 `bravecat.studio` 도메인을 점유하지 않도록 `CNAME` 파일을 삭제.

### 3.2 Push Admin 링크를 상대 경로로 변경

`www/admin/index.html` 라인 16:
```html
<!-- 변경 전 -->
<a href="https://bravecat.studio/push-test.html" ...>Push Admin →</a>

<!-- 변경 후 -->
<a href="../push-test.html" ...>Push Admin →</a>
```

어떤 도메인에서 접속하든 동일 호스팅 내의 파일을 참조하도록 상대 경로 사용.

---

## 4. 수동 설정 필요사항 (Firebase Console)

코드 수정만으로는 `bravecat.studio` 도메인이 완전히 동작하지 않음. 다음을 Firebase Console에서 수동 설정해야 함:

### 4.1 Firebase Hosting 커스텀 도메인 추가

1. [Firebase Console](https://console.firebase.google.com) → Hosting → **커스텀 도메인 추가**
2. `bravecat.studio` 입력
3. 도메인 소유권 확인 (DNS TXT 레코드)
4. DNS A 레코드를 Firebase Hosting IP로 변경
5. SSL 인증서 자동 프로비저닝 대기 (최대 24시간)

### 4.2 Firebase Auth 승인 도메인 추가

1. Firebase Console → Authentication → Settings → **승인 도메인**
2. `bravecat.studio` 추가
3. 이를 통해 `bravecat.studio`에서 Google 로그인이 정상 동작

### 4.3 Google Cloud Console OAuth 동의 화면

필요 시 Google Cloud Console에서 OAuth 리다이렉트 URI에 `bravecat.studio` 도메인 추가.

---

## 5. 아키텍처 (수정 후)

```
bravecat.studio (DNS) ──→ Firebase Hosting ──→ www/ 디렉토리
                              │
                              ├── firebase-config.js (CI/CD 생성)
                              ├── push-test.html
                              ├── admin/index.html
                              └── admin/js/*.js

levelup-app-53d02.web.app ──→ Firebase Hosting (동일)
```

두 도메인 모두 Firebase Hosting에서 서빙되므로 `firebase-config.js`가 존재하고, Google 로그인도 정상 동작.

---

## 6. 검증 방법

1. Firebase Hosting 배포 후 `levelup-app-53d02.web.app/admin/index.html` 로그인 확인
2. DNS 전파 후 `bravecat.studio/push-test.html` 접속 시 에러 해소 확인
3. 양쪽 도메인에서 Google 로그인 테스트 (데스크톱: 팝업, 모바일: 리다이렉트)
4. `bravecat.studio`가 Firebase Auth 승인 도메인에 등록되었는지 확인

---

## 7. 관련 파일 참조

| 파일 | 역할 |
|------|------|
| `.github/workflows/deploy-firebase.yml` (라인 212-230) | firebase-config.js 생성 로직 |
| `scripts/generate-firebase-config.sh` | 수동 config 생성 스크립트 |
| `firebase-config.example.js` | 설정 템플릿 |
| `www/admin/js/firebase-init.js` (라인 11-16) | config 로드 검증 |
| `www/admin/js/auth.js` | Google 로그인 로직 |
| `firebase.json` | Firebase Hosting 설정 |
