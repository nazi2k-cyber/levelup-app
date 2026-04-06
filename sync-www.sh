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

for f in "${FILES[@]}"; do
  SRC="$SCRIPT_DIR/$f"
  DST="$WWW_DIR/$f"

  # Case 1: 루트만 존재
  if [ -f "$SRC" ] && [ ! -f "$DST" ]; then
    cp "$SRC" "$DST"
    echo "  ROOT→WWW  $f (www에 없음)"
    WWW_UPDATED=$((WWW_UPDATED + 1))
    continue
  fi

  # Case 2: www만 존재
  if [ ! -f "$SRC" ] && [ -f "$DST" ]; then
    cp "$DST" "$SRC"
    echo "  WWW→ROOT  $f (루트에 없음)"
    ROOT_UPDATED=$((ROOT_UPDATED + 1))
    continue
  fi

  # Case 3: 양쪽 모두 없음
  if [ ! -f "$SRC" ] && [ ! -f "$DST" ]; then
    echo "  SKIP  $f (양쪽 모두 없음)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Case 4: 양쪽 동일
  if cmp -s "$SRC" "$DST"; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Case 5: 양쪽 다름 — git 타임스탬프로 최신 판별
  ROOT_TS=$(get_git_ts "$f")
  WWW_TS=$(get_git_ts "www/$f")

  if [ "$ROOT_TS" -gt "$WWW_TS" ]; then
    cp "$SRC" "$DST"
    echo "  ROOT→WWW  $f (루트가 최신: root=$ROOT_TS > www=$WWW_TS)"
    WWW_UPDATED=$((WWW_UPDATED + 1))
  elif [ "$WWW_TS" -gt "$ROOT_TS" ]; then
    cp "$DST" "$SRC"
    echo "  WWW→ROOT  $f (www가 최신: www=$WWW_TS > root=$ROOT_TS)"
    ROOT_UPDATED=$((ROOT_UPDATED + 1))
  else
    # 타임스탬프 동일 — 파일 크기 비교, 동일하면 루트 우선
    ROOT_SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
    WWW_SIZE=$(stat -c%s "$DST" 2>/dev/null || stat -f%z "$DST")
    if [ "$WWW_SIZE" -gt "$ROOT_SIZE" ]; then
      cp "$DST" "$SRC"
      echo "  WWW→ROOT  $f (동일 타임스탬프, www가 더 큼: $WWW_SIZE > $ROOT_SIZE)"
      ROOT_UPDATED=$((ROOT_UPDATED + 1))
    else
      cp "$SRC" "$DST"
      echo "  ROOT→WWW  $f (동일 타임스탬프, 루트 우선)"
      WWW_UPDATED=$((WWW_UPDATED + 1))
    fi
  fi
done

# modules/ 디렉토리 동기화
if [ -d "$SCRIPT_DIR/modules" ]; then
    mkdir -p "$WWW_DIR/modules"
    rsync -a --delete "$SCRIPT_DIR/modules/" "$WWW_DIR/modules/"
    echo "  SYNC modules/ 디렉토리 (root → www)"
elif [ -d "$WWW_DIR/modules" ]; then
    mkdir -p "$SCRIPT_DIR/modules"
    rsync -a --delete "$WWW_DIR/modules/" "$SCRIPT_DIR/modules/"
    echo "  SYNC modules/ (www → root)"
fi

echo ""
echo "완료: www/ ${WWW_UPDATED}개 갱신, 루트 ${ROOT_UPDATED}개 갱신, ${SKIPPED}개 이미 동일"
