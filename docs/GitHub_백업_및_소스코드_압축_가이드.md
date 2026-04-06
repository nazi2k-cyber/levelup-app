# GitHub 백업 및 소스코드 압축 가이드

## 문서 정보

| 항목 | 내용 |
|------|------|
| **앱 이름** | LEVEL UP: REBOOT |
| **현재 버전** | 1.0.206 |
| **작성 일자** | 2026-04-06 |
| **관련 문서** | [`모바일앱_저작권_등록방안_보고서.md`](모바일앱_저작권_등록방안_보고서.md) |

> 본 문서는 GitHub 백업, 소스코드 압축, CROS 저작권등록 제출 패키지 생성에 대한 실무 가이드이다.

---

## 1. 백업 체계 개요

프로젝트에는 세 가지 백업 도구가 구현되어 있다.

| 도구 | 파일 | 용도 |
|------|------|------|
| **로컬 소스코드 백업** | `scripts/backup.sh` | 소스코드 압축 (tar.gz/zip) |
| **Git 저장소 백업** | `scripts/github-backup.sh` | 전체 히스토리 포함 백업 (미러/번들/클론) |
| **CROS 제출 패키지** | `scripts/cros-package.sh` | 한국저작권등록시스템 제출용 |
| **GitHub Actions** | `.github/workflows/backup.yml` | 자동/수동 원격 백업 |

---

## 2. 로컬 소스코드 백업 (`scripts/backup.sh`)

### 2-1. 사용법

```bash
npm run backup          # tar.gz 기본 백업
npm run backup:zip      # ZIP 형식
npm run backup:full     # .git 포함 전체 백업

# 직접 실행
bash scripts/backup.sh --firebase   # Firebase 설정 파일 포함
```

### 2-2. 옵션

| 옵션 | 설명 |
|------|------|
| `--zip` | ZIP 형식으로 압축 (기본: tar.gz) |
| `--full` | .git 디렉토리 포함 전체 백업 |
| `--firebase` | Firebase 설정 파일(firebase-config.js, .env 등) 포함 |

### 2-3. 자동 제외 항목

- `node_modules/` — npm 패키지 (재설치 가능)
- `android/` — 네이티브 빌드 산출물 (cap add로 재생성)
- `.firebase/` — Firebase 캐시
- `backups/` — 기존 백업 파일
- `*.log` — 로그 파일

### 2-4. 출력

```
backups/levelup-reboot_v1.0.206_20260406_225403.tar.gz (33MB)
```

---

## 3. Git 저장소 백업 (`scripts/github-backup.sh`)

### 3-1. 사용법

```bash
npm run backup:git      # .git 미러 복사 (가장 빠름)
npm run backup:bundle   # Git Bundle (이식 가능한 단일 파일)

# 직접 실행
bash scripts/github-backup.sh --clone         # 원격 저장소 미러 클론
bash scripts/github-backup.sh --clone <url>   # 특정 저장소 클론
```

### 3-2. 방식별 비교

| 방식 | 명령어 | 크기 | 특징 | 복원 방법 |
|------|--------|------|------|-----------|
| **미러** (기본) | `--` | 중간 | .git 전체 복사, 가장 빠름 | `tar xzf *.tar.gz && git checkout .` |
| **번들** | `--bundle` | **24MB** | 단일 파일, USB/이메일 전송 적합 | `git clone *.bundle restored-project` |
| **클론** | `--clone` | 큼 | 원격 저장소 완전 미러 | `git clone mirror-clone_*/ restored-project` |

### 3-3. 포함 내용

- 모든 브랜치 (원격 포함)
- 모든 태그
- 전체 커밋 히스토리
- Git 객체 (blob, tree, commit)

---

## 4. GitHub Actions 자동 백업 (`.github/workflows/backup.yml`)

### 4-1. 트리거

| 방식 | 일정 |
|------|------|
| **자동 (schedule)** | 매주 일요일 자정 KST (cron: `0 15 * * 0` UTC) |
| **수동 (workflow_dispatch)** | GitHub Actions 탭에서 직접 실행 |

### 4-2. 수동 실행 옵션

| 옵션 | 선택지 | 기본값 | 설명 |
|------|--------|--------|------|
| 백업 유형 | `full` / `source-only` / `git-bundle` / `cros` | `full` | 아래 상세 참조 |
| 압축 형식 | `tar.gz` / `zip` | `tar.gz` | 소스코드 압축 형식 |
| GitHub Release로 게시 | `true` / `false` | `false` | Release 탭에 영구 게시 |

### 4-3. 백업 유형별 차이

| 유형 | 생성물 | 용도 |
|------|--------|------|
| `full` | 소스코드 압축 + Git Bundle | **일반 백업** (개발자 보관용) |
| `source-only` | 소스코드 압축만 | 가벼운 소스 백업 |
| `git-bundle` | Git Bundle만 | 히스토리만 보관 |
| `cros` | 마스킹 소스 + 설명서 + 증빙 + 봉인본 | **CROS 저작권등록 제출용** |

### 4-4. Artifact vs Release

| | Artifact (기본) | Release (체크 시) |
|---|---|---|
| 보관 기간 | **90일** 후 자동 삭제 | **영구** 보관 |
| 접근 방법 | Actions → 실행 기록 → Artifacts | Releases 탭 + 직접 URL |
| 공개 범위 | 저장소 접근 권한자만 | Public repo면 **누구나** |
| 권장 용도 | 정기 백업 | 마일스톤 버전 아카이브 |

> **주의**: `cros` 모드에서 Release 게시 시, Public 저장소에서는 봉인본 ZIP이 공개될 수 있다. Artifact로만 다운로드하여 CROS에 직접 제출할 것을 권장한다.

### 4-5. 워크플로우 처리 단계

```
1. 전체 히스토리 체크아웃 (fetch-depth: 0)
   ↓
2. 프로젝트 메타데이터 수집 (버전, 커밋, 브랜치 수)
   ↓
3. 유형별 백업 생성
   ├── full/source-only: 소스코드 압축 (민감 정보 제외)
   ├── full/git-bundle:  Git Bundle + 무결성 검증
   └── cros:             CROS 제출 패키지 (마스킹 + 봉인)
   ↓
4. SHA256 체크섬 생성
   ↓
5. Artifact 업로드 (90일 보관)
   ↓
6. (선택) GitHub Release 게시
```

---

## 5. CROS 저작권등록 제출 패키지 (`scripts/cros-package.sh`)

### 5-1. 배경

한국저작권위원회 CROS(cros.or.kr)에 프로그램 저작물을 등록할 때, 단순한 백업 파일(tar.gz/zip/bundle)은 직접 제출할 수 없다. CROS는 다음을 요구한다:

1. **소스코드 사본** (ZIP) — 오픈소스/제3자 코드 제외
2. **프로그램 설명서** — 기능·구조·실행환경 설명
3. **주요 화면 스크린샷** — 5~10장 (수동 준비 필요)
4. **저작자 신원 확인 서류** — 사업자등록증 또는 신분증 (수동 준비 필요)

### 5-2. 사용법

```bash
npm run backup:cros                                # 기본 (일부 공개 모드)
bash scripts/cros-package.sh --mode full           # 전체 공개
bash scripts/cros-package.sh --mode partial        # 일부 공개 (핵심 마스킹) ← 권장
bash scripts/cros-package.sh --mode sealed         # 비공개 봉인
bash scripts/cros-package.sh --author "홍길동"     # 저작자 실명 지정
bash scripts/cros-package.sh --company "법인명"    # 저작권자 법인명 변경
```

### 5-3. 생성 패키지 구조

```
CROS_제출_LEVEL_UP_REBOOT_v1.0.206_20260406.zip (1.3MB)
│
├── 01_소스코드/                    자체 저작 소스코드 (70개 파일, ~72,000줄)
│   ├── app.js                      핵심 앱 로직 (마스킹 적용)
│   ├── data.js                     다국어/보상 데이터 (마스킹 적용)
│   ├── style.css, logger.js ...    기타 프론트엔드
│   ├── native-plugins/             Android 네이티브 플러그인
│   ├── functions/                  Cloud Functions (마스킹 적용)
│   ├── www/admin/                  관리자 대시보드
│   ├── www/modules/                기능 모듈 (마스킹 적용)
│   └── scripts/                    빌드/배포 스크립트
│
├── 01_소스코드_LEVEL_UP_REBOOT_v1.0.206.zip    소스코드 ZIP (CROS 업로드용)
│
├── 02_프로그램설명서/
│   ├── 프로그램_설명서.txt          기능·구조·실행환경 (6개 섹션)
│   ├── 소스코드_목록.txt            파일별 라인 수 통계
│   └── 마스킹_목록.txt              마스킹 처리 대상 및 사유 (partial 모드)
│
├── 03_창작증빙자료/
│   ├── Git_커밋이력.txt             전체 커밋 로그 (시간순, 창작일 입증)
│   └── Git_상세이력.txt             변경 파일 포함 상세 이력
│
└── 04_비공개봉인_LEVEL_UP_REBOOT_v1.0.206.zip  (partial/sealed 모드)
    ├── 원본_소스코드/               마스킹 없는 원본 코드
    ├── SHA256_해시목록.txt          무결성 검증용 해시
    └── 봉인_안내문.txt              봉인 조건 및 저작물 정보
    (비밀번호 보호: CROS-BRAVECAT-STUDIOS-YYYYMMDD)
```

---

## 6. 소스코드 제출 방식 (비공개 봉인 상세)

### 6-1. 세 가지 제출 방식

CROS 저작권 등록 시, 소스코드를 어떤 수준으로 공개할지 선택할 수 있다.

#### 전체 공개 (`--mode full`)

```
소스코드 전문을 그대로 제출
→ 코드 전체가 증거 → 가장 강력한 입증력
→ 단, 누구든 열람 가능 (핵심 로직 노출)
```

- **적합**: 오픈소스 프로젝트, 공개해도 무방한 코드
- **위험**: 경쟁사가 핵심 알고리즘을 복제할 수 있음

#### 일부 공개 (`--mode partial`) — 권장

```
핵심 알고리즘 부분만 마스킹 후 제출
+ 원본은 비공개 봉인본으로 별도 동봉
→ 코드 구조는 공개 (저작물 증명)
→ 핵심 수치만 보호 (영업비밀 보호)
→ 분쟁 시 봉인본 개봉으로 원본 입증 가능
```

- **적합**: 상용 앱, 핵심 공식이 차별화 요소인 경우
- **장점**: 입증력과 보호를 모두 확보하는 균형 잡힌 방식

#### 비공개 봉인 (`--mode sealed`)

```
소스코드 전체를 봉인 제출
→ 분쟁 발생 시 한국저작권위원회 요청에 의해서만 개봉
→ 평시 열람 완전 불가
```

- **적합**: 고도의 영업비밀이 포함된 소프트웨어
- **단점**: 등록 후에도 코드 확인 불가 (분쟁 전까지)

### 6-2. 방식별 비교표

| | 전체 공개 | 일부 공개 (권장) | 비공개 봉인 |
|---|---|---|---|
| 코드 열람 | 누구나 가능 | 구조만 가능 (수치 마스킹) | 분쟁 시에만 |
| 저작물 입증력 | ★★★ 최강 | ★★☆ 충분 | ★☆☆ 약함 |
| 영업비밀 보호 | ☆☆☆ 없음 | ★★☆ 핵심 보호 | ★★★ 완전 |
| 봉인본 동봉 | 불필요 | 포함 (비밀번호 ZIP) | 전체가 봉인 |
| 분쟁 시 대응 | 즉시 | 봉인 개봉 | 봉인 개봉 |

---

## 7. 마스킹 처리 대상 (일부 공개 모드)

프로젝트 소스코드 심층 분석을 통해 식별된 마스킹 대상이다.

### 7-1. [HIGH] 게이미피케이션 핵심 알고리즘 — `app.js`

| 대상 | 함수/로직 | 마스킹 내용 | 사유 |
|------|-----------|-------------|------|
| 레벨업 비용 공식 | `processLevelUp()` | `100 * 1.5^(level-1)` → `[MASKED_BASE] * [MASKED_SCALE]^(level-1)` | 지수 성장 곡선 결정 |
| 스트릭 배율 | `getStreakMultiplier()` | `× 1.2/1.5/2.0/3.0` → `× [MASKED_MULT]` | 4단계 보상 체계 |
| 비활동 감쇠 | `applyStreakAndDecay()` | `decayDays * 0.1` → `decayDays * [MASKED_DECAY]` | 패널티 강도 |
| 크리티컬 확률 | `rollCritical()` | `0.15 (15%)` → `[MASKED_CRIT_RATE]` | 크리티컬 발동률 |
| 크리티컬 분포 | `getCriticalMultiplier()` | `0.30 (30%→3x, 70%→2x)` → `[MASKED_CRIT_DIST]` | 배수 분배 비율 |
| 퀘스트 보상 | 퀘스트 완료 로직 | `20pt / 0.5stat` → `[MASKED_REWARD]` | 기본 보상 수치 |
| 던전 보상 | 던전 클리어 로직 | `200pt / 2.0stat` → `[MASKED_REWARD]` | 고급 보상 수치 |

### 7-2. [HIGH] 보상/루트 테이블 — `data.js`

| 대상 | 마스킹 내용 | 사유 |
|------|-------------|------|
| 루트 드롭 가중치 | `weight: 20` → `weight: [MASKED_WEIGHT]` | 등급별 확률 분포 |
| 보상 수치 | `value: 500` → `value: [MASKED_VALUE]` | 등급별 보상량 |

**마스킹 예시:**

```
원본: { tier: 'legendary', weight: 2, reward: { type: 'points', value: 500 } }
제출: { tier: 'legendary', weight: [MASKED_WEIGHT], reward: { type: 'points', value: [MASKED_VALUE] } }
```

구조(tier, type)는 보존되어 저작물임을 증명하고, 수치만 보호된다.

### 7-3. [HIGH] 운동 과학 계산 계수 — `www/modules/exercise-calc.js`

| 대상 | 함수 | 원본 계수 | 마스킹 |
|------|------|-----------|--------|
| VO2max 1차 계수 | `calcVO2()` | `0.182258` | `[MASKED_COEFF]` |
| VO2max 2차 계수 | `calcVO2()` | `0.000104` | `[MASKED_COEFF]` |
| VO2max% 감쇠 파라미터 | `calcPctVO2max()` | `0.1894393`, `0.012778`, `0.2989558`, `0.1932605` | `[MASKED_COEFF]` |
| Lander 공식 계수 | `calcLander()` | `2.67123` | `[MASKED_COEFF]` |

### 7-4. [MEDIUM] 콘텐츠 스크리닝 임계값 — `functions/index.js`

| 대상 | 함수 | 마스킹 |
|------|------|--------|
| NSFW 확률 → 등급 변환 | `nsfwProbToLikelihood()` | `> 0.85` → `> [MASKED_THRESHOLD]` |
| 2단계 스크리닝 분기 | `screenImage()` | `> 0.80` → `> [MASKED_THRESHOLD]` |
| Azure 심각도 매핑 | Azure severity 변환 | `>= 5` → `>= [MASKED_SEVERITY]` |

### 7-5. 마스킹 태그 일람

| 태그 | 의미 | 적용 대상 |
|------|------|-----------|
| `[MASKED_SCALE]` | 스케일링 계수 | 레벨업 지수 |
| `[MASKED_BASE]` | 기준값 | 레벨업 기본 비용 |
| `[MASKED_MULT]` | 배율 값 | 스트릭 보상 배수 |
| `[MASKED_REWARD]` | 보상 수치 | 포인트·스탯 보상 |
| `[MASKED_WEIGHT]` | 가중치 | 루트 드롭 확률 |
| `[MASKED_VALUE]` | 수치 값 | 보상 테이블 값 |
| `[MASKED_CRIT_RATE]` | 확률 값 | 크리티컬 발동률 |
| `[MASKED_CRIT_DIST]` | 분포 값 | 크리티컬 배수 분배 |
| `[MASKED_DECAY]` | 감쇠 계수 | 비활동 패널티 |
| `[MASKED_COEFF]` | 수학 계수 | 운동 과학 공식 |
| `[MASKED_THRESHOLD]` | 임계값 | NSFW 감지 기준 |
| `[MASKED_SEVERITY]` | 심각도 기준 | Azure 심각도 매핑 |

---

## 8. 비공개 봉인본 상세

### 8-1. 봉인본이란

마스킹된 공개 소스코드와 별도로, **원본 코드 전체**를 비밀번호 보호 ZIP으로 봉인하여 동봉하는 것이다.

### 8-2. 봉인본 구성

```
04_비공개봉인_LEVEL_UP_REBOOT_v1.0.206.zip (비밀번호 보호)
├── 원본_소스코드/          마스킹 없는 원본 코드
│   ├── app.js              모든 수치 원본 포함
│   ├── data.js             보상 테이블 원본
│   ├── functions/index.js  스크리닝 임계값 원본
│   └── ...
├── SHA256_해시목록.txt     파일별 SHA256 해시 (무결성 검증)
└── 봉인_안내문.txt         봉인 조건, 저작물 정보
```

### 8-3. 비밀번호 규칙

```
형식: CROS-{법인명}-{날짜}
예시: CROS-BRAVECAT-STUDIOS-20260406
```

이 비밀번호는 **안전한 곳에 별도 보관**해야 한다. 봉인 개봉 시 필요하다.

### 8-4. 무결성 검증

봉인본에는 `SHA256_해시목록.txt`가 포함되어 있다. 분쟁 시 봉인을 해제한 후, 해시를 대조하여 원본이 변조되지 않았음을 증명할 수 있다.

```
예시:
a1b2c3d4...  app.js
e5f6g7h8...  functions/index.js
```

### 8-5. 법적 근거

- **저작권법 제53조** (등록): 저작자·창작일·공표일 등의 등록
- **저작권법 제125조의2** (법정손해배상): 등록된 저작물에 대한 법정손해배상 청구 가능
- **영업비밀보호법**: 비공개 조치를 통한 영업비밀 요건 충족

---

## 9. npm 스크립트 일람

```json
{
  "backup":        "bash scripts/backup.sh",
  "backup:zip":    "bash scripts/backup.sh --zip",
  "backup:full":   "bash scripts/backup.sh --full",
  "backup:git":    "bash scripts/github-backup.sh",
  "backup:bundle": "bash scripts/github-backup.sh --bundle",
  "backup:cros":   "bash scripts/cros-package.sh"
}
```

---

## 10. CROS 제출 체크리스트

### 10-1. 자동 생성 (스크립트)

- [x] 소스코드 사본 (ZIP, 오픈소스/제3자 코드 제외)
- [x] 프로그램 설명서 (기능·구조·실행환경)
- [x] 소스코드 파일 목록 및 라인 수 통계
- [x] 마스킹 목록 문서 (마스킹 대상·사유·방법)
- [x] Git 커밋 이력 (창작일·창작과정 입증)
- [x] Git 상세 이력 (변경 파일 포함)
- [x] 비공개 봉인본 (비밀번호 보호 ZIP + SHA256 해시)

### 10-2. 수동 준비 필요

- [ ] **주요 화면 스크린샷** (5~10장) → 앱 실행 후 캡처하여 `02_프로그램설명서/`에 추가
- [ ] **저작자 신원 확인 서류** → 사업자등록증 또는 신분증 사본
- [ ] **CROS 온라인 신청서** → cros.or.kr에서 직접 작성
  - 저작물 유형: "컴퓨터프로그램저작물"
  - 저작물 명칭: "LEVEL UP: REBOOT 모바일 애플리케이션"
  - 창작연월일: 최초 커밋일 기준 (Git 이력 참조)
  - 공표연월일: 플레이스토어 최초 출시일
- [ ] **수수료 납부** → 프로그램 저작물 등록 건당 약 24,000원

---

## 11. 권장 운영 전략

### 11-1. 정기 백업

| 주기 | 방법 | 설정 |
|------|------|------|
| 매주 | GitHub Actions 자동 실행 | schedule cron (일요일 자정 KST) |
| 메이저 릴리즈 시 | 수동 + Release 게시 | workflow_dispatch + create_release |

### 11-2. 저작권 등록 시점

| 시점 | 조치 |
|------|------|
| 개발 중 (현재) | `npm run backup:cros`로 CROS 등록 → 창작일 확보 |
| 출시 시 | 공표연월일 등록 추가 |
| 메이저 업데이트 | 변경 등록 또는 신규 등록 검토 |

### 11-3. 봉인 비밀번호 관리

봉인 비밀번호는 다음 중 하나의 방법으로 안전하게 보관한다:

1. 사내 비밀번호 관리 도구 (1Password, Bitwarden 등)
2. 봉인된 물리적 문서 (금고 보관)
3. 법무 담당자에게 별도 전달

> **주의**: 비밀번호를 분실하면 봉인본을 열 수 없다. 반드시 별도 보관할 것.
