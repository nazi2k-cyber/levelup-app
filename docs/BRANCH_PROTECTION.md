# Main 브랜치 보호 규칙 설정 가이드

> 이 문서는 `bravecat-studio/levelup-app` 저장소의 `main` 브랜치 보호를 위한 설정 가이드입니다.

## 1. 왜 브랜치 보호가 필요한가?

현재 `main` 브랜치에 직접 push가 가능하여 다음 위험이 존재합니다:

| 위험 | 영향 | 심각도 |
|------|------|--------|
| 검증 없는 코드가 프로덕션 배포 | Firebase Hosting/Functions에 버그 배포 | 🔴 높음 |
| Firestore 보안 규칙 실수 | 사용자 데이터 유출/손상 가능 | 🔴 높음 |
| 실수로 force push | 커밋 이력 손실 | 🔴 높음 |
| 민감 정보(API 키 등) 커밋 | 보안 사고 | 🔴 높음 |
| 빌드 깨짐 감지 못함 | APK 빌드 실패, 배포 중단 | 🟡 중간 |

## 2. GitHub 브랜치 보호 규칙 설정

### 설정 경로
**Settings → Branches → Add branch protection rule**

### 권장 설정값

#### Branch name pattern
```
main
```

#### ✅ 활성화할 규칙

| 규칙 | 설정값 | 설명 |
|------|--------|------|
| **Require a pull request before merging** | ✅ 활성화 | main에 직접 push 차단, 반드시 PR 통해 머지 |
| ├─ Required approvals | `1` | 최소 1명 리뷰 승인 필요 |
| ├─ Dismiss stale PR approvals | ✅ | 새 커밋 push 시 이전 승인 무효화 |
| └─ Require review from CODEOWNERS | ✅ | CODEOWNERS에 지정된 담당자 리뷰 필수 |
| **Require status checks to pass** | ✅ 활성화 | PR 머지 전 CI 검증 통과 필수 |
| ├─ Required checks | `파일 검증`, `민감 정보 스캔`, `빌드 검증` | PR 검증 워크플로우의 job 이름 |
| └─ Require branches be up to date | ✅ | 머지 전 최신 main과 동기화 필수 |
| **Require conversation resolution** | ✅ | 모든 리뷰 코멘트 해결 후 머지 |
| **Do not allow bypassing** | ✅ | 관리자도 규칙 우회 불가 |

#### ❌ 비활성화 권장 규칙

| 규칙 | 이유 |
|------|------|
| Require signed commits | 개인 프로젝트에서는 과도한 설정 |
| Require linear history | auto-version bot의 머지 커밋 허용 필요 |
| Lock branch | main에 PR 머지 자체를 차단하므로 비활성화 |

## 3. 추가 보호 설정

### 3-1. Ruleset 설정 (권장)
**Settings → Rules → Rulesets → New ruleset**

```yaml
이름: main 보호 규칙
대상: main 브랜치
규칙:
  - Restrict deletions          # 브랜치 삭제 방지
  - Block force pushes          # force push 차단
  - Require pull request        # PR 필수
  - Require status checks       # CI 통과 필수
```

### 3-2. GitHub Actions 봇 예외 처리

`auto-version.yml`과 `build.yml` 워크플로우는 `github-actions[bot]`이 main에 직접 커밋합니다.
브랜치 보호 규칙에서 아래 설정이 필요합니다:

**Ruleset → Bypass list에 추가:**
- `github-actions[bot]` (Deploy key 또는 GitHub App)

또는 **Branch protection rule에서:**
- "Restrict who can push to matching branches" → `github-actions[bot]` 허용

### 3-3. Tag 보호 (Ruleset)
**Settings → Rules → Rulesets → "Tag 보호"**

현재 설정:
```yaml
이름: Tag 보호
대상: v* (모든 버전 태그)
Enforcement: Active
Bypass list:
  - Repository admin (Always allow)
규칙:
  - Restrict creations     # 태그 생성 제한
  - Restrict deletions     # 태그 삭제 제한
  - Block force pushes     # force push 차단
```

#### ⚠️ auto-version 워크플로우 태그 생성 실패 해결

기본 `GITHUB_TOKEN`은 Ruleset의 바이패스 목록에 추가할 수 없어서,
auto-version 워크플로우가 `v*` 태그를 생성할 때 권한 오류가 발생합니다.

**해결 방법: PAT(Personal Access Token) 사용**

1. GitHub **프로필 아이콘** → **Settings** (개인 계정 설정) → 왼쪽 사이드바 맨 아래 **Developer settings**
2. **Personal access tokens → Fine-grained tokens → Generate new token**
   - Token name: `auto-version-tag`
   - Repository access: **Only select repositories** → `levelup-app`
   - Permissions: **Contents** → Read and Write
3. Repository **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `PAT_TOKEN`
   - Secret: 생성한 PAT 붙여넣기

워크플로우(`auto-version.yml`)의 checkout 단계에서 PAT를 사용하도록 설정되어 있습니다:
```yaml
- name: 소스코드 체크아웃
  uses: actions/checkout@v5
  with:
    fetch-depth: 0
    token: ${{ secrets.PAT_TOKEN || secrets.GITHUB_TOKEN }}
```

> **참고:** PAT 소유자가 Repository admin 역할이면 Ruleset의 "Restrict creations"를 바이패스할 수 있습니다.
> Fine-grained token이 보이지 않는 경우, **Classic token** (`repo` 스코프)을 사용해도 됩니다.

## 4. 구현된 자동화 보호

### PR 검증 워크플로우 (`.github/workflows/pr-check.yml`)

PR이 생성/업데이트될 때 자동으로 실행되는 4단계 검증:

```
┌─────────────────────────────────────────────────┐
│  PR → main                                      │
├─────────────────────────────────────────────────┤
│  ✅ 파일 검증       │ JSON 구문, VERSION 형식,  │
│                     │ 필수 파일 존재 확인       │
├─────────────────────────────────────────────────┤
│  ✅ Firestore 규칙  │ 보안 규칙 구문 검증       │
│                     │ (중괄호 균형 등)          │
├─────────────────────────────────────────────────┤
│  ✅ 민감 정보 스캔  │ 프라이빗 키, AWS 키,      │
│                     │ .env 파일 등 검출         │
├─────────────────────────────────────────────────┤
│  ✅ 빌드 검증       │ JS 구문 검증,             │
│                     │ npm 설치, www 동기화 확인  │
└─────────────────────────────────────────────────┘
```

### CODEOWNERS (`.github/CODEOWNERS`)

핵심 파일 변경 시 지정된 소유자의 리뷰 승인을 요구합니다:

- **앱 코드**: `app.js`, `app.html`, `data.js`, `style.css`
- **보안 규칙**: `firestore.rules`, `storage.rules`
- **서버 코드**: `functions/`
- **CI/CD**: `.github/`
- **설정 파일**: `package.json`, `firebase.json`, `capacitor.config.json`

## 5. 개발 워크플로우 (보호 적용 후)

```
1. 기능 브랜치 생성
   git checkout -b feature/새기능

2. 개발 및 커밋
   git add . && git commit -m "[minor] 새 기능 추가"

3. PR 생성
   gh pr create --base main --title "새 기능 추가"

4. 자동 검증 대기
   - PR 검증 워크플로우 4개 job 모두 통과 확인
   - CODEOWNERS 리뷰 승인 대기

5. 머지
   - 모든 체크 통과 + 리뷰 승인 후 머지
   - auto-version이 자동으로 버전 범프
   - build 워크플로우가 자동으로 APK 빌드
```

## 6. PR 머지 차단 원인 및 해결 방법

### 증상

PR 페이지에서 아래와 같은 메시지가 표시되며 머지 버튼이 비활성화됩니다:

```
⚠ Review required
  At least 1 approving review is required by reviewers with write access.

✅ All checks have passed (5 successful checks)

🔴 Merging is blocked
  At least 1 approving review is required by reviewers with write access.
```

### 원인

브랜치 보호 규칙에서 **"Require a pull request before merging"** + **"Required approvals: 1"** 이 설정되어 있어, **write 권한 이상을 가진 리뷰어의 Approve**가 최소 1건 필요합니다.

### 해결 방법

| 방법 | 설명 | 권한 요구 |
|------|------|-----------|
| **리뷰어에게 승인 요청** | write 권한이 있는 팀원에게 PR 리뷰 및 Approve 요청 | - |
| **Bypass rules 체크박스 사용** | PR 하단의 "Merge without waiting for requirements to be met (bypass rules)" 체크 후 머지 | Admin 또는 Bypass 권한 |
| **브랜치 보호 규칙 수정** | Settings → Branches에서 approval 요구 조건을 해제하거나 수를 0으로 변경 | Admin |
| **Self-approval 허용** | Settings → Branches → "Allow specified actors to bypass required pull requests" 에 본인 추가 | Admin |

### 개인 프로젝트(1인 개발)인 경우

리뷰어가 본인뿐이라면 아래 중 하나를 적용하세요:

1. **Required approvals를 0으로 변경** — PR은 필수지만 승인 없이 머지 가능
2. **"Require a pull request before merging" 자체를 해제** — main에 직접 push 가능
3. **Bypass list에 본인 추가** — 규칙은 유지하되 본인은 우회 가능

## 7. Write 권한 팀원 확인 방법

### GitHub 웹에서 확인

1. **레포지토리 Settings 페이지 접속**
   ```
   https://github.com/bravecat-studio/levelup-app/settings/access
   ```

2. **Collaborators and teams** 섹션에서 확인 가능한 정보:
   - 초대된 collaborator 목록
   - 각 collaborator의 역할(Role): `Read`, `Triage`, `Write`, `Maintain`, `Admin`
   - 팀 단위로 추가된 경우 팀 이름과 권한

3. **Write 이상 권한을 가진 사용자**만 PR Approve가 유효합니다:
   - `Write` — 코드 push 및 PR 승인 가능
   - `Maintain` — Write + 일부 관리 기능
   - `Admin` — 모든 권한

### Organization 소속 레포인 경우

**Settings → Manage access → Teams** 에서 팀별 권한을 확인하세요:
```
예시:
  @org/developers  →  Write
  @org/reviewers   →  Maintain
  @org/admins      →  Admin
```

### 새 Collaborator 추가 방법

```
Settings → Collaborators → Add people
→ GitHub 사용자명 또는 이메일 입력
→ Role을 "Write" 이상으로 설정
→ Add to repository
```

> **참고:** Free 플랜의 private 레포지토리는 collaborator 수에 제한이 있을 수 있습니다.

## 8. 체크리스트

GitHub 설정에서 아래 항목을 순서대로 적용하세요:

- [ ] Branch protection rule 생성 (`main` 브랜치)
- [ ] PR 필수 + 1명 승인 설정
- [ ] Required status checks에 `파일 검증`, `민감 정보 스캔`, `빌드 검증` 추가
- [ ] CODEOWNERS 리뷰 필수 활성화
- [ ] Force push 차단 확인
- [ ] 브랜치 삭제 방지 확인
- [ ] `github-actions[bot]` 예외 처리 (auto-version 동작 보장)
- [ ] Tag 보호 규칙 추가 (`v*`)
- [ ] 테스트 PR 생성하여 워크플로우 동작 확인
