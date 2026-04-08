#!/bin/bash
# ============================================================
# version-bump.sh — VERSION 파일 기준으로 모든 버전 참조를 동기화
#
# 사용법:
#   bash scripts/version-bump.sh [new_version]
#
# new_version을 지정하면 VERSION 파일을 먼저 업데이트한 뒤 동기화.
# 생략하면 현재 VERSION 파일의 값으로 동기화만 수행.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION_FILE="$PROJECT_ROOT/VERSION"

# VERSION 파일 존재 확인
if [ ! -f "$VERSION_FILE" ]; then
  echo "❌ VERSION 파일을 찾을 수 없습니다: $VERSION_FILE"
  exit 1
fi

# 새 버전이 인자로 전달된 경우 VERSION 파일 업데이트
if [ -n "${1:-}" ]; then
  NEW_VERSION="$1"
  # 시맨틱 버전 형식 검증
  if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo "❌ 잘못된 버전 형식: $NEW_VERSION"
    echo "   올바른 형식: X.Y.Z 또는 X.Y.Z-suffix (예: 1.2.3, 1.0.0-beta.1)"
    exit 1
  fi
  echo "$NEW_VERSION" > "$VERSION_FILE"
  echo "✅ VERSION 파일 업데이트: $NEW_VERSION"
fi

VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
echo "📦 현재 버전: $VERSION"
echo ""

# 1. package.json (루트)
PACKAGE_JSON="$PROJECT_ROOT/package.json"
if [ -f "$PACKAGE_JSON" ]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PACKAGE_JSON"
  echo "  ✅ package.json → $VERSION"
fi

# 2. functions/package.json
FUNCTIONS_PACKAGE="$PROJECT_ROOT/functions/package.json"
if [ -f "$FUNCTIONS_PACKAGE" ]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$FUNCTIONS_PACKAGE"
  echo "  ✅ functions/package.json → $VERSION"
fi

# 3. Service Worker 캐시 버전 (sw.js)
SW_JS="$PROJECT_ROOT/sw.js"
if [ -f "$SW_JS" ]; then
  sed -i "s/const CACHE_VERSION = 'levelup-v[^']*'/const CACHE_VERSION = 'levelup-v$VERSION'/" "$SW_JS"
  echo "  ✅ sw.js CACHE_VERSION → levelup-v$VERSION"
fi

# 4. www/sw.js (동기화 대상)
WWW_SW_JS="$PROJECT_ROOT/www/sw.js"
if [ -f "$WWW_SW_JS" ]; then
  sed -i "s/const CACHE_VERSION = 'levelup-v[^']*'/const CACHE_VERSION = 'levelup-v$VERSION'/" "$WWW_SW_JS"
  echo "  ✅ www/sw.js CACHE_VERSION → levelup-v$VERSION"
fi

# 5. app.js APP_VERSION
APP_JS="$PROJECT_ROOT/app.js"
if [ -f "$APP_JS" ]; then
  sed -i "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$VERSION'/" "$APP_JS"
  echo "  ✅ app.js APP_VERSION → $VERSION"
fi

# 6. www/app.js APP_VERSION (동기화 대상)
WWW_APP_JS="$PROJECT_ROOT/www/app.js"
if [ -f "$WWW_APP_JS" ]; then
  sed -i "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$VERSION'/" "$WWW_APP_JS"
  echo "  ✅ www/app.js APP_VERSION → $VERSION"
fi

echo ""
echo "🎉 모든 버전 참조가 v$VERSION 으로 동기화되었습니다."
