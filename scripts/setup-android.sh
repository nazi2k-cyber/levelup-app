#!/bin/bash
# ============================================================
# setup-android.sh — Android 프로젝트 초기화 및 빌드 설정
#
# 사용법:
#   bash scripts/setup-android.sh
#
# 수행 작업:
#   1. android/ 디렉토리가 없으면 cap add android 실행
#   2. cap sync android 실행
#   3. variables.gradle → compileSdkVersion & targetSdkVersion = 35
#   4. build.gradle release → minifyEnabled true (ProGuard/R8 활성화)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
log_info "============================================"
log_info " Android 프로젝트 설정"
log_info " targetSdkVersion = 35 / ProGuard 활성화"
log_info "============================================"
echo ""

# ── 1. android 디렉토리 초기화 ──
if [ ! -d "$PROJECT_ROOT/android" ]; then
    log_info "android/ 디렉토리가 없습니다. cap add android 실행 중..."
    npx cap add android
    log_ok "android 프로젝트 생성 완료"
else
    log_info "android/ 디렉토리 확인됨"
fi

# ── 2. cap sync ──
log_info "cap sync android 실행 중..."
npx cap sync android
log_ok "cap sync 완료"


# ── 2.5 커스텀 네이티브 플러그인 동기화 ──
log_info "커스텀 네이티브 플러그인 동기화 중..."

PLUGIN_SRC_DIR="$PROJECT_ROOT/native-plugins"
PLUGIN_DST_DIR="$PROJECT_ROOT/android/app/src/main/java/com/levelup/reboot/plugins"
MAIN_ACTIVITY="$PROJECT_ROOT/android/app/src/main/java/com/levelup/reboot/MainActivity.java"

if [ -d "$PLUGIN_SRC_DIR" ]; then
    mkdir -p "$PLUGIN_DST_DIR"
    cp -f "$PLUGIN_SRC_DIR"/*.java "$PLUGIN_DST_DIR"/
    log_ok "커스텀 플러그인 Java 파일 복사 완료"
else
    log_warn "native-plugins/ 디렉토리를 찾지 못했습니다. 플러그인 복사를 건너뜁니다."
fi

if [ -f "$MAIN_ACTIVITY" ]; then
    python3 - "$MAIN_ACTIVITY" <<'PYEOF'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

imports = [
    'import com.levelup.reboot.plugins.AppSettingsPlugin;',
    'import com.levelup.reboot.plugins.ClipboardPlugin;',
    'import com.levelup.reboot.plugins.FCMPlugin;',
    'import com.levelup.reboot.plugins.GoogleFitPlugin;',
    'import com.levelup.reboot.plugins.HealthConnectPlugin;',
    'import com.levelup.reboot.plugins.NativeAdPlugin;',
]

registers = [
    '        registerPlugin(AppSettingsPlugin.class);',
    '        registerPlugin(ClipboardPlugin.class);',
    '        registerPlugin(FCMPlugin.class);',
    '        registerPlugin(GoogleFitPlugin.class);',
    '        registerPlugin(HealthConnectPlugin.class);',
    '        registerPlugin(NativeAdPlugin.class);',
]

# import 보강
for imp in imports:
    if imp not in text:
        text = text.replace(
            'import com.getcapacitor.BridgeActivity;\n',
            f'import com.getcapacitor.BridgeActivity;\n{imp}\n'
        )

# onCreate 블록 보강
if 'public void onCreate(Bundle savedInstanceState)' in text:
    for line in registers:
        if line not in text:
            marker = '        super.onCreate(savedInstanceState);\n'
            if marker in text:
                text = text.replace(marker, marker + line + '\n', 1)

path.write_text(text)
print('MainActivity plugin registration ensured')
PYEOF
    log_ok "MainActivity 플러그인 등록 확인 완료"
else
    log_warn "MainActivity.java 파일을 찾지 못했습니다: $MAIN_ACTIVITY"
fi

# ── 3. variables.gradle 패치 (targetSdkVersion = 35) ──
VARIABLES_GRADLE="$PROJECT_ROOT/android/variables.gradle"

if [ ! -f "$VARIABLES_GRADLE" ]; then
    log_error "variables.gradle 파일을 찾을 수 없습니다: $VARIABLES_GRADLE"
    exit 1
fi

log_info "variables.gradle 패치 중 (compileSdkVersion & targetSdkVersion → 35)..."

# compileSdkVersion
if grep -q "compileSdkVersion" "$VARIABLES_GRADLE"; then
    sed -i 's/compileSdkVersion = [0-9]\+/compileSdkVersion = 35/' "$VARIABLES_GRADLE"
    log_ok "compileSdkVersion = 35"
else
    log_warn "compileSdkVersion 항목을 찾지 못했습니다. 수동으로 확인하세요."
fi

# targetSdkVersion
if grep -q "targetSdkVersion" "$VARIABLES_GRADLE"; then
    sed -i 's/targetSdkVersion = [0-9]\+/targetSdkVersion = 35/' "$VARIABLES_GRADLE"
    log_ok "targetSdkVersion = 35"
else
    log_warn "targetSdkVersion 항목을 찾지 못했습니다. 수동으로 확인하세요."
fi

# ── 4. build.gradle release 블록에 ProGuard(R8) 활성화 ──
BUILD_GRADLE="$PROJECT_ROOT/android/app/build.gradle"

if [ ! -f "$BUILD_GRADLE" ]; then
    log_error "build.gradle 파일을 찾을 수 없습니다: $BUILD_GRADLE"
    exit 1
fi

log_info "build.gradle 패치 중 (release 빌드 ProGuard/R8 활성화)..."

# minifyEnabled false → true (release 블록)
# Capacitor 기본값은 minifyEnabled false. true 로 변경한다.
if grep -q "minifyEnabled false" "$BUILD_GRADLE"; then
    # release 블록만 수정 (debug는 건드리지 않음)
    # release { ... minifyEnabled false ... } 패턴을 true 로 교체
    # Python awk 방식 대신 명확한 sed 범위 치환 사용
    python3 - "$BUILD_GRADLE" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

# release 블록 내의 minifyEnabled false 만 true 로 변경
# release { ... } 범위 내에서만 치환
def patch_release_block(text):
    # release 블록을 찾아서 그 안의 minifyEnabled false 를 true 로 변경
    result = []
    in_release = False
    depth = 0
    i = 0
    while i < len(text):
        # release 블록 진입 감지
        if not in_release and re.match(r'\s*release\s*\{', text[i:]):
            in_release = True
            depth = 0

        if in_release:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    in_release = False

        result.append(text[i])
        i += 1

    # 실제 치환: release 블록 전체를 찾아서 내부만 수정
    def replace_in_release(m):
        block = m.group(0)
        return block.replace('minifyEnabled false', 'minifyEnabled true', 1)

    patched = re.sub(
        r'(release\s*\{[^}]*minifyEnabled\s+false[^}]*\})',
        replace_in_release,
        text,
        flags=re.DOTALL
    )
    return patched

patched = patch_release_block(content)
with open(path, 'w') as f:
    f.write(patched)

print("  minifyEnabled: false → true (release 블록)")
PYEOF
    log_ok "ProGuard/R8 활성화 (minifyEnabled = true)"
else
    # 이미 true 이거나 항목이 없는 경우
    if grep -q "minifyEnabled true" "$BUILD_GRADLE"; then
        log_ok "ProGuard/R8 이미 활성화되어 있습니다"
    else
        log_warn "minifyEnabled 항목을 찾지 못했습니다. 수동으로 확인하세요."
        log_warn "  android/app/build.gradle 의 release 블록에 아래 추가:"
        log_warn "  minifyEnabled true"
        log_warn "  proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'"
    fi
fi

# proguardFiles 라인 확인 (없으면 안내)
if ! grep -q "proguardFiles" "$BUILD_GRADLE"; then
    log_warn "proguardFiles 설정이 없습니다."
    log_warn "  android/app/build.gradle release 블록에 아래 추가를 권장합니다:"
    log_warn "  proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'"
fi

# ── 5. 결과 확인 ──
echo ""
log_ok "============================================"
log_ok " Android 설정 완료"
log_ok "============================================"
echo ""
echo "  변경 내용:"
echo "  • compileSdkVersion = 35"
echo "  • targetSdkVersion  = 35   (Google Play 오류 해결)"
echo "  • minifyEnabled     = true (ProGuard/R8 활성화)"
echo ""
echo "  다음 단계 (릴리스 빌드):"
echo "  cd android && ./gradlew bundleRelease"
echo ""
echo "  ProGuard 매핑 파일 위치 (업로드용):"
echo "  android/app/build/outputs/mapping/release/mapping.txt"
echo ""
log_warn "Google Play Console에 mapping.txt 를 업로드하면 경고도 해결됩니다."
echo ""
