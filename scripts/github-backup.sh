#!/bin/bash
# ============================================================
# GitHub 원격 저장소 백업 스크립트
# 모든 브랜치, 태그, 히스토리를 포함한 완전한 Git 백업
# ============================================================
# 사용법:
#   bash scripts/github-backup.sh                    # 현재 저장소 미러 백업
#   bash scripts/github-backup.sh --bundle           # Git bundle 형식
#   bash scripts/github-backup.sh --clone <repo-url> # 원격 저장소 클론 백업
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

mkdir -p "$BACKUP_DIR"

MODE="mirror"
REPO_URL=""

for arg in "$@"; do
    case $arg in
        --bundle)  MODE="bundle" ;;
        --clone)   MODE="clone" ;;
        --help|-h)
            echo "사용법: bash scripts/github-backup.sh [옵션]"
            echo ""
            echo "옵션:"
            echo "  --bundle      Git bundle 형식으로 백업 (단일 파일)"
            echo "  --clone <url> 원격 저장소를 미러 클론"
            echo "  --help, -h    도움말"
            echo ""
            echo "── 방법별 비교 ──"
            echo ""
            echo "  미러(기본)  : .git 전체 복사. 가장 빠름, 로컬 전용"
            echo "  번들(bundle): 단일 .bundle 파일. USB/이메일 전송에 적합"
            echo "  클론(clone) : 원격 저장소의 완전한 미러 클론"
            exit 0
            ;;
        *)
            if [ "$MODE" = "clone" ] && [ -z "$REPO_URL" ]; then
                REPO_URL="$arg"
            fi
            ;;
    esac
done

cd "$PROJECT_DIR"

echo ""
log_info "=========================================="
log_info " GitHub 저장소 백업"
log_info "=========================================="
echo ""

case $MODE in
    mirror)
        # ── 방법 1: .git 디렉토리 복사 (가장 빠름) ──
        log_info "방법: Git 미러 복사"
        BACKUP_FILE="${BACKUP_DIR}/git-mirror_${TIMESTAMP}.tar.gz"

        log_info "Git 객체 압축 중..."
        git gc --aggressive --prune=now 2>/dev/null || true

        log_info ".git 디렉토리 압축 중..."
        tar czf "$BACKUP_FILE" .git

        FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log_ok "미러 백업 완료: ${BACKUP_FILE} (${FILE_SIZE})"
        echo ""
        log_info "복원 방법:"
        echo "  mkdir restored-project && cd restored-project"
        echo "  tar xzf ${BACKUP_FILE}"
        echo "  git checkout ."
        ;;

    bundle)
        # ── 방법 2: Git Bundle (이식 가능한 단일 파일) ──
        log_info "방법: Git Bundle"
        BACKUP_FILE="${BACKUP_DIR}/levelup-reboot_${TIMESTAMP}.bundle"

        log_info "모든 브랜치와 태그를 번들로 생성 중..."
        git bundle create "$BACKUP_FILE" --all

        # 번들 검증
        if git bundle verify "$BACKUP_FILE" &>/dev/null; then
            log_ok "번들 검증 통과"
        else
            log_error "번들 검증 실패!"
            exit 1
        fi

        FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log_ok "번들 백업 완료: ${BACKUP_FILE} (${FILE_SIZE})"
        echo ""
        log_info "복원 방법:"
        echo "  git clone ${BACKUP_FILE} restored-project"
        echo "  cd restored-project"
        echo "  git remote set-url origin <원래-GitHub-URL>"
        ;;

    clone)
        # ── 방법 3: 원격 저장소 미러 클론 ──
        if [ -z "$REPO_URL" ]; then
            REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
            if [ -z "$REPO_URL" ]; then
                log_error "저장소 URL을 지정하세요: bash scripts/github-backup.sh --clone <url>"
                exit 1
            fi
        fi

        log_info "방법: 미러 클론"
        log_info "원본: ${REPO_URL}"
        CLONE_DIR="${BACKUP_DIR}/mirror-clone_${TIMESTAMP}"

        git clone --mirror "$REPO_URL" "$CLONE_DIR"

        # tar.gz로 압축
        BACKUP_FILE="${BACKUP_DIR}/mirror-clone_${TIMESTAMP}.tar.gz"
        cd "$BACKUP_DIR"
        tar czf "mirror-clone_${TIMESTAMP}.tar.gz" "mirror-clone_${TIMESTAMP}"
        rm -rf "$CLONE_DIR"

        FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log_ok "미러 클론 백업 완료: ${BACKUP_FILE} (${FILE_SIZE})"
        echo ""
        log_info "복원 방법:"
        echo "  tar xzf mirror-clone_${TIMESTAMP}.tar.gz"
        echo "  git clone mirror-clone_${TIMESTAMP} restored-project"
        ;;
esac

echo ""
log_info "── 포함된 내용 ──"
echo "  브랜치: $(git branch -a 2>/dev/null | wc -l)개"
echo "  태그:   $(git tag 2>/dev/null | wc -l)개"
echo "  커밋:   $(git rev-list --all --count 2>/dev/null)개"
echo ""
