# Main 브랜치 보호 규칙 설정 가이드

> 이 문서는 `nazi2k-cyber/levelup-app` 저장소의 `main` 브랜치 보호를 위한 설정 가이드입니다.

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

### 3-3. Tag 보호
**Settings → Tags → Add rule**

```
패턴: v*
설명: 릴리즈 태그 보호 — auto-version 워크플로우만 생성 가능
```

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

## 6. 체크리스트

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
