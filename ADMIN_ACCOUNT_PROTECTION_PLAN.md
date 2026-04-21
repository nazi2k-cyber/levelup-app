# 관리자 계정 탈취 및 개인정보 유출 방지 방안

> **대상:** LEVEL UP: REBOOT — Google Play Store 개발자 정보 노출 대응  
> **기준일:** 2026-04-20  
> **원인:** Play Store 개발자 페이지에 개발자 이름(김도형) 및 이메일(nazi2k@gmail.com) 공개 노출

---

## 목차

1. [노출 현황 및 위협 분석](#1-노출-현황-및-위협-분석)
2. [즉시 조치 사항](#2-즉시-조치-사항)
3. [GitHub 계정 보안 강화](#3-github-계정-보안-강화)
4. [Google Play 개발자 계정 보안](#4-google-play-개발자-계정-보안)
5. [Firebase / GCP 관리자 계정 보안](#5-firebase--gcp-관리자-계정-보안)
6. [앱 내 관리자 계정 탈취 방지](#6-앱-내-관리자-계정-탈취-방지)
7. [개인정보보호 배상책임보험 검토](#7-개인정보보호-배상책임보험-검토)
8. [우선순위 체크리스트](#8-우선순위-체크리스트)

---

## 1. 노출 현황 및 위협 분석

### 현재 노출된 정보

| 항목 | 노출 내용 | 노출 경로 |
|------|-----------|-----------|
| 개발자 실명 | 김도형 | Google Play Store 개발자 정보 |
| 이메일 주소 | nazi2k@gmail.com | Google Play Store 개발자 정보 |
| GitHub 계정 | bravecat-studio | 공개 저장소 URL |
| 국가 | South Korea | Google Play Store |
| 지원 이메일 | support@bravecat.studio | Google Play Store |

### 이 정보로 가능한 공격 시나리오

#### 시나리오 A — 계정 탈취 (Credential Stuffing)
```
nazi2k@gmail.com 이메일을 알고 있으면:
→ Gmail 계정 → Google Play 개발자 계정 → 앱 무단 업데이트/삭제
→ Firebase 콘솔 → Firestore DB 직접 조작 / API 키 탈취
→ GitHub 계정 → 악성 코드 삽입 후 배포 파이프라인 침해
```

#### 시나리오 B — 스피어 피싱 (Spear Phishing)
```
실명(김도형) + 이메일 조합 → 맞춤형 피싱 메일 발송
예: "Google Play 정책 위반 경고 — 24시간 내 조치 요망" 형식
→ 가짜 로그인 페이지 유도 → 자격증명 탈취
```

#### 시나리오 C — 공급망 공격 (Supply Chain)
```
GitHub 계정 침해 → functions/index.js 악성 코드 삽입
→ Firebase Cloud Functions 배포 → 전체 유저 데이터 탈취
```

#### 시나리오 D — 사회공학 (Social Engineering)
```
실명 + 개발자 경력 정보 조합 → LinkedIn/커뮤니티 신뢰 공격
→ "개발자 협업 제안" 위장 → 악성 패키지 설치 유도
```

---

## 2. 즉시 조치 사항

> 비용: **전액 무료** / 소요 시간: 1~2시간

### 2-1. Gmail 계정 보안 강화 (최우선)

**nazi2k@gmail.com 계정에서 즉시 실행:**

```
1. 2단계 인증 활성화 (필수)
   Google 계정 → 보안 → 2단계 인증
   → 하드웨어 보안 키(YubiKey) 또는 Google Authenticator 앱 권장
   → SMS 2FA는 SIM Swap 공격에 취약 — 앱 기반 OTP 사용

2. 최근 로그인 이력 점검
   Google 계정 → 보안 → 기기 활동 검토
   → 모르는 기기/위치 즉시 강제 로그아웃

3. 비밀번호 즉시 변경
   → 20자 이상 임의 문자열 (패스워드 매니저 사용: Bitwarden 무료)
   → 다른 서비스와 절대 재사용 금지

4. 연결된 앱 권한 점검
   Google 계정 → 보안 → 타사 앱 액세스
   → 불필요한 앱 권한 즉시 해제
```

### 2-2. 개발자 전용 이메일 분리

```
현재 구조 (위험):
  개인 Gmail (nazi2k@gmail.com) = Play Store 개발자 계정 = Firebase 관리자

권장 구조:
  개인 Gmail (nazi2k@gmail.com)   ← 개인용만 사용
  dev@bravecat.studio             ← 개발/배포 전용 (Google Workspace 기본 무료)
  support@bravecat.studio         ← 사용자 문의 전용 (현재 설정 유지)
```

**Play Store 개발자 이메일 변경 절차:**
```
Google Play Console → 계정 세부정보 → 개발자 이메일
→ dev@bravecat.studio 로 변경
→ 변경 시 Play Store 노출 이메일도 자동 교체됨
```

### 2-3. Play Store 공개 정보 최소화

```
Google Play Console → 앱 → 스토어 등록정보 → 연락처 세부정보

현재 노출:  nazi2k@gmail.com (개인 이메일 직접 노출)
변경 후:    support@bravecat.studio (서비스 이메일만 노출)

개인 이름 노출 문제:
→ 개인사업자 대신 '브레이브캣 스튜디오' 등 브랜드명으로 개발자명 변경 검토
→ Play Console → 계정 → 개발자 이름 수정
```

---

## 3. GitHub 계정 보안 강화

### 3-1. 계정명 변경 검토

**현재:** `bravecat-studio`  
**문제점:**
- Play Store → GitHub 검색으로 계정 즉시 특정 가능
- "nazi" 포함 계정명은 일부 플랫폼 API/서비스에서 차단될 수 있음
- 브랜드 신뢰도 저하

**변경 절차:**
```
GitHub → Settings → Account → Change username
→ 예시: bravecat-dev / levelup-official / bravecat-studio

⚠️ 주의사항:
- 변경 후 기존 URL(bravecat-studio/levelup-app)은 301 리다이렉트 (90일간)
- GitHub Actions, Firebase 배포 워크플로우의 저장소 경로 참조 업데이트 필요
- README, CNAME, firebase.json 내 하드코딩된 GitHub URL 일괄 수정 필요
```

**변경 후 업데이트가 필요한 파일:**
```bash
# 저장소 내 구 계정명 참조 확인
grep -r "nazi2k-cyber" . --include="*.json" --include="*.yml" --include="*.md"
```

### 3-2. GitHub 계정 보안 설정

```
1. 2단계 인증 (필수)
   GitHub → Settings → Password and authentication → Two-factor authentication
   → TOTP 앱(Google Authenticator/Authy) 또는 하드웨어 키

2. SSH 키 감사 ✅ (2026-04-21 Ed25519 키 생성 완료)
   GitHub → Settings → SSH and GPG keys
   → 사용하지 않는 키 즉시 삭제
   → 신규 Ed25519 키 생성 완료
     키 이름  : bravecat-studio-dev-ed25519-20260421
     지문     : SHA256:iW48BezA2OLO9pOCXr/G/twxYu2WixX3ituExxmTAiM
     공개키   : ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBfG2LHC0ofJxeVrQyqA3fulN9d1zuXUCAaCBF15oB9R dev@bravecat.studio
     등록 방법: GitHub → Settings → SSH and GPG keys → New SSH key → 위 공개키 붙여넣기

3. Personal Access Token 점검
   GitHub → Settings → Developer settings → Personal access tokens
   → 미사용 토큰 전부 삭제
   → 필요한 토큰은 Fine-grained token (최소 권한) 으로 재발급

4. 저장소 접근 권한 감사
   → Collaborators 목록 점검 (불필요한 외부 계정 제거)
   → Branch protection rule 설정: main 브랜치 직접 push 차단

5. Secret Scanning 알림 활성화
   GitHub → Settings → Security → Code security and analysis
   → Secret scanning: Enable
   → Push protection: Enable (커밋 전 시크릿 차단)
```

### 3-3. Branch Protection 설정 (main 브랜치)

```
GitHub → 저장소 → Settings → Branches → Add rule

✅ Require a pull request before merging
✅ Require status checks to pass before merging
✅ Require signed commits (GPG 서명 커밋)
✅ Restrict who can push to matching branches
✅ Do not allow bypassing the above settings
```

### 3-4. GitHub Actions 시크릿 보안

```
현재 위험: GitHub Actions에서 Firebase 토큰, AZURE_CS_KEY 등 사용 가능성
점검 항목:
→ Settings → Secrets and variables → Actions
→ 사용하지 않는 시크릿 즉시 삭제
→ FIREBASE_TOKEN: Service Account JSON 방식으로 교체 (토큰 방식보다 안전)
→ 시크릿은 Environment 단위로 분리 (production / staging)
```

---

## 4. Google Play 개발자 계정 보안

### 4-1. Play Console 계정 보안

```
1. Google 계정 2FA 필수 (2-1 항목과 동일)

2. Play Console 팀 멤버 관리
   Play Console → 사용자 및 권한 → 계정 사용자
   → 불필요한 계정 즉시 제거
   → 권한은 최소 필요 수준으로 제한

3. Play Console 알림 설정
   → 이메일: 앱 상태 변경 / 정책 위반 / 결제 이상 알림 활성화
   → dev@bravecat.studio 로 변경 후 설정

4. APK/AAB 서명 키 보안 ✅
   → debug.keystore: GitHub Secret(DEBUG_KEYSTORE_BASE64)으로 이전 완료, .gitignore 적용, git 추적 제거 완료
   → 릴리즈 keystore: RELEASE_KEYSTORE_BASE64 등 GitHub Secrets로 관리 중
   → .gitignore: *.keystore, *.jks 패턴 추가 완료 (모든 키스토어 파일 차단)
   → PR 검증: pr-check.yml에 키스토어 git 추적 자동 감지 스텝 추가 완료
   → 프로덕션 keystore는 Google Play App Signing 위임 권장 (키 분실/탈취 대비) ✅ 확인 완료 (2026-04-21 — Play Console 앱 무결성 → 앱 서명: "Google Play에서 서명 중")
```

**✅ 완료: debug.keystore 보안 조치 (2026-04-21)**
```
조치 내역:
→ debug.keystore git 추적 제거 완료 (커밋 476bf9d)
→ .gitignore에 debug.keystore, *.keystore, *.jks, release.keystore 등록 완료
→ GitHub Secret DEBUG_KEYSTORE_BASE64로 키스토어 이전 완료
→ build.yml, deploy-rollback.yml에서 Secret을 통해 런타임 복원
→ pr-check.yml에 키스토어 파일 git 추적 자동 감지 스텝 추가 완료
```

### 4-2. 앱 업데이트 2인 승인 체계

```
소규모 팀이라도 중요 배포 전 체크리스트 도입:
□ 소스 코드 diff 검토
□ functions/index.js 변경사항 재확인
□ 배포 전 스테이징 환경 테스트
□ GitHub Actions security-scan 통과 확인
```

---

## 5. Firebase / GCP 관리자 계정 보안

### 5-1. Firebase Console 접근 보안

```
1. Firebase Console 접근 계정 2FA 활성화 (Google 계정 2FA = 자동 적용)

2. IAM 권한 감사
   GCP Console → IAM & Admin → IAM
   → Owner/Editor 권한 보유 계정 목록 확인
   → 불필요한 서비스 계정 비활성화

3. Firebase 프로젝트 멤버 최소화
   Firebase Console → 프로젝트 설정 → 사용자 및 권한
   → Owner 계정은 반드시 2FA 적용된 계정만
   → 테스트/개발용 임시 계정 삭제

4. API 키 제한 설정
   Firebase Console → 프로젝트 설정 → 일반 → 웹 API 키
   → Google Cloud Console → 사용자 인증 정보 → API 키
   → HTTP 리퍼러 제한: levelup-app-53d02.web.app 도메인만 허용
   → API 제한: 사용하는 API만 명시적 허용
```

### 5-2. 서비스 계정 키 보안

```
GCP Console → IAM & Admin → 서비스 계정
→ 미사용 서비스 계정 키 즉시 삭제
→ 키 순환 정책: 90일 주기

GitHub Actions에서 사용하는 서비스 계정:
→ 최소 권한 원칙: Firebase Hosting 배포에만 필요한 권한만 부여
→ Cloud Functions 배포 계정과 분리 권장
```

### 5-3. Admin SDK 관리자 이메일 목록 보호

```javascript
// 마스터 이메일은 GitHub Secret `ADMIN_MASTER_EMAIL` 로 관리
// deploy-firebase.yml → functions/.env → process.env.ADMIN_MASTER_EMAIL
// (기존 MASTER_EMAILS 시크릿에서 ADMIN_MASTER_EMAIL 로 변경 — 명칭 중복 방지)

// firestore.rules — admin_config 접근 제한 (현재 구현 상태 확인)
match /admin_config/{document} {
  allow read: if isMaster();    // 마스터만 읽기 가능
  allow write: if isMaster();   // 마스터만 쓰기 가능
}
```

---

## 6. 앱 내 관리자 계정 탈취 방지

### 6-1. 관리자 계정 이메일 변경

```
현재 admin 계정으로 nazi2k@gmail.com 사용 중인 경우:
→ Firebase Auth에서 admin Custom Claim 보유 계정 확인
→ dev@bravecat.studio 계정으로 admin 권한 이전 후
→ nazi2k@gmail.com의 admin 권한 제거

이전 절차:
1. Firebase Console → Authentication → 신규 계정(dev@bravecat.studio) 생성
2. Cloud Functions → setCustomClaims 호출로 admin 클레임 부여
3. ADMIN_EMAILS 환경변수에서 nazi2k@gmail.com 제거
4. 기존 계정은 일반 사용자로 유지 (삭제 불필요)
```

### 6-2. 마스터 계정 침해 대응 절차 (BCP)

#### 인시던트 심각도 분류

| 등급 | 정의 | 예시 | 목표 복구 시간 (RTO) |
|------|------|------|---------------------|
| **P0** | 마스터 계정 완전 탈취 / Firestore 대량 삭제 확인 | admin_audit_log에 대량 권한 변경 기록 | 30분 |
| **P1** | 자격증명 유출 의심, 아직 악용 없음 | 피싱 링크 클릭 후 비정상 로그인 시도 감지 | 2시간 |
| **P2** | 일반 Admin 계정 탈취 | security_alerts에 admin_claim_set 이상 기록 | 4시간 |
| **P3** | 의심 활동 탐지, 침해 미확인 | detectAnomalousPoints 알람, 반복 로그인 실패 | 24시간 |

---

#### Step 1 — 격리 (5분 내)

```
□ Firebase Console → Authentication → 해당 계정 찾기 → ⋮ → "사용 중지(Disable)"
□ GCP Console → IAM & Admin → IAM → 해당 계정 행 → 연필 아이콘 → 모든 역할 제거
□ GitHub → Settings → Developer settings → Personal access tokens → 해당 토큰 Delete
□ (P0) GitHub → Settings → Security → Sessions → 다른 세션 모두 종료
```

#### Step 2 — 피해 범위 파악 (30분 내)

**Admin Panel 보안 리포트 탭 사용:**
```
Admin Panel → "보안 리포트" 탭 → 기간: 최근 7일 → 타입별 필터 순차 확인
  - admin_claim_set: 비인가 권한 부여 여부
  - points_spike / repeat_points_spike: 대량 점수 조작 여부
  - brute_force: 침해 시도 패턴
```

**Firestore 콘솔 직접 쿼리:**
```
// admin_audit_log — 의심 시각 전후 권한 변경 이력
Collection: admin_audit_log
정렬: createdAt DESC, 최대 50건 조회

// security_alerts — 최근 7일 admin_claim_set 이벤트
Collection: security_alerts
필터: type == "admin_claim_set"
필터: detectedAt >= <침해 의심 시각>
정렬: detectedAt DESC

// user_backups — 이상 백업 생성 여부 (공격자가 데이터 탈취 후 흔적 지우기 위해 백업 생성 가능)
Collection: user_backups
필터: createdAt >= <침해 의심 시각>
```

**GCP 감사 로그 확인:**
```
GCP Console → Logging → 로그 탐색기
리소스: Cloud Functions
필터:
  resource.type="cloud_function"
  protoPayload.methodName="google.cloud.functions.v2.FunctionService.UpdateFunction"
기간: 침해 의심 시각 전후 24시간
```

#### Step 3 — 복구 (백업 마스터 계정 사용)

```
□ 6-3절에 등록된 백업 마스터 계정으로 Firebase 로그인
  → Admin Panel 접속 → "Claim 관리" 탭에서 master+admin claim 확인
  → claim 미적용 시 "토큰 강제 갱신" 버튼 클릭

□ 침해 계정 모든 세션 강제 만료
  Firebase Console → Authentication → 침해 계정 → ⋮ → "세션 취소(Revoke sessions)"

□ 침해 계정 Custom Claims 전체 삭제
  Admin Panel → "Claim 관리" 탭 → "Admin/Master 권한 회수" → 침해 계정 UID 입력 → 권한 회수

□ API 키 즉시 순환
  Firebase Console → 프로젝트 설정 → 일반 → 웹 API 키 재생성
  GCP Console → IAM & Admin → 서비스 계정 → 침해된 키 삭제 → 신규 키 발급
  → GitHub Repository Secrets 업데이트 (FIREBASE_SERVICE_ACCOUNT)
  → deploy-firebase.yml 수동 실행으로 Functions 재배포
```

**env var 폴백 복구 (GitHub 접근 가능한 경우):**
```
GitHub → Settings → Secrets → ADMIN_MASTER_EMAIL
→ 침해 계정 이메일 제거, 백업 계정 이메일로 교체
→ Functions 재배포 → syncClaims() 자동 실행으로 master+admin claim 복구
```

#### Step 4 — 공격 유형별 추가 조치

**Credential Stuffing / 계정 탈취:**
```
□ 비밀번호 즉시 변경 (Bitwarden으로 20자 이상 새 비밀번호 생성)
□ Google 계정 → 보안 → 기기 활동 검토 → 모든 모르는 기기 강제 로그아웃
□ Gmail → 설정 → 다른 세션 모두 로그아웃
```

**Spear Phishing:**
```
□ Google 계정 → 보안 → 최근 보안 활동 → 의심 활동 신고
□ KISA 인터넷침해대응센터 → 악성 URL 신고 (boho.or.kr)
□ 피싱 도메인 확인: Google Safe Browsing 리포트
```

**Supply Chain (GitHub 저장소 침해):**
```
□ git log --all --oneline | head -50 → 의심 커밋 확인
□ git diff <정상 커밋>..<의심 커밋> -- functions/index.js → 악성 코드 확인
□ 악성 커밋 발견 시: git revert → PR → 신속 배포
□ GitHub → Settings → Security → Code security → Secret scanning → 경보 전수 확인
□ GitHub Personal Access Token 전체 재발급
□ GitHub SSH 키 전체 교체 (Settings → SSH and GPG keys)
```

#### Step 5 — 데이터 복구 판단

```
□ Admin Panel → "유저 관리" 탭 → 의심 유저 검색 → "백업 보기"
  → 이상 데이터 변경 전 백업 확인 → "롤백" 실행

□ 대규모 피해 시: user_backups 컬렉션에서 직전 백업 타임스탬프 확인
  → handleRollbackUserData Cloud Function으로 일괄 복구
  (Admin Panel → "유저 관리" → 해당 유저 → 백업 목록 → 롤백 버튼)
```

#### Step 6 — 법적 신고 의무 확인

| 상황 | 신고 대상 | 기한 | 근거 |
|------|-----------|------|------|
| 개인정보 유출 확인 | 개인정보보호위원회 | **72시간 내** | 개인정보보호법 제34조 |
| 유출 규모 1천 명 이상 | 피해 이용자 개별 통지 | 즉시 | 개인정보보호법 제34조 |
| 정보통신서비스 침해 | KISA 인터넷침해대응센터 | 즉시 | 정보통신망법 제48조의3 |

**개인정보보호위원회 신고 항목 (privacy.go.kr → 개인정보 유출 신고 / ☎ 182):**
```
1. 사고 발생 일시: YYYY-MM-DD HH:MM (KST)
2. 사고 경위: Firebase 관리자 계정 자격증명 탈취로 인한 무단 접근 의심
3. 피해 유형: 개인정보 열람/유출 여부 확인 중 (users 컬렉션 접근 기록 분석)
4. 수집 개인정보 항목: 이메일, 닉네임, 앱 내 활동 데이터 (건강·피트니스 정보 포함)
5. 즉시 취한 조치: 계정 비활성화, API 키 순환, 백업 계정 복구 완료
6. 후속 조치 계획: 2FA 강화, 접근 로그 보강, 취약점 패치
```

**KISA 인터넷침해대응센터 신고 (boho.or.kr → 침해사고 신고 / ☎ 118):**
```
침해 유형: 계정 탈취 / 악성코드 감염 중 해당 항목 선택
피해 시스템: Firebase 기반 모바일 앱 서버 (Google Cloud)
침해 경위 및 피해 범위 간략 기술
```

#### Step 7 — 사후 검토 체크리스트

```
침해 후 72시간 내:
□ 피해 UID 목록 확정 및 user_backups 대조 완료
□ 개인정보보호위원회 신고 제출 완료 (해당 시)
□ KISA 인터넷침해대응센터 신고 완료 (해당 시)
□ 영향받은 유저 1,000명 이상 시 개별 통지 발송

침해 후 1주 내:
□ 공격 진입점(entry point) 차단 완료
□ ADMIN_MASTER_EMAIL 환경변수 교체 및 Functions 재배포
□ GitHub Personal Access Token 전수 재발급
□ Admin Panel → listAdminOperators 재실행 → 권한 목록 전수 점검
□ Firestore security_alerts에서 잔존 이상 패턴 없음 확인

침해 후 1개월 내:
□ 피해 규모별 보험 청구 여부 결정 (7절 참조)
□ 재발 방지 대책 문서화 (이 문서 업데이트)
□ 백업 마스터 계정 분기 점검 실시 (6-3절 절차 준수)
□ 전체 의존성 재감사: npm audit --audit-level=high
```

---

### 6-3. 백업 관리자 계정 등록 및 관리

#### 6-3-1. 필요성

마스터 계정 침해 시 복구 경로를 확보하기 위해 별도 Google 계정을 백업 관리자로 등록한다.
env var 폴백(`ADMIN_MASTER_EMAIL`)만으로는 GitHub 계정도 동시 침해된 경우 Functions 재배포가 불가하므로,
Firestore `admin_config/backup_admins`에 등록된 백업 계정이 **1차 복구 수단**이 된다.

**복구 우선순위:**
```
1순위: admin_config/backup_admins 등록 계정 (master+admin claim 선부여, 즉시 로그인 가능)
2순위: ADMIN_MASTER_EMAIL env var (Functions 재배포 후 syncClaims 경유)
3순위: Firebase Console → Authentication 수동 계정 생성 (GCP IAM Owner 권한 필요)
```

#### 6-3-2. 등록 절차

```
1. 백업용 Google 계정 생성 (예: dev+backup@bravecat.studio)
   → 2FA 필수 (TOTP 앱 방식)
   → 기존 마스터 계정과 물리적으로 분리된 기기/브라우저 프로파일 사용

2. Firebase Auth에 최초 1회 로그인 (UID 생성 목적)
   → Admin Panel (levelup-app-53d02.web.app/admin/) 접속 시도
   → Firebase Console → Authentication → 신규 유저 UID 확인

3. 마스터 계정으로 Admin Panel 로그인
   → "Claim 관리" 탭 → "백업 관리자 계정" 섹션
   → 백업 계정 UID 입력 + 메모 입력 (예: "2026-Q2, dev+backup@bravecat.studio")
   → "등록" 버튼 클릭

4. 등록 완료 시 자동 처리:
   → registerBackupAdmin Cloud Function 호출
   → master+admin Custom Claim 즉시 부여
   → admin_config/backup_admins Firestore 문서에 기록
   → admin_audit_log 기록 → security_alerts 연동
```

#### 6-3-3. 분기별 검증 절차 (매 3/6/9/12월 말)

```
□ Admin Panel → "Claim 관리" 탭 → "백업 관리자 계정" → "목록 새로고침"
□ "계정 상태" 열이 "활성"인지 확인
□ "Master" 열이 ✓ (claim drift 없음) 인지 확인
□ 백업 계정으로 실제 로그인 테스트 (분기 1회)
  → Admin Panel 접속 확인 → 즉시 로그아웃
□ 이상 발견 시: 해당 UID를 "Admin/Master 권한 회수" 후 재등록

분기 점검 기록:
  2026-Q2: [ ] 미실시 / [x] 완료 (담당자: _____, 날짜: _____)
  2026-Q3: [ ] 미실시
  2026-Q4: [ ] 미실시
```

#### 6-3-4. 자격증명 보관

```
□ 백업 계정 비밀번호: Bitwarden 오프라인 Vault 또는 KeePass (마스터 계정 Vault와 분리)
□ 백업 계정 2FA 복구 코드: 오프라인 암호화 문서 또는 인쇄 후 물리 금고 보관
□ admin_config/backup_admins Firestore 문서: 마스터 전용 읽기 (firestore.rules 보호)
□ ADMIN_MASTER_EMAIL Secret: 백업 계정 이메일도 쉼표 구분으로 추가 등록 권장
  예: "primary@bravecat.studio,backup@bravecat.studio"
```

---

## 7. 개인정보보호 배상책임보험 검토

### 7-1. 가입 의무 여부 확인

```
개인정보보호법 제29조 / 정보통신망법에 따른 의무 가입 대상:

의무 가입 대상 (매출·이용자 수 기준):
  - 정보통신서비스 제공자로서 전년도 매출 5억 원 이상 또는
  - 전년도 말 기준 직전 3개월 간 일일 평균 이용자 수 1만 명 이상

현재 LEVEL UP: REBOOT 상태:
  - 다운로드 5+ (스토어 표시) → 소규모 서비스
  → 현재 의무 가입 대상에 해당하지 않을 가능성 높음
  → 단, 향후 성장 대비 자발적 가입 권장
```

### 7-2. 국내 보험 상품 비교 (비용 최소화)

| 보험사 | 상품명 | 예상 연보험료 | 보장 한도 | 특이사항 |
|--------|--------|-------------|----------|---------|
| **삼성화재** | 개인정보보호 배상책임보험 | 연 15~30만 원 | 1억~5억 원 | 소규모 앱 개발사 패키지 있음 |
| **현대해상** | Hi 개인정보보호책임보험 | 연 12~25만 원 | 1억~3억 원 | 스타트업 우대 요율 |
| **DB손해보험** | 개인정보보호 배상책임 | 연 10~20만 원 | 5천만~2억 원 | 소규모 사업자 최저가 |
| **KB손해보험** | KB 개인정보보호보험 | 연 15~30만 원 | 1억~5억 원 | IT 기업 특화 |

> ※ 보험료는 취급 개인정보 유형·수량, 연매출, 이용자 수에 따라 상이. 위 금액은 소규모(이용자 1천 명 미만) 기준 추정치

### 7-3. 최소비용 가입 전략

#### 옵션 A — 소규모 사업자 단체보험 (최저비용)

```
한국인터넷진흥원(KISA) — 중소기업 정보보호 지원 프로그램
→ URL: www.kisa.or.kr → 사업 안내 → 정보보호 지원
→ 소규모 앱 개발사 대상 단체 보험 지원 (일부 보험료 지원)
→ 연 5~10만 원 수준에서 기본 보장 가능
```

#### 옵션 B — DB손해보험 소규모 플랜 (권장)

```
보장 내용 (최소 플랜 기준):
  ✅ 개인정보 유출·도용으로 인한 손해배상 (피해자 1인당 최대 500만 원)
  ✅ 소송 대응 법률비용 (최대 500만 원)
  ✅ 사고 통지·조사 비용 (최대 200만 원)
  ✅ 신용 모니터링 서비스 제공 비용

예상 연보험료: 10~15만 원 / 보장 한도 5천만~1억 원
→ DB손보 기업영업부 직접 문의 시 할인 가능
```

#### 옵션 C — 결합보험 (비용 효율 최대화)

```
사업자 패키지 보험에 개인정보 특약 추가:
  기존 사업자 배상책임보험 + 개인정보 특약 추가
  → 독립 계약 대비 20~30% 저렴
  → 삼성화재/현대해상 기업영업팀 문의 시 패키지 견적 요청
```

### 7-4. 가입 전 준비 서류

```
보험 가입 시 필요한 정보:
□ 사업자등록증 또는 개인사업자 정보
□ 취급 개인정보 유형 (이름, 이메일, 위치정보, 건강/피트니스 정보)
□ 개인정보 처리 방침 URL
□ 연간 처리 이용자 수 (예상치)
□ 개인정보 보호책임자(CPO) 지정 여부

Play Store 표시 수집 항목 (현재):
  → 위치, 건강 및 피트니스 정보 (2가지)
  → 개인 정보 (4가지)
  ※ 건강/피트니스 정보 포함 시 보험료 가산 가능
```

### 7-5. 보험 외 무료 대안 조치

```
보험 가입 전·후 병행할 무료 조치:

1. 개인정보보호위원회 자가점검 도구 활용
   → privacy.go.kr → 자가점검 → 모바일 앱 개인정보 점검
   → 무료 온라인 진단 (법적 리스크 사전 식별)

2. KISA 취약점 신고 포상제 활용
   → 외부 연구자가 취약점 발견 시 체계적 접수 경로 마련
   → bug@bravecat.studio 또는 보안 정책 페이지 추가

3. 개인정보 처리 방침 정기 업데이트
   → 수집 항목 변경 시 즉시 반영 (법적 분쟁 예방)
   → 최신 Play Store 표시 정보와 일치 여부 월 1회 확인
```

---

## 8. 우선순위 체크리스트

### 즉시 (오늘 중, 무료)

```
🔴 [ ] nazi2k@gmail.com Google 계정 2FA 활성화 (TOTP 앱 방식)
🔴 [ ] Play Store 개발자 이메일 → support@bravecat.studio 변경
🔴 [ ] GitHub 계정 2FA 활성화
🔴 [ ] GitHub Personal Access Token 전수 검토 및 미사용 삭제
🟢 [x] debug.keystore 파일 공개 저장소 포함 여부 확인 및 .gitignore 적용 (GitHub Secret DEBUG_KEYSTORE_BASE64 으로 이전 완료)
🔴 [ ] 비밀번호 매니저 도입 (Bitwarden 무료) + 전체 비밀번호 갱신
```

### 단기 (1주 내, 무료)

```
🟢 [x] GitHub 계정명 변경 (nazi2k-cyber → bravecat-studio 완료)
🟠 [ ] 변경 후 저장소 내 구 계정명 참조 일괄 업데이트
🟢 [x] GitHub main 브랜치 보호 규칙 설정
      → `.github/workflows/apply-branch-protection.yml` 생성 완료
      → GitHub Actions → apply-branch-protection → Run workflow 수동 실행으로 적용
🟠 [ ] Firebase Console IAM 권한 감사 및 불필요 계정 제거
🟠 [ ] 앱 내 admin 계정을 dev@bravecat.studio 로 이전
      → GitHub Secret `ADMIN_MASTER_EMAIL` 값을 `dev@bravecat.studio` 로 설정 후 Functions 재배포
      → 신규 계정으로 로그인 시 syncClaims()가 master+admin 자동 부여
      → Admin 진단 페이지 → Claim 관리 → "Admin/Master 권한 회수" 로 기존 계정(nazi2k@gmail.com) 권한 제거
      → `removeAdminClaim` Cloud Function 및 UI 구현 완료 (claude/admin-email-secrets-c3lmX)
🟠 [ ] Play Store 개발자 표시명 → 브랜드명(Bravecat Studios)으로 변경 검토
🟠 [ ] GCP API 키 HTTP 리퍼러 제한 설정
```

### 중기 (1개월 내)

```
🟡 [ ] 개인정보보호 배상책임보험 가입 (DB손보 소규모 플랜 우선 견적)
🟡 [ ] KISA 자가점검 도구로 개인정보 처리 적법성 점검
🟢 [x] 침해 대응 절차(BCP) 문서화 및 백업 관리자 계정 등록
      → BCP P0~P3 심각도 분류, 7단계 대응 절차, 법적 신고 템플릿 추가 완료
      → Admin Panel "Claim 관리" 탭에 백업 관리자 등록/조회 UI 구현 완료
      → Firestore admin_config/backup_admins 컬렉션 + registerBackupAdmin/getBackupAdmins Cloud Function 구현 완료
🟡 [ ] 보안 취약점 신고 이메일(bug@bravecat.studio) 공개 및 정책 페이지 추가
🟡 [ ] GCP Secret Manager로 ADMIN_EMAILS / AZURE_CS_KEY 이전
```

---

## 부록: 관련 법령 및 신고 의무

| 상황 | 의무 사항 | 기한 | 근거 |
|------|-----------|------|------|
| 개인정보 유출 발생 | 개인정보보호위원회 신고 | 72시간 내 | 개인정보보호법 제34조 |
| 유출 규모 1천 명 이상 | 피해 이용자 개별 통지 | 즉시 | 개인정보보호법 제34조 |
| 정보통신서비스 침해 | KISA 인터넷침해대응센터 신고 | 즉시 | 정보통신망법 제48조의3 |

**신고 연락처:**
- 개인정보보호위원회: privacy.go.kr / 국번없이 182
- KISA 인터넷침해대응센터: boho.or.kr / 국번없이 118

---

*본 문서는 2026-04-20 기준 Play Store 개발자 정보 노출 현황을 바탕으로 작성되었습니다.*  
*보험 상품 및 보험료는 실제 가입 시 해당 보험사에 정확한 견적을 받으시기 바랍니다.*
