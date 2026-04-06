#!/bin/bash
# ============================================================
# GitHub 백업 및 소스코드 압축 스크립트
# LEVEL UP: REBOOT 프로젝트용
# ============================================================
# 사용법:
#   bash scripts/backup.sh              # 기본 백업 (tar.gz)
#   bash scripts/backup.sh --zip        # ZIP 형식 백업
#   bash scripts/backup.sh --full       # 전체 백업 (.git 포함)
#   bash scripts/backup.sh --firebase   # Firebase 설정 포함 백업
# ============================================================

set -euo pipefail

# ── 설정 ──
PROJECT_NAME="levelup-reboot"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
VERSION=$(cat "${PROJECT_DIR}/VERSION" 2>/dev/null || echo "unknown")

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── 옵션 파싱 ──
FORMAT="tar.gz"
INCLUDE_GIT=false
INCLUDE_FIREBASE=false

for arg in "$@"; do
    case $arg in
        --zip)      FORMAT="zip" ;;
        --full)     INCLUDE_GIT=true ;;
        --firebase) INCLUDE_FIREBASE=true ;;
        --help|-h)
            echo "사용법: bash scripts/backup.sh [옵션]"
            echo ""
            echo "옵션:"
            echo "  --zip        ZIP 형식으로 압축 (기본: tar.gz)"
            echo "  --full       .git 디렉토리 포함 전체 백업"
            echo "  --firebase   Firebase 설정 파일 포함"
            echo "  --help, -h   도움말 표시"
            exit 0
            ;;
        *)
            log_error "알 수 없는 옵션: $arg"
            exit 1
            ;;
    esac
done

# ── 백업 디렉토리 생성 ──
mkdir -p "$BACKUP_DIR"

# ── 제외 패턴 설정 ──
EXCLUDE_PATTERNS=(
    "node_modules"
    "android"
    "backups"
    ".firebase"
    "*.log"
)

if [ "$INCLUDE_GIT" = false ]; then
    EXCLUDE_PATTERNS+=(".git")
fi

if [ "$INCLUDE_FIREBASE" = false ]; then
    EXCLUDE_PATTERNS+=("functions/.env" "firebase-config.js" "www/firebase-config.js" "google-services.json")
fi

# ── 백업 파일명 ──
BACKUP_NAME="${PROJECT_NAME}_v${VERSION}_${TIMESTAMP}"

log_info "=========================================="
log_info " GitHub 백업 및 소스코드 압축"
log_info "=========================================="
log_info "프로젝트: ${PROJECT_NAME} v${VERSION}"
log_info "형식: ${FORMAT}"
log_info ".git 포함: ${INCLUDE_GIT}"
log_info "Firebase 설정 포함: ${INCLUDE_FIREBASE}"
echo ""

# ── Git 상태 표시 ──
cd "$PROJECT_DIR"
if command -v git &> /dev/null && [ -d ".git" ]; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    DIRTY=$(git status --porcelain 2>/dev/null | wc -l)

    log_info "Git 브랜치: ${BRANCH}"
    log_info "최신 커밋: ${COMMIT}"
    if [ "$DIRTY" -gt 0 ]; then
        log_warn "커밋되지 않은 변경사항 ${DIRTY}개 있음"
    fi
    echo ""
fi

# ── 압축 실행 ──
if [ "$FORMAT" = "zip" ]; then
    BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.zip"

    EXCLUDE_ARGS=""
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
        EXCLUDE_ARGS="${EXCLUDE_ARGS} -x '${pattern}/*' -x '${pattern}'"
    done

    log_info "ZIP 압축 중..."
    cd "$PROJECT_DIR"
    eval zip -r "$BACKUP_FILE" . $EXCLUDE_ARGS -x './backups/*' 2>/dev/null
else
    BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

    EXCLUDE_ARGS=""
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
        EXCLUDE_ARGS="${EXCLUDE_ARGS} --exclude=${pattern}"
    done

    log_info "tar.gz 압축 중..."
    cd "$(dirname "$PROJECT_DIR")"
    eval tar czf "$BACKUP_FILE" $EXCLUDE_ARGS --exclude=backups "$(basename "$PROJECT_DIR")"
fi

# ── 결과 표시 ──
if [ -f "$BACKUP_FILE" ]; then
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo ""
    log_ok "백업 완료!"
    log_ok "파일: ${BACKUP_FILE}"
    log_ok "크기: ${FILE_SIZE}"
    echo ""

    # ── 백업 목록 표시 ──
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/${PROJECT_NAME}_* 2>/dev/null | wc -l)
    if [ "$BACKUP_COUNT" -gt 1 ]; then
        log_info "기존 백업 파일 (${BACKUP_COUNT}개):"
        ls -lh "$BACKUP_DIR"/${PROJECT_NAME}_* 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
    fi

    # ── 오래된 백업 정리 안내 ──
    if [ "$BACKUP_COUNT" -gt 5 ]; then
        echo ""
        log_warn "백업이 5개 이상입니다. 오래된 백업 정리를 권장합니다:"
        log_warn "  bash scripts/backup.sh --cleanup"
    fi
else
    log_error "백업 실패!"
    exit 1
fi
