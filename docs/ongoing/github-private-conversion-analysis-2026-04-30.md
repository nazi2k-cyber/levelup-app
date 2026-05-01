# GitHub Public → Private 전환 시 문제점 분석

> 작성일: 2026-04-30  
> 대상 레포: `bravecat-studio/levelup-app`

---

## 현재 구조 요약

| 항목 | 상세 |
|------|------|
| 레포 | `bravecat-studio/levelup-app` (Organization) |
| 홈페이지 | `bravecat.studio` — `docs/CNAME` 기반 **GitHub Pages** 서빙 |
| 앱 호스팅 | Firebase Hosting (`www/` → `levelup-app-53d02.web.app`) |
| 워크플로우 | 15개 (Actions 집중 운영) |
| 라이선스 | `UNLICENSED` (비공개 의도 명확) |

---

## 문제 1: GitHub Pages 중단 (즉각적, 치명적)

**현상**: `docs/CNAME = bravecat.studio` → 랜딩페이지가 GitHub Pages로 서빙 중

**규칙**: Organization Free 플랜에서 **Private 레포는 GitHub Pages 불가**

전환 즉시 `bravecat.studio` 랜딩페이지가 404로 내려갑니다.

### 해결 선택지

| 방법 | 비용 | 작업량 |
|------|------|--------|
| **Firebase Hosting으로 이전** | 무료 | 낮음 — `www/index.html` 이미 동기화됨, Firebase 콘솔에서 커스텀 도메인 `bravecat.studio` 연결만 하면 됨 |
| **GitHub Team 플랜 업그레이드** | $4/user/월 | 없음 — 업그레이드만으로 Pages 유지 |

> `sync-landing-page.yml`이 `www/ ↔ docs/` 양방향 동기화를 이미 하고 있으므로,
> Firebase Hosting 이전 시 `docs/` 기반 작업은 그대로 유지하고 서빙 경로만 바꾸면 됩니다.

---

## 문제 2: GitHub Actions 무료 분 소진 (즉각적, 중요)

**규칙**: Public 레포는 Actions **무제한 무료** → Private 전환 시 Free 플랜 **월 2,000분** 한도

### 워크플로우별 예상 소모

| 워크플로우 | 트리거 | 예상 소모 |
|-----------|--------|----------|
| `pr-check.yml` (4개 잡) | PR마다 | ~40분/PR |
| `lighthouse.yml` | PR (`www/**` 변경 시) | ~8분/PR |
| `security-scan.yml` | 매주 월요일 + main 푸시 | ~25분/주 → **100분/월** |
| `backup.yml` | 매주 일요일 | ~10분/주 → **40분/월** |
| `release-aab.yml` | 태그 푸시 | ~30분/릴리즈 |
| `deploy-firebase.yml` | 배포 시 | ~5분/회 |
| `zap-scan.yml` | 분기별 | ~10분/분기 |
| `auto-version.yml` | main 푸시 시 | ~3분/회 |

### 월 5회 PR 기준 추정

- PR 관련: 5 × (40 + 8) = **240분**
- 정기 스케줄: **140분**
- 기타 배포: **50분**
- **합계: ~430분/월** — Free 한도(2,000분) 내 운용 가능

릴리즈 집중 기간이나 PR 빈도 증가 시 초과 위험. 초과 요금: Linux 기준 **$0.008/분**

---

## 문제 3: Gitleaks Action 유료 라이선스 필요 (즉각적, 중요)

`security-scan.yml`의 `gitleaks/gitleaks-action@v2`는 **Private 레포에서 유료 라이선스(`GITLEAKS_LICENSE` Secret) 없이 실행 시 즉시 실패**합니다.

```yaml
# security-scan.yml — 현재
- uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}  ← 없으면 에러
```

### 해결 선택지

| 방법 | 비용 |
|------|------|
| `gitleaks/gitleaks-action@v2` → CLI 직접 설치 방식으로 교체 | **무료** |
| Gitleaks 라이선스 구매 | $99/년 |

> `pr-check.yml`의 `secret-scan` 잡은 자체 쉘 스크립트로 구현되어 있으므로 영향 없음.

---

## 문제 4: 브랜치 보호 규칙 일부 제한 (플랜 의존)

`apply-branch-protection.yml`이 설정하는 규칙 중 일부는 **Organization Free 플랜 + Private 레포 조합에서 제한**됩니다.

| 기능 | Free Org (Private) | Team 이상 |
|------|:---:|:---:|
| 브랜치 보호 기본 (직접 푸시 차단) | ✓ | ✓ |
| Required status checks | ✓ | ✓ |
| CODEOWNERS 강제 리뷰 | ✗ | ✓ |
| Required reviewers 수 강제 | ✗ | ✓ |

현재 `apply-branch-protection.yml`에서 `require_code_owner_reviews: true`를 설정하는데,
Free 플랜 + Private에서는 이 설정이 무시됩니다.

---

## 비용 요약

| 항목 | 현재 (Public) | 전환 후 (Private, Free 플랜) | Team 플랜 |
|------|:---:|:---:|:---:|
| GitHub Pages | 무료 | **불가** | 가능 |
| Actions 분 | 무제한 무료 | 2,000분/월 무료 | 3,000분/월 무료 |
| Actions 초과 요금 | — | $0.008/분 | $0.008/분 |
| CODEOWNERS 강제 | 지원 | **미지원** | 지원 |
| Team 플랜 요금 | — | — | **$4/user/월** |

---

## 권장 전환 순서

1. **사전 조치** — Firebase Hosting에 `bravecat.studio` 커스텀 도메인 등록 후 DNS TTL 낮추기
2. **Gitleaks 수정** — `security-scan.yml`의 `gitleaks-action@v2` → CLI 직접 호출 방식으로 교체
3. **레포 Private 전환** — GitHub Settings → Danger Zone
4. **GitHub Pages 확인** — 비활성화 확인 후 Firebase Hosting 도메인 전파 대기 (최대 48시간)
5. **Actions 모니터링** — 첫 달 분 사용량 확인 (Settings → Billing → Actions)

> Firebase Hosting 이전을 1번에서 완료하면 Pages 다운타임 없이 전환 가능합니다.

---

## 부록 A: Firebase 전환 실제 진행 상황 (2026-04-30)

### 현재 Squarespace DNS 상태

| 타입 | 호스트 | 값 | TTL | 상태 |
|------|--------|-----|-----|------|
| TXT | bravecat.studio | `hosting-site=levelup-app-53d02` | 30분 | ✅ 완료 |
| A | bravecat.studio | `199.36.158.100` | 30분 | ✅ Firebase IP 추가됨 |
| A | bravecat.studio | `185.199.108.153` | 30분 | ❌ **삭제 필요** (GitHub Pages) |
| A | bravecat.studio | `185.199.109.153` | 30분 | ❌ **삭제 필요** (GitHub Pages) |
| A | bravecat.studio | `185.199.110.153` | 30분 | ❌ **삭제 필요** (GitHub Pages) |
| A | bravecat.studio | `185.199.111.153` | 30분 | ❌ **삭제 필요** (GitHub Pages) |
| CNAME | www | `nazi2k-cyber.github.io` | 4시간 | ⚠️ 추후 변경 권장 |

### Firebase 콘솔 에러 원인 분석

```
ACME 문제에 대한 호스팅의 HTTP GET 요청이 하나 이상 실패했습니다.
185.199.108.153: 404 Not Found
185.199.109.153: 404 Not Found
185.199.110.153: 404 Not Found
185.199.111.153: 404 Not Found
```

**원인**: Firebase는 SSL 인증서 발급 시 Let's Encrypt ACME 챌린지를 사용합니다.
이 챌린지는 `http://bravecat.studio/.well-known/acme-challenge/...` 경로로 HTTP GET을 보내는데,
현재 GitHub Pages A 레코드 4개가 공존하면서 일부 요청이 GitHub Pages로 라우팅됩니다.
GitHub Pages는 Firebase ACME 챌린지를 알 수 없으므로 404를 반환 → **SSL 발급 실패**.

```
요청 흐름 (현재 — 문제 상황):
ACME 서버 → bravecat.studio → DNS가 5개 A 레코드 중 하나를 랜덤 선택
                              ├─ 199.36.158.100 (Firebase) → 챌린지 응답 성공
                              ├─ 185.199.108.153 (GitHub Pages) → 404
                              ├─ 185.199.109.153 (GitHub Pages) → 404
                              ├─ 185.199.110.153 (GitHub Pages) → 404
                              └─ 185.199.111.153 (GitHub Pages) → 404
```

### 지금 해야 할 작업 (단 1가지)

**Squarespace DNS에서 GitHub Pages A 레코드 4개 삭제:**

```
삭제: A  bravecat.studio  185.199.108.153
삭제: A  bravecat.studio  185.199.109.153
삭제: A  bravecat.studio  185.199.110.153
삭제: A  bravecat.studio  185.199.111.153
```

삭제 후 TTL(30분) 경과 시 자동으로:
1. 모든 DNS 쿼리가 `199.36.158.100`(Firebase)으로만 라우팅
2. Firebase ACME 챌린지 성공 → Let's Encrypt SSL 인증서 발급
3. Firebase 콘솔 상태: `연결됨`으로 변경
4. `https://bravecat.studio` → Firebase Hosting 서빙 시작

### 삭제 후 요청 흐름 (정상)

```
ACME 서버 → bravecat.studio → 199.36.158.100 (Firebase만) → 챌린지 응답 성공 → SSL 발급
사용자     → bravecat.studio → 199.36.158.100 (Firebase만) → www/index.html 서빙
```

### www CNAME 후속 조치 (선택, 권장)

현재 `www.bravecat.studio` CNAME이 `nazi2k-cyber.github.io`를 가리키고 있습니다.
Firebase 이전 완료 후 아래와 같이 변경을 권장합니다.

```
변경 전: CNAME  www  nazi2k-cyber.github.io  (4시간)
변경 후: CNAME  www  levelup-app-53d02.web.app  (30분 → 안정화 후 3600초)
```

Firebase 콘솔에서 `www.bravecat.studio`도 별도로 커스텀 도메인으로 추가하거나,
`bravecat.studio`로 리디렉션하도록 설정할 수 있습니다.

### 완료 확인 명령어

```bash
# GitHub Pages IP가 사라지고 Firebase IP만 남았는지 확인
dig bravecat.studio A +short
# 기대 출력: 199.36.158.100 (Firebase IP만)

# HTTPS 정상 응답 확인 (SSL 발급 완료 후)
curl -I https://bravecat.studio

# Firebase 서빙 헤더 확인
curl -s -I https://bravecat.studio | grep -i "server\|x-firebase\|cache-control"
```

---

## 부록 B: 사전 조치 상세 절차 (일반 참고)

### 전체 흐름

```
현재:  bravecat.studio  →  GitHub Pages      →  docs/index.html
목표:  bravecat.studio  →  Firebase Hosting  →  www/index.html  (동일 파일)
```

`www/index.html`은 `sync-landing-page.yml`로 `docs/index.html`과 이미 동기화되므로
콘텐츠 변경 없이 서빙 경로만 바꾸면 됩니다.

- Firebase 프로젝트: `levelup-app-53d02`
- 퍼블릭 디렉토리: `www/` (`firebase.json` 기준)

---

### STEP 0: 현재 DNS TTL 확인 (전환 D-2 ~ D-1)

DNS 레코드 변경 후 전 세계 DNS 서버에 새 정보가 전파되는 시간이 TTL입니다.
TTL이 크면(예: 86400초 = 24시간) 레코드를 바꿔도 일부 사용자는 하루 동안 GitHub Pages로 접속합니다.

**현재 TTL 조회:**

```bash
dig bravecat.studio A +noall +answer
```

**TTL을 300초(5분)로 낮추기:**

도메인 등록업체 DNS 관리 패널에서 `bravecat.studio` A 레코드의 TTL을 `300`으로 변경합니다.

> TTL 변경 자체도 기존 TTL만큼 전파 시간이 걸립니다.
> 현재 TTL이 3600초라면 낮추는 작업을 **실제 전환 최소 1시간 전**에 완료해야 효과가 있습니다.

---

### STEP 1: Firebase 콘솔에서 커스텀 도메인 추가

1. Firebase 콘솔 → `levelup-app-53d02` 프로젝트 → **Hosting** 메뉴
2. **커스텀 도메인 추가** 클릭
3. 도메인 입력: `bravecat.studio`
4. `www.bravecat.studio` 리디렉션 추가 여부 선택 (권장: 추가)

---

### STEP 2: 도메인 소유권 인증 (TXT 레코드)

Firebase가 소유권 확인용 TXT 레코드를 제공합니다.

```
타입:  TXT
호스트: bravecat.studio (또는 @)
값:    hosting-site=levelup-app-53d02  ← Firebase 콘솔에서 확인
```

DNS 관리 패널에서 위 TXT 레코드를 추가한 뒤 Firebase 콘솔에서 **인증 완료** 버튼 클릭.

---

### STEP 3: Firebase A 레코드 추가 후 GitHub Pages A 레코드 삭제

`bravecat.studio`는 **Apex 도메인**이므로 CNAME 불가 — A 레코드 사용.

| 작업 | 타입 | 값 |
|------|------|----|
| 추가 | A | `199.36.158.100` (Firebase — 콘솔에서 확인) |
| 삭제 | A | `185.199.108.153` (GitHub Pages) |
| 삭제 | A | `185.199.109.153` (GitHub Pages) |
| 삭제 | A | `185.199.110.153` (GitHub Pages) |
| 삭제 | A | `185.199.111.153` (GitHub Pages) |

---

### STEP 4: SSL 인증서 자동 발급 대기 및 확인

DNS 전파(TTL 경과) 후 Firebase가 **Let's Encrypt 인증서를 자동 발급**합니다.
Firebase 콘솔 Hosting 패널에서 상태가 `연결됨`으로 바뀌는 것을 확인합니다.

```bash
curl -I https://bravecat.studio
```

---

### 전환 타임라인 예시

```
D-2  현재 TTL 조회
D-1  DNS TTL → 300초로 변경
     Firebase 콘솔: 도메인 추가 + TXT 레코드 소유권 인증

D-0  (전환 당일)
     09:00  Firebase A 레코드 추가 + GitHub Pages A 레코드 4개 삭제
     09:30  Firebase 콘솔 상태 '연결됨' 확인
     09:35  https://bravecat.studio 정상 동작 확인
     09:40  레포 Private 전환 (GitHub Settings → Danger Zone)

D+1  DNS TTL → 3600초로 복원 (안정화 후)
```

---

### 주의사항

| 항목 | 내용 |
|------|------|
| `docs/CNAME` 파일 | Private 전환 후 GitHub Pages 비활성화 시 의미 없어짐. 이후 삭제 가능 |
| `firebase.json` rewrite 규칙 | `"source": "**", "destination": "/index.html"` — 앱(`www/app.html`)은 파일이 실제 존재하므로 정상 서빙됨 |
| `sync-landing-page.yml` | Firebase 이전 후에도 `www/ ↔ docs/` 동기화는 계속 동작. `docs/`는 백업 역할로 유지 가능 |

---

## 부록 C: 검증 결과 — 브랜치 보호 규칙 수정 불필요 확인

> 검증일: 2026-05-01  
> 검증 방법: `.github/workflows/apply-branch-protection.yml` 페이로드 및 `.github/workflows/pr-check.yml` 구현 코드 직접 분석

### 결론: **브랜치 보호 규칙 파일 수정 불필요**

Private 전환 후에도 `apply-branch-protection.yml`은 오류 없이 실행되며, 핵심 보호 기능은 유지됩니다.
`require_code_owner_reviews: true`만 Free 플랜 제한으로 **에러 없이 무시**됩니다.

### 규칙별 동작 검증

`apply-branch-protection.yml` 페이로드(lines 77–99)를 기준으로 각 설정의 Private 전환 후 동작:

| 설정 | 값 | Private 전환 후 동작 |
|------|-----|----------------------|
| `required_status_checks.strict` | `true` | ✅ 정상 — main 최신 커밋 기반 체크 강제 |
| `required_status_checks.contexts` | validate, firestore-rules, secret-scan, build-check | ✅ 정상 — 4개 체크 통과 없이 merge 불가 |
| `require_code_owner_reviews` | `true` | ⚠️ **무시됨** — Free Org + Private에서 API가 200을 반환하지만 실제 미적용 |
| `required_approving_review_count` | `0` | ✅ 정상 — 리뷰 수 0명 요구 유지 |
| `dismiss_stale_reviews` | `true` | ✅ 정상 — 새 커밋 시 기존 승인 자동 취소 |
| `allow_force_pushes` | `false` | ✅ 정상 — force push 차단 유지 |
| `allow_deletions` | `false` | ✅ 정상 — 브랜치 삭제 차단 유지 |
| `enforce_admins` | `false` | ✅ 정상 — Admin 우회 허용 유지 |
| `restrictions` | `null` | ✅ 정상 — push 제한 없음 유지 |

### `secret-scan` Required Status Check — gitleaks 라이선스 문제 비해당

문제 3(Gitleaks 라이선스 요구)은 `security-scan.yml`(주간 스케줄)에만 해당됩니다.

Required Status Check로 등록된 `secret-scan`은 **`pr-check.yml`의 별도 잡**으로, gitleaks-action을 사용하지 않습니다:

```yaml
# pr-check.yml — secret-scan 잡 구현 (lines 93–151)
# gitleaks-action 미사용. 쉘 스크립트로 직접 grep 패턴 매칭:
PATTERNS=(
  "-----BEGIN (RSA |EC )?PRIVATE KEY-----"
  "AKIA[0-9A-Z]{16}"       # AWS Access Key
  "sk_live_[a-zA-Z0-9]+"  # Stripe Secret Key
  "ghp_[a-zA-Z0-9]{36}"   # GitHub PAT
  "xoxb-[0-9]+-..."        # Slack Bot Token
  "AIza[0-9A-Za-z_-]{35}" # Google API Key
)
```

→ Private 전환 후 **라이선스 없이도 `secret-scan` 체크 정상 통과**.

### 요약

| 항목 | 판단 |
|------|------|
| 브랜치 보호 규칙 파일 수정 필요 여부 | **불필요** |
| 워크플로우 오류 발생 여부 | **없음** |
| CODEOWNERS 리뷰 강제 유지 여부 | **유지 안 됨** (Free 플랜 제한, 에러는 없음) |
| PR merge 차단 기능 유지 여부 | **유지됨** (4개 status check + PR 필수) |
| force push / 브랜치 삭제 차단 유지 여부 | **유지됨** |
