#!/bin/bash
# sync-www.sh — 루트 ↔ www/ 양방향 파일 동기화
# git 커밋 타임스탬프 기반으로 최신 수정사항을 판별하여 양방향 동기화합니다.
# 사용법: bash sync-www.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WWW_DIR="$SCRIPT_DIR/www"

# 동기화 대상 파일 목록 (루트명:www명)
FILES=(
  app.html
  app.js
  data.js
  logger.js
  index.html
  style.css
  intro-style.css
  firebase-messaging-sw.js
  manifest.json
  push-test.html
  sw.js
)

# git 커밋 타임스탬프 조회 (없으면 0 반환)
get_git_ts() {
  local file="$1"
  local ts
  ts=$(git log -1 --format=%ct -- "$file" 2>/dev/null || true)
  echo "${ts:-0}"
}

mkdir -p "$WWW_DIR"

ROOT_UPDATED=0
WWW_UPDATED=0
SKIPPED=0

# 파일 단위 양방향 동기화 함수
# 인자: $1=SRC경로 $2=DST경로 $3=SRC git경로 $4=DST git경로 $5=표시명
sync_file() {
  local SRC="$1" DST="$2" SRC_GIT="$3" DST_GIT="$4" LABEL="$5"

  # Case 1: 루트만 존재
  if [ -f "$SRC" ] && [ ! -f "$DST" ]; then
    cp "$SRC" "$DST"
    echo "  ROOT→WWW  $LABEL (www에 없음)"
    WWW_UPDATED=$((WWW_UPDATED + 1))
    return
  fi

  # Case 2: www만 존재
  if [ ! -f "$SRC" ] && [ -f "$DST" ]; then
    cp "$DST" "$SRC"
    echo "  WWW→ROOT  $LABEL (루트에 없음)"
    ROOT_UPDATED=$((ROOT_UPDATED + 1))
    return
  fi

  # Case 3: 양쪽 모두 없음
  if [ ! -f "$SRC" ] && [ ! -f "$DST" ]; then
    echo "  SKIP  $LABEL (양쪽 모두 없음)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  # Case 4: 양쪽 동일
  if cmp -s "$SRC" "$DST"; then
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  # Case 5: 양쪽 다름 — git 타임스탬프로 최신 판별
  local ROOT_TS WWW_TS
  ROOT_TS=$(get_git_ts "$SRC_GIT")
  WWW_TS=$(get_git_ts "$DST_GIT")

  if [ "$ROOT_TS" -gt "$WWW_TS" ]; then
    cp "$SRC" "$DST"
    echo "  ROOT→WWW  $LABEL (루트가 최신: root=$ROOT_TS > www=$WWW_TS)"
    WWW_UPDATED=$((WWW_UPDATED + 1))
  elif [ "$WWW_TS" -gt "$ROOT_TS" ]; then
    cp "$DST" "$SRC"
    echo "  WWW→ROOT  $LABEL (www가 최신: www=$WWW_TS > root=$ROOT_TS)"
    ROOT_UPDATED=$((ROOT_UPDATED + 1))
  else
    # 타임스탬프 동일 — 파일 크기 비교, 동일하면 루트 우선
    local ROOT_SIZE WWW_SIZE
    ROOT_SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
    WWW_SIZE=$(stat -c%s "$DST" 2>/dev/null || stat -f%z "$DST")
    if [ "$WWW_SIZE" -gt "$ROOT_SIZE" ]; then
      cp "$DST" "$SRC"
      echo "  WWW→ROOT  $LABEL (동일 타임스탬프, www가 더 큼: $WWW_SIZE > $ROOT_SIZE)"
      ROOT_UPDATED=$((ROOT_UPDATED + 1))
    else
      cp "$SRC" "$DST"
      echo "  ROOT→WWW  $LABEL (동일 타임스탬프, 루트 우선)"
      WWW_UPDATED=$((WWW_UPDATED + 1))
    fi
  fi
}

for f in "${FILES[@]}"; do
  sync_file "$SCRIPT_DIR/$f" "$WWW_DIR/$f" "$f" "www/$f" "$f"
done

# modules/ 디렉토리 양방향 동기화
mkdir -p "$SCRIPT_DIR/modules" "$WWW_DIR/modules"
MODULE_FILES=$( (ls "$SCRIPT_DIR/modules/" 2>/dev/null; ls "$WWW_DIR/modules/" 2>/dev/null) | sort -u )

for mf in $MODULE_FILES; do
  [ -f "$SCRIPT_DIR/modules/$mf" ] || [ -f "$WWW_DIR/modules/$mf" ] || continue
  sync_file "$SCRIPT_DIR/modules/$mf" "$WWW_DIR/modules/$mf" \
            "modules/$mf" "www/modules/$mf" "modules/$mf"
done

echo ""
echo "완료: www/ ${WWW_UPDATED}개 갱신, 루트 ${ROOT_UPDATED}개 갱신, ${SKIPPED}개 이미 동일"
