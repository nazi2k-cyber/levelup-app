#!/bin/bash
# Firebase 클라이언트 설정 파일 생성 스크립트
# 사용법: FIREBASE_WEB_API_KEY=<key> npm run generate-config

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

cat > firebase-config.js <<EOF
var __FIREBASE_CONFIG = {
    apiKey: "${FIREBASE_WEB_API_KEY}",
    authDomain: "bravecat.studio",
    projectId: "levelup-app-53d02",
    storageBucket: "levelup-app-53d02.firebasestorage.app",
    messagingSenderId: "233040099152",
    appId: "1:233040099152:web:82310514d26c8c6d52de55",
    measurementId: "G-4DBGG03CCJ"
};
EOF

cp firebase-config.js www/firebase-config.js
echo "✅ firebase-config.js 생성 완료 (root + www/)"
