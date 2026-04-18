#!/bin/bash
# Firebase 클라이언트 설정 파일 생성 스크립트
# 사용법: FIREBASE_WEB_API_KEY=<key> npm run generate-config
# App Check (선택): FIREBASE_APPCHECK_SITE_KEY=<key> FIREBASE_APPCHECK_DEBUG_TOKEN=<token>

if [ -z "$FIREBASE_WEB_API_KEY" ]; then
    echo "❌ FIREBASE_WEB_API_KEY 환경변수가 설정되지 않았습니다."
    echo ""
    echo "사용법:"
    echo "  FIREBASE_WEB_API_KEY=your-api-key npm run generate-config"
    echo ""
    echo "API Key 확인 방법:"
    echo "  Firebase Console → 프로젝트 설정 → 웹 앱 → apiKey"
    exit 1
fi

# App Check 필드 조건부 생성
APPCHECK_LINES=""
if [ -n "$FIREBASE_APPCHECK_SITE_KEY" ]; then
    APPCHECK_LINES="${APPCHECK_LINES}    appCheckSiteKey: \"${FIREBASE_APPCHECK_SITE_KEY}\",\n"
fi
if [ -n "$FIREBASE_APPCHECK_DEBUG_TOKEN" ]; then
    APPCHECK_LINES="${APPCHECK_LINES}    appCheckDebugToken: \"${FIREBASE_APPCHECK_DEBUG_TOKEN}\",\n"
fi

printf "var __FIREBASE_CONFIG = {\n\
    apiKey: \"${FIREBASE_WEB_API_KEY}\",\n\
    authDomain: \"levelup-app-53d02.firebaseapp.com\",\n\
    projectId: \"levelup-app-53d02\",\n\
    storageBucket: \"levelup-app-53d02.firebasestorage.app\",\n\
    messagingSenderId: \"233040099152\",\n\
    appId: \"1:233040099152:web:82310514d26c8c6d52de55\",\n\
    measurementId: \"G-4DBGG03CCJ\",\n\
${APPCHECK_LINES}};\n" > www/firebase-config.js

echo "✅ www/firebase-config.js 생성 완료"
[ -n "$FIREBASE_APPCHECK_SITE_KEY" ]    && echo "   ✅ appCheckSiteKey 포함"
[ -n "$FIREBASE_APPCHECK_DEBUG_TOKEN" ] && echo "   ✅ appCheckDebugToken 포함 (개발 환경)"
