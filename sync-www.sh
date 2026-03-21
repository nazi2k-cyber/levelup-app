#!/bin/bash
# sync-www.sh — 루트 웹 파일을 www/ 폴더로 동기화
# 루트가 Single Source of Truth. 이 스크립트는 루트 → www/ 단방향 복사를 수행합니다.
# 사용법: bash sync-www.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WWW_DIR="$SCRIPT_DIR/www"

# 동기화 대상 파일 목록
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

CHANGED=0
SYNCED=0

for f in "${FILES[@]}"; do
  SRC="$SCRIPT_DIR/$f"
  DST="$WWW_DIR/$f"

  if [ ! -f "$SRC" ]; then
    echo "  SKIP  $f (루트에 없음)"
    continue
  fi

  if [ -f "$DST" ] && cmp -s "$SRC" "$DST"; then
    continue  # 이미 동일
  fi

  cp "$SRC" "$DST"
  echo "  SYNC  $f"
  CHANGED=$((CHANGED + 1))
done

SYNCED=$((${#FILES[@]} - CHANGED))
echo ""
echo "완료: ${CHANGED}개 파일 동기화됨, ${SYNCED}개 이미 최신"
