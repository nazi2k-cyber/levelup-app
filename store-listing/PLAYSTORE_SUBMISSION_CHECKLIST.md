# 플레이스토어 등록 체크리스트
## LEVEL UP: REBOOT (com.levelup.reboot)

> **마지막 업데이트**: 2026-03-22
> **전체 준비도**: 약 85% — 개발 자산 준비 완료, Play Console 설정 작업 남음

---

## 전체 진행 현황

| 단계 | 항목 | 상태 |
|---|---|---|
| 1단계 | 릴리즈 키스토어 준비 | ⬜ 미완료 |
| 2단계 | Firebase SHA-1 지문 등록 | ⬜ 미완료 |
| 3단계 | Google Play Console 앱 등록 | ⬜ 미완료 |
| 4단계 | 스토어 등록정보 작성 | ✅ 완료 (텍스트 준비됨) |
| 5단계 | 그래픽 자산 준비 | ✅ 완료 |
| 6단계 | 앱 카테고리 및 콘텐츠 등급 | ⬜ 미완료 (Play Console에서 입력) |
| 7단계 | 데이터 보안 양식 작성 | ⬜ 미완료 (Play Console에서 입력) |
| 8단계 | 릴리즈 AAB 빌드 및 업로드 | ⬜ 미완료 (키스토어 필요) |
| 9단계 | 앱 검토 제출 | ⬜ 미완료 |

---

## 1단계: 릴리즈 키스토어 준비 (최초 1회) ⬜

릴리즈 키스토어는 **절대 분실/변경하면 안 됩니다**. 분실 시 앱 업데이트 불가능.

```bash
# 릴리즈 키스토어 생성
keytool -genkeypair -v \
  -keystore levelup-release.keystore \
  -alias levelup-key \
  -keyalg RSA -keysize 2048 -validity 25000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=BRAVECAT STUDIOS,O=BRAVECAT,C=KR"

# Base64 인코딩 (GitHub Secrets 등록용)
base64 -w 0 levelup-release.keystore
```

### GitHub Secrets 등록 (Settings → Secrets → Actions)

| Secret 이름 | 값 | 상태 |
|---|---|---|
| `RELEASE_KEYSTORE_BASE64` | 위 base64 명령 결과 | ⬜ 미등록 |
| `RELEASE_KEYSTORE_PASSWORD` | YOUR_STORE_PASSWORD | ⬜ 미등록 |
| `RELEASE_KEY_ALIAS` | `levelup-key` | ⬜ 미등록 |
| `RELEASE_KEY_PASSWORD` | YOUR_KEY_PASSWORD | ⬜ 미등록 |

**⚠️ 키스토어 파일과 비밀번호를 안전한 곳에 백업하세요!**

### 할 일
- [ ] 릴리즈 키스토어 생성
- [ ] Base64 인코딩 후 GitHub Secrets에 4개 항목 등록
- [ ] 키스토어 파일 및 비밀번호 안전한 곳에 백업

---

## 2단계: Firebase SHA-1 지문 등록 ⬜

릴리즈 키스토어의 SHA-1을 Firebase Console에 등록해야 Google 로그인 작동.

> **현재 상태**: Debug SHA-1만 등록됨 (`009373fdf790af076e49ead5db68447082ef9d20`)
> Release SHA-1은 키스토어 생성 후 등록 필요

```bash
keytool -list -v \
  -keystore levelup-release.keystore \
  -alias levelup-key \
  -storepass YOUR_STORE_PASSWORD
```

→ Firebase Console → 프로젝트 설정 (`levelup-app-53d02`) → Android 앱 (com.levelup.reboot) → SHA 인증서 지문 추가

### 할 일
- [ ] 릴리즈 키스토어 SHA-1 확인
- [ ] Firebase Console에서 릴리즈 SHA-1 등록

---

## 3단계: Google Play Console 앱 등록 ⬜

> **전제조건**: Google Play 개발자 계정 필요 (등록비 $25 USD, 최초 1회)

1. [Google Play Console](https://play.google.com/console) 접속
2. **앱 만들기** 클릭
3. 기본 정보 입력:
   - 앱 이름: `LEVEL UP: REBOOT`
   - 기본 언어: `한국어 (ko-KR)`
   - 앱 또는 게임: `앱`
   - 유료 또는 무료: `무료`
4. 개발자 프로그램 정책 및 미국 수출법 동의

### 할 일
- [ ] Google Play 개발자 계정 생성/확인
- [ ] Play Console에서 앱 만들기

---

## 4단계: 스토어 등록정보 작성 ✅

### 한국어 (기본) ✅
- **앱 이름** (30자 이내): `LEVEL UP: REBOOT - 현실 레벨업 RPG` — `store-listing/ko-KR/title.txt`
- **간단한 설명** (80자 이내): `store-listing/ko-KR/short_description.txt` ✅ 준비됨
- **자세한 설명** (4000자 이내): `store-listing/ko-KR/full_description.txt` ✅ 준비됨 (2.9KB)

### 영어 번역 ✅
- **앱 이름**: `LEVEL UP: REBOOT - Real Life RPG` — `store-listing/en-US/title.txt`
- **간단한 설명**: `store-listing/en-US/short_description.txt` ✅ 준비됨
- **자세한 설명**: `store-listing/en-US/full_description.txt` ✅ 준비됨 (2.6KB)

### 할 일
- [ ] Play Console에서 한국어/영어 등록정보 입력 (텍스트 복사-붙여넣기)

---

## 5단계: 그래픽 자산 준비 ✅

| 자산 | 크기 | 상태 | 파일 |
|---|---|---|---|
| 앱 아이콘 | 512×512 PNG | ✅ 완료 | `play_store_512.png` (16KB) |
| 특성 이미지 (Feature Graphic) | 1024×500 PNG | ✅ 완료 | `feature-graphic.png` (307KB) |
| 스크린샷 (휴대전화) | 최소 2장 | ✅ 완료 (19장) | `store-listing/Screenshot_*.jpg` |

### 스크린샷 현황 (19장 보유)
- 2026-03-11 ~ 2026-03-21 촬영
- 파일 크기: 219KB ~ 663KB
- Play Store 업로드 시 2~8장 선택 권장

### 스크린샷 권장 선택 내용
1. 로그인/메인 화면 (LEVEL UP 브랜딩)
2. 스탯 현황 화면 (STR/INT/CHA/VIT/WLT/AGI)
3. 주간 퀘스트 목록
4. 던전 레이드 화면
5. 소셜 랭킹 화면

### 할 일
- [ ] 19장 중 대표 스크린샷 2~8장 선택
- [ ] Play Console에 아이콘, 특성 이미지, 스크린샷 업로드

---

## 6단계: 앱 카테고리 및 콘텐츠 등급 ⬜

### 카테고리
- **앱 카테고리**: 건강/피트니스 또는 라이프스타일
- **태그**: 자기계발, 습관 추적, 게이미피케이션

### 콘텐츠 등급 (IARC 설문)
- 폭력: 없음 (게임 테마이나 실제 폭력 없음)
- 선정성: 없음
- 언어: 없음
- **예상 등급**: 전체 이용가 (Everyone)

### 할 일
- [ ] Play Console에서 카테고리 선택
- [ ] IARC 콘텐츠 등급 설문 완료

---

## 7단계: 데이터 보안 양식 작성 ⬜

Play Console → 데이터 보안에서 아래 항목 신고:

| 데이터 유형 | 수집 여부 | 목적 |
|---|---|---|
| 이메일 주소 | ✅ 수집 | 계정 생성/로그인 |
| 이름 | ✅ 수집 | 프로필 표시 |
| 사용자 ID | ✅ 수집 | 앱 기능 |
| 위치 (대략적) | ✅ 선택적 | 걸음 수 추적 |
| 신체 활동 | ✅ 선택적 | 걸음 수/피트니스 |
| 앱 활동 | ✅ 수집 | 분석/앱 기능 |

**데이터 처리**: 암호화 전송 ✅ | 삭제 요청 가능 ✅

### 할 일
- [ ] Play Console에서 데이터 보안 양식 작성

---

## 8단계: 릴리즈 AAB 빌드 및 업로드 ⬜

> **전제조건**: 1단계 키스토어 준비 및 GitHub Secrets 등록 완료 필요

1. GitHub Actions → `릴리즈 AAB 빌드 (플레이스토어 제출용)` 워크플로우 실행
   - `version_name`: `1.0.1`
   - `version_code`: `2`
2. 빌드 완료 대기 (약 10~15분 소요)
3. Artifacts에서 `app-release.aab` 다운로드
4. Play Console → 프로덕션 → 새 릴리즈 만들기 → AAB 업로드

### 빌드 인프라 현황 ✅
- GitHub Actions 워크플로우: `.github/workflows/release-aab.yml` ✅ 준비됨
- 20+ 빌드 단계 자동화 (키스토어 복원, 빌드, 서명, 아티팩트 업로드)
- Target SDK: 34 | Min SDK: 26 (Health Connect 요구사항 충족)
- 앱 버전: `package.json` → `1.0.1`

### 할 일
- [ ] GitHub Secrets 등록 완료 확인 (1단계)
- [ ] GitHub Actions 워크플로우 실행
- [ ] AAB 다운로드 및 Play Console 업로드

---

## 9단계: 앱 검토 제출 ⬜

- 출시 노트 작성 (한국어):
  ```
  LEVEL UP: REBOOT 첫 번째 릴리즈입니다.
  RPG 게임처럼 현실을 레벨업하세요!
  ```
- **검토 제출** 클릭
- 검토 기간: 보통 1~7일 소요

### 할 일
- [ ] 출시 노트 작성
- [ ] 검토 제출

---

## 추가 설정 (선택)

- [ ] 인앱 제품/구독 설정 (현재 없음)
- [ ] Google Play 게임 서비스 연동 (선택)
- [ ] Play Asset Delivery 설정 (선택)
- [ ] Pre-registration 캠페인 (선택)

---

## 준비 완료된 자산 요약

| 자산 | 파일 | 상태 |
|---|---|---|
| 앱 아이콘 (512×512) | `play_store_512.png` | ✅ |
| 특성 이미지 (1024×500) | `feature-graphic.png` | ✅ |
| 스크린샷 (19장) | `store-listing/Screenshot_*.jpg` | ✅ |
| 한국어 등록정보 | `store-listing/ko-KR/` | ✅ |
| 영어 등록정보 | `store-listing/en-US/` | ✅ |
| 개인정보 처리방침 | `privacy.html` | ✅ |
| 이용약관 | `terms.html` | ✅ |
| 이용정책 | `usage-policy.html` | ✅ |
| Firebase 설정 | `google-services.json` | ✅ |
| 릴리즈 빌드 워크플로우 | `.github/workflows/release-aab.yml` | ✅ |
| 디버그 키스토어 | `debug.keystore` | ✅ |
| Capacitor 설정 | `capacitor.config.json` | ✅ |

---

## 남은 할 일 요약 (우선순위순)

### 필수 (제출 전 반드시 완료)
1. ⬜ **릴리즈 키스토어 생성** 및 안전한 곳에 백업
2. ⬜ **GitHub Secrets 등록** (키스토어 Base64, 비밀번호, Alias)
3. ⬜ **Firebase에 릴리즈 SHA-1 등록** (Google 로그인 필수)
4. ⬜ **Google Play 개발자 계정** 생성/확인 ($25 USD)
5. ⬜ **Play Console에서 앱 만들기**
6. ⬜ **스토어 등록정보 입력** (준비된 텍스트 복사-붙여넣기)
7. ⬜ **그래픽 자산 업로드** (아이콘, 특성 이미지, 스크린샷 선택)
8. ⬜ **IARC 콘텐츠 등급 설문** 완료
9. ⬜ **데이터 보안 양식** 작성
10. ⬜ **릴리즈 AAB 빌드** (GitHub Actions 워크플로우 실행)
11. ⬜ **AAB 업로드** 및 검토 제출

### 권장 (제출 전 확인)
- ⬜ 외부 접근 가능한 개인정보 처리방침 URL 준비 (예: `https://bravecat.studio/privacy`)
- ⬜ 고객지원 이메일 등록 (예: `support@bravecat.studio`)
- ⬜ 스크린샷 19장 중 대표 2~8장 선택

---

## 중요 URL 목록

| 항목 | URL/이메일 | 상태 |
|---|---|---|
| 개인정보 처리방침 | 앱 내 `privacy.html` 내장 | ✅ 있음 |
| 외부 개인정보 처리방침 URL | `https://your-domain.com/privacy.html` | ⬜ 준비 필요 |
| 고객지원 이메일 | 등록 필요 | ⬜ 준비 필요 |
| DPA 연락처 | `privacy@bravecat.studio` | ✅ privacy.html에 명시 |
| Firebase 프로젝트 | `levelup-app-53d02` | ✅ |
| Play Console | https://play.google.com/console | — |
