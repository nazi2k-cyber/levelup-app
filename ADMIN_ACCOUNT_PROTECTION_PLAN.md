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

4. APK/AAB 서명 키 보안
   → debug.keystore (저장소 루트에 존재 확인됨) 즉시 .gitignore 추가 검토
   → 프로덕션 keystore는 Google Play App Signing 위임 권장 (키 분실/탈취 대비)
```

**⚠️ 긴급: debug.keystore 파일 점검**
```bash
# 현재 저장소 루트에 debug.keystore 파일 존재
# 이 파일이 공개 저장소에 포함되어 있는지 즉시 확인 필요
git log --all --full-history -- debug.keystore
git ls-files debug.keystore
```

```
만약 공개 저장소에 커밋된 경우:
→ git filter-branch 또는 BFG Repo Cleaner로 히스토리에서 제거
→ 해당 키스토어로 서명된 인증서 즉시 교체 검토
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

```
마스터 계정 침해 의심 시 즉시 실행:

Step 1 — 격리 (5분 내)
  Firebase Console → Authentication → 해당 계정 비활성화
  GCP Console → IAM → 해당 계정 권한 일시 중단

Step 2 — 피해 범위 파악 (30분 내)
  security_alerts 컬렉션 최근 로그 조회
  admin_audit_log 컬렉션 최근 권한 변경 이력 확인
  Firestore 콘솔에서 이상 데이터 변경 여부 확인

Step 3 — 복구
  백업 마스터 계정으로 재접속 (별도 Google 계정 사전 등록 필요)
  침해된 계정의 모든 세션 강제 만료
  API 키 즉시 순환

Step 4 — 사후 조치
  유저 데이터 백업본(user_backups 컬렉션)으로 복원 여부 판단
  개인정보보호위원회 신고 (72시간 내 — 개인정보보호법 제34조)
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
🟡 [ ] 침해 대응 절차(BCP) 문서화 및 백업 관리자 계정 등록
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
