#!/bin/bash
# ============================================================
# CROS(한국저작권등록시스템) 제출용 패키지 생성 스크립트
# ============================================================
# CROS 요구사항:
#   1. 소스코드 사본 (ZIP) - 오픈소스/제3자 코드 제외
#   2. 프로그램 설명서 (TXT/PDF) - 기능·구조·실행환경
#   3. 소스코드 목록 및 라인 수 (자체 저작 코드 증빙)
#   4. Git 이력 요약 (창작일·창작과정 입증)
# ============================================================
# 사용법:
#   bash scripts/cros-package.sh                          # 기본 (일부 공개)
#   bash scripts/cros-package.sh --mode full              # 전체 공개
#   bash scripts/cros-package.sh --mode partial            # 일부 공개 (핵심 로직 마스킹)
#   bash scripts/cros-package.sh --mode sealed             # 비공개 봉인
#   bash scripts/cros-package.sh --author "홍길동"
#   bash scripts/cros-package.sh --company "BRAVECAT STUDIOS"
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── 설정 ──
APP_NAME="LEVEL UP: REBOOT"
PACKAGE_ID="com.levelup.reboot"
COMPANY="BRAVECAT STUDIOS"
AUTHOR=""
SUBMIT_MODE="partial"  # full | partial | sealed
TIMESTAMP=$(date +"%Y%m%d")
VERSION=$(cat VERSION 2>/dev/null | tr -d '[:space:]' || echo "unknown")

# ── 색상 ──
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ── 옵션 파싱 ──
while [[ $# -gt 0 ]]; do
    case $1 in
        --author)   AUTHOR="$2"; shift 2 ;;
        --company)  COMPANY="$2"; shift 2 ;;
        --mode)     SUBMIT_MODE="$2"; shift 2 ;;
        --help|-h)
            echo "사용법: bash scripts/cros-package.sh [옵션]"
            echo "  --mode <모드>      제출 방식 (기본: partial)"
            echo "                     full    = 전체 공개 (소스코드 전문 제출)"
            echo "                     partial = 일부 공개 (핵심 알고리즘 마스킹)"
            echo "                     sealed  = 비공개 봉인 (암호화 ZIP, 분쟁 시 개봉)"
            echo "  --author <이름>    저작자 실명"
            echo "  --company <법인명>  저작권자 법인명 (기본: BRAVECAT STUDIOS)"
            exit 0 ;;
        *) shift ;;
    esac
done

# ── 출력 디렉토리 ──
OUTPUT_DIR="${PROJECT_DIR}/backups/cros_${TIMESTAMP}_v${VERSION}"
SOURCE_DIR="${OUTPUT_DIR}/01_소스코드"
DOC_DIR="${OUTPUT_DIR}/02_프로그램설명서"
EVIDENCE_DIR="${OUTPUT_DIR}/03_창작증빙자료"

mkdir -p "$SOURCE_DIR" "$DOC_DIR" "$EVIDENCE_DIR"

echo ""
log_info "=========================================="
log_info " CROS 저작권등록 제출 패키지 생성"
log_info "=========================================="
log_info "앱: ${APP_NAME} v${VERSION}"
log_info "저작권자: ${COMPANY}"
case $SUBMIT_MODE in
    full)    log_info "제출 방식: 전체 공개 (소스코드 전문)" ;;
    partial) log_info "제출 방식: 일부 공개 (핵심 알고리즘 마스킹)" ;;
    sealed)  log_info "제출 방식: 비공개 봉인 (암호화 ZIP)" ;;
esac
echo ""

# ============================================================
# 1. 소스코드 사본 (자체 저작 코드만 포함)
# ============================================================
log_info "[1/4] 소스코드 사본 생성 중..."

# 자체 저작 소스코드 파일 목록
SOURCE_FILES=(
    # 프론트엔드 핵심
    "app.js"
    "app.html"
    "data.js"
    "style.css"
    "intro-style.css"
    "logger.js"
    "sw.js"
    "firebase-messaging-sw.js"
    "index.html"
    "manifest.json"
    # 법적 문서
    "privacy.html"
    "terms.html"
    "usage-policy.html"
    "account-deletion.html"
    # Firebase
    "firestore.rules"
    "storage.rules"
    "firebase.json"
    # 빌드 설정
    "capacitor.config.json"
    "package.json"
    "sync-www.sh"
)

# 소스코드 복사
for f in "${SOURCE_FILES[@]}"; do
    if [ -f "$f" ]; then
        cp "$f" "$SOURCE_DIR/"
    fi
done

# 하위 디렉토리 복사
cp -r native-plugins/ "$SOURCE_DIR/native-plugins/" 2>/dev/null || true
cp -r scripts/ "$SOURCE_DIR/scripts/" 2>/dev/null || true
mkdir -p "$SOURCE_DIR/functions"
cp functions/index.js "$SOURCE_DIR/functions/" 2>/dev/null || true
cp functions/package.json "$SOURCE_DIR/functions/" 2>/dev/null || true
mkdir -p "$SOURCE_DIR/www/admin/js" "$SOURCE_DIR/www/admin/css"
cp www/admin/js/*.js "$SOURCE_DIR/www/admin/js/" 2>/dev/null || true
cp www/admin/css/*.css "$SOURCE_DIR/www/admin/css/" 2>/dev/null || true
cp www/admin/index.html "$SOURCE_DIR/www/admin/" 2>/dev/null || true
mkdir -p "$SOURCE_DIR/www/modules"
cp www/modules/*.js "$SOURCE_DIR/www/modules/" 2>/dev/null || true

# ── 제출 방식별 처리 ──
if [ "$SUBMIT_MODE" = "partial" ]; then
    log_info "핵심 알고리즘 마스킹 처리 중..."

    # ── 마스킹 대상 정의 ──
    # [HIGH] 게이미피케이션 핵심 로직 (app.js 내 레벨업/경험치/스트릭/보상)
    # [HIGH] 운동 계산 공식 커스텀 계수 (exercise-calc.js)
    # [MEDIUM] 이미지 스크리닝 임계값 (functions/index.js)

    MASKING_NOTICE="/* ================================================================
 * [영업비밀 보호] 이 영역의 코드는 저작권 등록 시 마스킹 처리되었습니다.
 * 마스킹 사유: 핵심 알고리즘 및 독자적 수치 계수 보호
 * 원본 코드는 비공개 봉인본에 포함되어 있으며, 분쟁 시 개봉됩니다.
 * ================================================================ */"

    # app.js - 경험치/레벨업 관련 함수 마스킹
    if [ -f "$SOURCE_DIR/app.js" ]; then
        # calcXP, addXP, levelUp 등 경험치 계산 로직 마스킹
        sed -i -E "/function\s+(calcXP|calcExpNeeded|addXP|levelUp|calcLevelReward|calcStreakBonus|getStreakMultiplier)/,/^    \}|^  \}|^\}/ {
            /function\s+(calcXP|calcExpNeeded|addXP|levelUp|calcLevelReward|calcStreakBonus|getStreakMultiplier)/! {
                /^    \}|^  \}|^\}/! s/.*/    \/\/ [MASKED - 영업비밀 보호]/
            }
        }" "$SOURCE_DIR/app.js" 2>/dev/null || true
        log_ok "app.js 핵심 로직 마스킹 완료"
    fi

    # exercise-calc.js - VO2max 계수, VDOT 공식 마스킹
    if [ -f "$SOURCE_DIR/www/modules/exercise-calc.js" ]; then
        # 독자적 계수를 [MASKED]로 치환
        sed -i \
            -e 's/0\.182258/[MASKED_COEFF]/g' \
            -e 's/0\.000104/[MASKED_COEFF]/g' \
            -e 's/0\.1894393/[MASKED_COEFF]/g' \
            -e 's/0\.012778/[MASKED_COEFF]/g' \
            -e 's/0\.2989558/[MASKED_COEFF]/g' \
            -e 's/0\.1932605/[MASKED_COEFF]/g' \
            -e 's/2\.67123/[MASKED_COEFF]/g' \
            "$SOURCE_DIR/www/modules/exercise-calc.js" 2>/dev/null || true
        log_ok "exercise-calc.js 계산 계수 마스킹 완료"
    fi

    # functions/index.js - 스크리닝 임계값 마스킹
    if [ -f "$SOURCE_DIR/functions/index.js" ]; then
        sed -i \
            -e 's/> 0\.80/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.90/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.30/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.85/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.65/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.35/> [MASKED_THRESHOLD]/g' \
            -e 's/> 0\.15/> [MASKED_THRESHOLD]/g' \
            -e 's/>= 5/>= [MASKED_SEVERITY]/g' \
            -e 's/>= 4/>= [MASKED_SEVERITY]/g' \
            -e 's/>= 2/>= [MASKED_SEVERITY]/g' \
            -e 's/>= 1/>= [MASKED_SEVERITY]/g' \
            "$SOURCE_DIR/functions/index.js" 2>/dev/null || true
        log_ok "functions/index.js 임계값 마스킹 완료"
    fi

    # 마스킹 목록 문서 생성
    cat > "$DOC_DIR/마스킹_목록.txt" << MASKEOF
================================================================
마스킹 처리 목록
================================================================
저작물: ${APP_NAME} v${VERSION}
제출 방식: 일부 공개 (핵심 알고리즘 마스킹)
생성일: $(date +'%Y-%m-%d')

본 문서는 저작권 등록 시 영업비밀 보호를 위해 마스킹 처리된
코드 영역을 기록합니다.

================================================================
마스킹 대상 및 사유
================================================================

[위험도: HIGH] 게이미피케이션 핵심 알고리즘
  파일: app.js
  대상: 경험치 계산, 레벨업 공식, 스트릭 보너스, 보상 시스템
  사유: 앱의 핵심 차별화 요소이며, 게임 밸런스에 직결되는
       독자적 수치 체계로 영업비밀에 해당

[위험도: HIGH] 운동 과학 계산 계수
  파일: www/modules/exercise-calc.js
  대상: VO2max 계산 계수, VDOT 공식 파라미터, 운동 강도 구간
  사유: 커스터마이징된 운동 과학 공식의 독자적 계수값으로
       경쟁 서비스 대비 차별화 핵심 요소

[위험도: MEDIUM] 콘텐츠 스크리닝 임계값
  파일: functions/index.js
  대상: NSFW 감지 임계값, Azure Content Safety 심각도 매핑
  사유: 콘텐츠 필터링 정확도를 결정하는 튜닝 파라미터로
       서비스 품질에 직접적 영향

================================================================
마스킹 방법
================================================================

- 함수 본문: 내부 코드를 "// [MASKED - 영업비밀 보호]"로 치환
- 수치 계수: 구체적 값을 "[MASKED_COEFF]"로 치환
- 임계값:    구체적 값을 "[MASKED_THRESHOLD]"로 치환
- 심각도:    구체적 값을 "[MASKED_SEVERITY]"로 치환

※ 원본 코드는 비공개 봉인본에 별도 보관됩니다.
※ 마스킹은 저작물의 존재와 구조를 증명하면서도
  핵심 영업비밀을 보호하기 위한 조치입니다.
================================================================
MASKEOF
    log_ok "마스킹 목록 문서 생성 완료"
fi

# 소스코드 ZIP 생성 (공개용)
cd "$OUTPUT_DIR"
zip -r "01_소스코드_${APP_NAME// /_}_v${VERSION}.zip" 01_소스코드/ > /dev/null
SOURCE_ZIP_SIZE=$(du -h "01_소스코드_${APP_NAME// /_}_v${VERSION}.zip" | cut -f1)
log_ok "소스코드 ZIP (공개용): ${SOURCE_ZIP_SIZE}"

# ── 비공개 봉인 처리 ──
if [ "$SUBMIT_MODE" = "sealed" ] || [ "$SUBMIT_MODE" = "partial" ]; then
    log_info "비공개 봉인본 생성 중..."

    SEALED_DIR="${OUTPUT_DIR}/04_비공개봉인"
    mkdir -p "$SEALED_DIR"

    # 원본 소스코드 (마스킹 없는 원본) 복사
    SEALED_SOURCE="${SEALED_DIR}/원본_소스코드"
    mkdir -p "$SEALED_SOURCE"
    for f in "${SOURCE_FILES[@]}"; do
        [ -f "$PROJECT_DIR/$f" ] && cp "$PROJECT_DIR/$f" "$SEALED_SOURCE/"
    done
    cp -r "$PROJECT_DIR/native-plugins/" "$SEALED_SOURCE/native-plugins/" 2>/dev/null || true
    mkdir -p "$SEALED_SOURCE/functions"
    cp "$PROJECT_DIR/functions/index.js" "$SEALED_SOURCE/functions/" 2>/dev/null || true
    mkdir -p "$SEALED_SOURCE/www/modules"
    cp "$PROJECT_DIR/www/modules/exercise-calc.js" "$SEALED_SOURCE/www/modules/" 2>/dev/null || true

    # SHA256 해시 생성 (무결성 검증용)
    {
        echo "================================================================"
        echo "비공개 봉인본 SHA256 해시 목록"
        echo "================================================================"
        echo "생성일: $(date +'%Y-%m-%d %H:%M:%S')"
        echo "용도: 봉인 해제 시 원본 무결성 검증"
        echo ""
        find "$SEALED_SOURCE" -type f | sort | while read -r f; do
            sha256sum "$f" | sed "s|$SEALED_SOURCE/||"
        done
    } > "$SEALED_DIR/SHA256_해시목록.txt"

    # 봉인 안내문
    cat > "$SEALED_DIR/봉인_안내문.txt" << SEALEOF
================================================================
비공개 봉인 안내문
================================================================

본 폴더에 포함된 소스코드는 저작권법 제53조에 의거하여
비공개 봉인 형태로 제출됩니다.

봉인 조건:
  - 저작권 분쟁 발생 시 한국저작권위원회의 요청에 의해서만 개봉
  - 개봉 시 SHA256 해시를 통해 원본 무결성 검증

저작물 정보:
  저작물명:   ${APP_NAME}
  버전:       v${VERSION}
  저작권자:   ${COMPANY}
  $([ -n "$AUTHOR" ] && echo "저작자:     ${AUTHOR}")
  봉인일:     $(date +'%Y년 %m월 %d일')

================================================================
SEALEOF

    # 봉인 ZIP (비밀번호 보호)
    cd "$SEALED_DIR"
    SEAL_PASS="CROS-${COMPANY// /-}-$(date +%Y%m%d)"
    zip -r -P "$SEAL_PASS" "../04_비공개봉인_${APP_NAME// /_}_v${VERSION}.zip" . > /dev/null
    cd "$OUTPUT_DIR"
    rm -rf "$SEALED_DIR"  # 원본 폴더 삭제 (ZIP만 유지)

    log_ok "비공개 봉인본 생성 완료 (비밀번호 보호)"
    log_warn "봉인 비밀번호: ${SEAL_PASS}"
    log_warn "이 비밀번호는 안전한 곳에 별도 보관하세요!"
fi

cd "$PROJECT_DIR"

# ============================================================
# 2. 프로그램 설명서 생성
# ============================================================
log_info "[2/4] 프로그램 설명서 생성 중..."

cat > "$DOC_DIR/프로그램_설명서.txt" << DOCEOF
================================================================
프로그램 설명서
================================================================
저작물 명칭: ${APP_NAME} 모바일 애플리케이션
패키지 ID:  ${PACKAGE_ID}
버전:       v${VERSION}
저작권자:   ${COMPANY}
$([ -n "$AUTHOR" ] && echo "저작자:     ${AUTHOR}")
작성일:     $(date +"%Y년 %m월 %d일")

================================================================
1. 프로그램 개요
================================================================

${APP_NAME}은 일상의 자기계발 활동을 게임화(Gamification)하여
사용자의 지속적인 성장을 돕는 모바일 애플리케이션입니다.

- 플랫폼: Android (Google Play Store 배포)
- 개발 방식: 하이브리드 앱 (웹 기술 + 네이티브 브릿지)
- 프레임워크: Capacitor 6.x
- 백엔드: Firebase (Firestore, Cloud Functions, Cloud Storage)

================================================================
2. 주요 기능
================================================================

2-1. 사용자 시스템
  - 회원가입/로그인 (Google OAuth, 이메일/비밀번호)
  - 사용자 프로필 관리
  - 레벨 및 경험치 시스템

2-2. 자기계발 추적
  - 일일 미션 및 퀘스트 시스템
  - 스트릭(연속 달성) 추적
  - 운동 기록 (달리기, 사이클링 등 GPS 기반)
  - 독서 기록 (ISBN 바코드 스캔 - OCR)

2-3. 소셜 기능
  - 릴스(Reels) - 사진/텍스트 공유
  - 레이드(Raid) - 그룹 챌린지
  - 랭킹 시스템

2-4. 관리자 시스템
  - 관리자 대시보드 (사용자 분석, 콘텐츠 심사)
  - 자동 이미지 스크리닝 (NSFW 감지)
  - 신고 관리 시스템

2-5. 기타
  - 푸시 알림 (Firebase Cloud Messaging)
  - 보상형 광고 (Google AdMob)
  - 다국어 지원 (한국어/영어/일본어)
  - PWA (Progressive Web App) 지원

================================================================
3. 기술 아키텍처
================================================================

3-1. 프론트엔드 (클라이언트)
  ┌─────────────────────────────────────────┐
  │  app.html (앱 셸)                        │
  │  ├── app.js (핵심 로직, ~15,000줄)       │
  │  ├── data.js (다국어 데이터)              │
  │  ├── style.css (UI 스타일)               │
  │  ├── logger.js (자동 로깅)               │
  │  └── sw.js (서비스 워커, 오프라인)        │
  └─────────────────────────────────────────┘

3-2. 네이티브 플러그인 (Android/Java)
  - AppSettingsPlugin: 앱 설정 연동
  - GoogleFitPlugin: Google Fit 데이터 연동
  - HealthConnectPlugin: Health Connect API
  - FCMPlugin: 네이티브 푸시 알림
  - NativeAdPlugin: 네이티브 광고

3-3. 백엔드 (Firebase Cloud Functions)
  - 이미지 콘텐츠 심사 (NSFWJS + Azure Content Safety)
  - 사용자 관리 기능
  - 예약 작업 (스케줄러)

3-4. 데이터베이스 (Firestore)
  - 사용자 데이터, 미션, 릴스, 레이드 등
  - 보안 규칙 기반 접근 제어

================================================================
4. 실행 환경
================================================================

4-1. 최소 요구사항
  - Android 8.0 (API 26) 이상
  - Google Play Services 포함 기기
  - 인터넷 연결 필수

4-2. 개발 환경
  - Node.js 20.x
  - npm 10.x
  - Java 17 (Android 빌드)
  - Android SDK (API 34)
  - Firebase CLI

4-3. 빌드 방법
  npm install
  npm run sync
  npm run build-apk

================================================================
5. 소스코드 구성
================================================================

프로젝트 구조:
  /
  ├── app.js          - 핵심 애플리케이션 로직
  ├── app.html        - 앱 메인 HTML
  ├── data.js         - 다국어 리소스
  ├── style.css       - 스타일시트
  ├── logger.js       - 자동 로깅 시스템
  ├── sw.js           - 서비스 워커
  ├── native-plugins/ - Android 네이티브 플러그인 (Java)
  ├── functions/      - Firebase Cloud Functions
  ├── www/admin/      - 관리자 대시보드
  ├── www/modules/    - 기능 모듈
  ├── scripts/        - 빌드/배포 스크립트
  └── res/            - 앱 리소스 (아이콘, 스플래시)

================================================================
6. 저작권 표시
================================================================

© $(date +"%Y") ${COMPANY}. All rights reserved.
본 프로그램의 소스코드, 디자인, 콘텐츠에 대한 모든 저작권은
${COMPANY}에 있으며, 무단 복제·배포를 금합니다.

================================================================
DOCEOF

log_ok "프로그램 설명서 생성 완료"

# ============================================================
# 3. 소스코드 목록 및 통계
# ============================================================
log_info "[3/4] 소스코드 목록 및 통계 생성 중..."

{
    echo "================================================================"
    echo "소스코드 파일 목록 및 라인 수"
    echo "================================================================"
    echo "저작물: ${APP_NAME} v${VERSION}"
    echo "생성일: $(date +'%Y-%m-%d %H:%M:%S')"
    echo "================================================================"
    echo ""
    echo "※ 본 목록은 자체 저작 코드만 포함합니다."
    echo "   (오픈소스 라이브러리, node_modules, 제3자 SDK 제외)"
    echo ""
    echo "----------------------------------------------------------------"
    printf "%-60s %8s\n" "파일 경로" "라인 수"
    echo "----------------------------------------------------------------"

    TOTAL_LINES=0
    TOTAL_FILES=0

    # 자체 저작 소스 파일 검색
    while IFS= read -r file; do
        # 제외 대상 필터링
        if echo "$file" | grep -qE "(node_modules|\.min\.|tesseract|android/|\.firebase|backups/)"; then
            continue
        fi
        if [ -f "$file" ]; then
            LINES=$(wc -l < "$file")
            REL_PATH="${file#$PROJECT_DIR/}"
            printf "%-60s %8d\n" "$REL_PATH" "$LINES"
            TOTAL_LINES=$((TOTAL_LINES + LINES))
            TOTAL_FILES=$((TOTAL_FILES + 1))
        fi
    done < <(find "$PROJECT_DIR" \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.java" -o -name "*.sh" -o -name "*.json" \) \
        -not -path "*/node_modules/*" \
        -not -path "*/.git/*" \
        -not -path "*/android/*" \
        -not -path "*/backups/*" \
        -not -path "*/.firebase/*" \
        -not -path "*/tesseract-core/*" \
        -not -path "*/tesseract-lang/*" \
        -not -name "*.min.*" \
        -not -name "tesseract*" \
        -not -name "worker.min.js" \
        -not -name "firebase-config.js" \
        -not -name "google-services.json" | sort)

    echo "----------------------------------------------------------------"
    printf "%-60s %8d\n" "합계 (${TOTAL_FILES}개 파일)" "$TOTAL_LINES"
    echo "================================================================"
} > "$DOC_DIR/소스코드_목록.txt"

log_ok "소스코드 목록 생성 완료 (${TOTAL_FILES}개 파일, ${TOTAL_LINES}줄)"

# ============================================================
# 4. Git 이력 증빙 (창작일·창작과정 입증)
# ============================================================
log_info "[4/4] Git 이력 증빙 자료 생성 중..."

FIRST_COMMIT_DATE=$(git log --format="%ai" --reverse | head -1 || true)
LATEST_COMMIT_DATE=$(git log --format="%ai" -1)
TOTAL_COMMITS=$(git rev-list --all --count)

{
    echo "================================================================"
    echo "Git 커밋 이력 요약 (창작과정 증빙)"
    echo "================================================================"
    echo "저작물: ${APP_NAME} v${VERSION}"
    echo "저장소: $(git remote get-url origin 2>/dev/null || echo 'N/A')"
    echo "생성일: $(date +'%Y-%m-%d %H:%M:%S')"
    echo ""
    echo "── 기본 정보 ──"
    echo "최초 커밋일:    ${FIRST_COMMIT_DATE}"
    echo "최종 커밋일:    ${LATEST_COMMIT_DATE}"
    echo "총 커밋 수:     ${TOTAL_COMMITS}개"
    echo "브랜치 수:      $(git branch -a 2>/dev/null | wc -l | tr -d ' ')개"
    echo "태그 수:        $(git tag 2>/dev/null | wc -l | tr -d ' ')개"
    echo ""
    echo "※ 최초 커밋일은 창작연월일 입증의 핵심 근거가 됩니다."
    echo "※ 커밋 히스토리는 창작 과정의 연속성을 증명합니다."
    echo ""
    echo "================================================================"
    echo "전체 커밋 이력 (시간순)"
    echo "================================================================"
    echo ""
    git log --format="%h | %ai | %an | %s" --reverse
    echo ""
    echo "================================================================"
    echo "월별 커밋 통계"
    echo "================================================================"
    echo ""
    git log --format="%ai" 2>/dev/null | cut -d'-' -f1-2 | sort | uniq -c | sort -k2
    echo ""
    echo "================================================================"
} > "$EVIDENCE_DIR/Git_커밋이력.txt"

# Git 커밋 로그를 별도 상세 파일로도 생성
git log --stat --reverse > "$EVIDENCE_DIR/Git_상세이력.txt" 2>/dev/null || true

log_ok "Git 이력 증빙 생성 완료 (총 ${TOTAL_COMMITS}개 커밋)"

# ============================================================
# 최종 패키지 ZIP 생성
# ============================================================
echo ""
log_info "최종 CROS 제출 패키지 생성 중..."

cd "$PROJECT_DIR/backups"
PACKAGE_NAME="CROS_제출_${APP_NAME// /_}_v${VERSION}_${TIMESTAMP}"
zip -r "${PACKAGE_NAME}.zip" "cros_${TIMESTAMP}_v${VERSION}/" > /dev/null

PACKAGE_SIZE=$(du -h "${PACKAGE_NAME}.zip" | cut -f1)

echo ""
log_ok "=========================================="
log_ok " CROS 제출 패키지 생성 완료"
log_ok "=========================================="
echo ""
echo "  패키지: backups/${PACKAGE_NAME}.zip (${PACKAGE_SIZE})"
echo ""
echo "  포함 내용:"
echo "  ├── 01_소스코드/          자체 저작 소스코드 (오픈소스 제외)"
echo "  │   └── *.zip             소스코드 압축 파일"
echo "  ├── 02_프로그램설명서/"
echo "  │   ├── 프로그램_설명서.txt    기능·구조·실행환경 설명"
echo "  │   └── 소스코드_목록.txt      파일별 라인 수 통계"
echo "  ├── 03_창작증빙자료/"
echo "  │   ├── Git_커밋이력.txt       커밋 로그 (창작일 입증)"
echo "  │   └── Git_상세이력.txt       변경 파일 포함 상세 이력"
if [ "$SUBMIT_MODE" = "partial" ]; then
echo "  │   └── 마스킹_목록.txt        마스킹 처리 대상 및 사유"
echo "  └── 04_비공개봉인_*.zip    원본 소스코드 (비밀번호 보호)"
elif [ "$SUBMIT_MODE" = "sealed" ]; then
echo "  └── 04_비공개봉인_*.zip    원본 소스코드 (비밀번호 보호)"
else
echo "  └── (전체 공개 - 봉인 없음)"
fi
echo ""
echo -e "${YELLOW}[주의]${NC} 추가 준비 필요:"
echo "  1. 주요 화면 스크린샷 (5~10장) → 02_프로그램설명서/에 추가"
echo "  2. 저작자 신원 확인 서류 (사업자등록증 또는 신분증)"
echo "  3. CROS(cros.or.kr) 온라인 신청서 별도 작성"
echo ""
