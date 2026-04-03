# 자동 버전 관리 무한 루프 버그 분석

> 작성일: 2026-04-03
> 상태: 수정 완료

## 요약

PR 머지 후 자동 버전 업데이트(`auto-version.yml`)가 연쇄적으로 반복 실행되는 무한 루프 버그.
커밋 `a855d67`에서 `[skip ci]`를 제거한 이후 발생하였으며, 패치 버전이 의미 없이 계속 증가했다.

---

## 무한 루프 흐름

```
사용자 PR 머지 → main push
    ↓
auto-version.yml 트리거 (on: push to main)
    ↓
auto-version/vX.Y.Z 브랜치 생성 → PR 생성 → 자동 squash 머지
    ↓
squash 머지 커밋 → main push  ← auto-version.yml 재트리거!
    ↓
build.yml 트리거 (workflow_run: auto-version 완료)
    ↓
sync-www.sh → sync 커밋 생성 → main push  ← auto-version.yml 재트리거!
    ↓
새 patch 버전 bump (v1.0.155 → v1.0.156 → v1.0.157 → ...)
    ↓
무한 반복
```

---

## 근본 원인

### 1. `github.actor` 체크 우회 (`auto-version.yml:14`)

```yaml
if: github.actor != 'github-actions[bot]'
```

squash 머지 시 actor가 PR 생성자 또는 리포 소유자로 귀속되어 이 체크를 통과한다.

### 2. `[skip ci]` 제거 (`auto-version.yml:171`, 커밋 `a855d67`)

`[skip ci]`가 `pr-check.yml`까지 차단하여 자동 머지가 불가능했기 때문에 제거했으나, 이로 인해 버전 커밋이 워크플로우를 재트리거하게 되었다.

### 3. build.yml sync 커밋의 루프 방지 부재 (`build.yml:114,122`)

`build.yml`의 sync 커밋 메시지에 루프 방지 마커가 없어 main push 시 `auto-version.yml`을 재트리거한다.

### 4. `[skip ci]` 패러독스

| 상태 | 결과 |
|------|------|
| `[skip ci]` 있음 | PR 체크 스킵 → 자동 머지 불가 → 루프는 없지만 기능 불완전 |
| `[skip ci]` 없음 | PR 체크 통과 → 자동 머지 → squash 커밋이 main push → 루프 발생 |

---

## 수정 내용

### 핵심: 커스텀 마커 `[auto-version]` 도입

`[skip ci]`는 GitHub의 모든 워크플로우를 차단하는 반면, `[auto-version]`은 `auto-version.yml`에서만 체크하므로 `pr-check.yml`에 영향을 주지 않는다.

### 변경 사항

#### `auto-version.yml`

| 위치 | 변경 |
|------|------|
| skip_check 스텝 | `[skip ci]` 패턴을 `[auto-version]` + `^sync:` 패턴으로 교체 |
| 라인 171 (커밋 메시지) | `"chore: vX.Y.Z 자동 버전 업데이트 [auto-version]"` |
| 라인 213 (PR 머지) | `--squash-merge-commit-title`로 squash 커밋에도 마커 포함 |

#### `build.yml`

| 위치 | 변경 |
|------|------|
| 라인 114 (sync 커밋) | `"sync: www/ 최신 수정사항을 루트에 반영 [auto-version]"` |
| 라인 122 (sync 커밋) | `"sync: 루트 최신 수정사항을 www/에 반영 [auto-version]"` |

---

## 루프 차단 검증

### 시나리오 1: 일반 PR 머지
1. 사용자 PR 머지 → auto-version 정상 실행 (커밋에 `[auto-version]` 없음)
2. 버전 PR squash 머지 → 커밋 제목에 `[auto-version]` 포함
3. auto-version 재트리거 → `[auto-version]` 감지 → **스킵** (루프 차단)

### 시나리오 2: build.yml sync 커밋
1. sync 커밋 메시지에 `sync:` + `[auto-version]` 포함
2. main push → auto-version 트리거 → 패턴 감지 → **스킵** (루프 차단)

### 시나리오 3: PR 체크 정상 작동
1. `pr-check.yml`은 `pull_request` 이벤트 기반 → `[auto-version]` 마커 무관
2. PR 체크 정상 실행 → 자동 머지 가능

---

## 관련 파일

- `.github/workflows/auto-version.yml` — 자동 버전 관리 워크플로우
- `.github/workflows/build.yml` — APK 빌드 및 www 동기화
- `.github/workflows/pr-check.yml` — PR 검증 (수정 불필요)
- `sync-www.sh` — 루트 ↔ www 양방향 동기화 스크립트
- `scripts/version-bump.sh` — 버전 파일 동기화 스크립트
