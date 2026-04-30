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
