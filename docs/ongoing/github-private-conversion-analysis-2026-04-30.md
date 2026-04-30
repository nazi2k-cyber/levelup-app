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

## 부록: 사전 조치 상세 절차

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

출력 예시:
```
bravecat.studio.  3600  IN  A  185.199.108.153   ← GitHub Pages IP, TTL=3600
bravecat.studio.  3600  IN  A  185.199.109.153
bravecat.studio.  3600  IN  A  185.199.110.153
bravecat.studio.  3600  IN  A  185.199.111.153
```

**TTL을 300초(5분)로 낮추기:**

도메인 등록업체(가비아, Cloudflare 등) DNS 관리 패널에서 `bravecat.studio` A 레코드의 TTL을 `300`으로 변경합니다.

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
값:    firebase=xxxxxxxxxxxxxxxxxxxxxx  ← Firebase 콘솔에서 확인
```

DNS 관리 패널에서 위 TXT 레코드를 추가한 뒤 Firebase 콘솔에서 **인증 완료** 버튼 클릭.
TXT 레코드 전파: 보통 수 분 ~ 수십 분 소요.

---

### STEP 3: Firebase가 제공하는 A 레코드 확인

`bravecat.studio`는 **Apex 도메인**(www 없는 최상위)이므로 CNAME을 쓸 수 없습니다(DNS 표준 제약).
Firebase는 이를 위해 **A 레코드(IPv4) 2개**를 제공합니다.

소유권 인증 후 Firebase 콘솔에서 다음 형태로 표시됩니다:

```
타입:  A
호스트: bravecat.studio (또는 @)
값:    151.101.x.x   ← Firebase 콘솔에서 확인 (프로젝트별로 다름)
값:    151.101.x.x
```

이 값을 메모해 둡니다.

---

### STEP 4: DNS 레코드 교체 (실제 전환)

도메인 관리 패널에서 **기존 GitHub Pages A 레코드를 삭제**하고 Firebase A 레코드로 교체합니다.

| 변경 전 (GitHub Pages) | 변경 후 (Firebase Hosting) |
|----------------------|--------------------------|
| A → 185.199.108.153 | A → Firebase IP 1 |
| A → 185.199.109.153 | A → Firebase IP 2 |
| A → 185.199.110.153 | (삭제) |
| A → 185.199.111.153 | (삭제) |
| TTL: 300 | TTL: 300 (유지) |

`www.bravecat.studio`도 추가할 경우:

```
타입:  CNAME
호스트: www
값:    levelup-app-53d02.web.app
TTL:   300
```

---

### STEP 5: Firebase SSL 인증서 자동 발급 대기

DNS 전파가 완료되면 Firebase가 **Let's Encrypt 인증서를 자동 발급**합니다.
Firebase 콘솔 Hosting 패널에서 상태가 `연결됨`으로 바뀌는 것을 확인합니다.

소요 시간: TTL을 300초로 낮췄다면 **5~30분** 내 완료.

---

### STEP 6: 동작 확인 후 레포 Private 전환

```bash
# HTTPS 정상 응답 확인
curl -I https://bravecat.studio

# HTTP → HTTPS 리디렉션 확인
curl -I http://bravecat.studio

# Firebase 서빙 확인 (응답 헤더에 x-firebase-* 포함 여부)
curl -v https://bravecat.studio 2>&1 | grep -i "server\|firebase"
```

응답이 정상이면 이 시점에서 레포를 Private으로 전환해도 `bravecat.studio`는 영향 없습니다.

---

### 전환 타임라인 예시

```
D-2  현재 TTL 조회
D-1  DNS TTL → 300초로 변경
     Firebase 콘솔: 도메인 추가 + TXT 레코드 소유권 인증

D-0  (전환 당일)
     09:00  DNS A 레코드 교체 (GitHub Pages IP → Firebase IP)
     09:05  Firebase 콘솔에서 DNS 전파 감지 확인
     09:30  SSL 인증서 발급 완료 확인
     09:35  https://bravecat.studio 정상 동작 확인
     09:40  레포 Private 전환 (GitHub Settings → Danger Zone)

D+1  DNS TTL → 3600초로 복원 (안정화 후)
```

---

### 주의사항

| 항목 | 내용 |
|------|------|
| `docs/CNAME` 파일 | Private 전환 후 GitHub Pages 비활성화 시 의미 없어짐. 이후 삭제 가능 |
| `firebase.json` rewrite 규칙 | `"source": "**", "destination": "/index.html"` — 존재하지 않는 경로는 모두 `index.html`(랜딩페이지)로 포워딩. 앱(`www/app.html`)은 파일이 실제 존재하므로 정상 서빙됨 |
| `sync-landing-page.yml` | Firebase 이전 후에도 `www/ ↔ docs/` 동기화는 계속 동작. `docs/`는 백업 역할로 유지 가능 |
