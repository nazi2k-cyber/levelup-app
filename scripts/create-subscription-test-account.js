#!/usr/bin/env node
/**
 * 구독 서비스 테스트 계정 생성 스크립트
 *
 * 용도: 광고 패스 + DIY 퀘스트 무제한 + 관리자 권한을 가진 테스트 계정 생성
 * 참고: docs/ongoing/구독_서비스_도입검토.md
 *
 * 사용법:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/create-subscription-test-account.js
 *   TEST_EMAIL=custom@example.com TEST_PASSWORD=MyPass123! node scripts/create-subscription-test-account.js
 *
 * 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 JSON 경로 (필수 또는 Firebase 에뮬레이터 환경)
 *   FIREBASE_PROJECT_ID              프로젝트 ID (기본값: levelup-app-53d02)
 *   TEST_EMAIL                       테스트 계정 이메일 (기본값: test-subscription@levelup.test)
 *   TEST_PASSWORD                    테스트 계정 비밀번호 (기본값: TestPass123!)
 */

'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'levelup-app-53d02';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test-subscription@levelup.test';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPass123!';
const DISPLAY_NAME = '[구독테스트] 계정';

async function main() {
    // Firebase Admin 초기화
    if (!admin.apps.length) {
        const initOpts = { projectId: PROJECT_ID };
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            initOpts.credential = admin.credential.applicationDefault();
        }
        admin.initializeApp(initOpts);
    }

    const auth = admin.auth();
    const db = admin.firestore();

    console.log(`\n🔧 Firebase 프로젝트: ${PROJECT_ID}`);
    console.log(`📧 테스트 계정 이메일: ${TEST_EMAIL}\n`);

    // ── 1. Firebase Auth 계정 생성 (이미 존재하면 기존 계정 사용) ──
    let uid;
    try {
        const existing = await auth.getUserByEmail(TEST_EMAIL);
        uid = existing.uid;
        console.log(`ℹ️  기존 계정 발견 → uid: ${uid}`);
    } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
        const created = await auth.createUser({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            displayName: DISPLAY_NAME,
            emailVerified: true,
        });
        uid = created.uid;
        console.log(`✅ Firebase Auth 계정 생성 → uid: ${uid}`);
    }

    // ── 2. Admin Custom Claim 설정 ──
    const userRecord = await auth.getUser(uid);
    const existing = userRecord.customClaims || {};
    if (!existing.admin) {
        await auth.setCustomUserClaims(uid, { ...existing, admin: true });
        console.log('✅ Custom Claim 설정: admin=true');
    } else {
        console.log('ℹ️  Custom Claim admin=true 이미 설정됨');
    }

    // ── 3. Firestore users/{uid} 문서 생성/업데이트 ──
    const { FieldValue } = require('firebase-admin/firestore');
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();

    const subscriptionPayload = {
        noAds: true,
        unlimitedDiyQuests: true,
        plan: 'test',
        activatedAt: FieldValue.serverTimestamp(),
    };

    if (snap.exists) {
        // 기존 문서에 subscription 필드만 추가/갱신
        await userRef.update({ subscription: subscriptionPayload });
        console.log('✅ 기존 Firestore 문서에 subscription 필드 추가');
    } else {
        // 신규 문서 생성 (saveUserData payload 구조 참고: www/app.js)
        await userRef.set({
            name: DISPLAY_NAME,
            level: 1,
            points: 50,
            stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            titleHistoryStr: JSON.stringify([{ level: 1, title: { ko: '신규 각성자', en: 'New Awakened', ja: '新規覚醒者' } }]),
            questStr: JSON.stringify(Array.from({ length: 7 }, () => Array(12).fill(false))),
            questWeekStart: '',
            dungeonStr: '{}',
            diyQuestsStr: JSON.stringify({ definitions: [], completedToday: {}, lastResetDate: null }),
            questHistoryStr: '{}',
            streakStr: JSON.stringify({ currentStreak: 0, lastActiveDate: null, multiplier: 1.0, activeDates: [] }),
            streak: { currentStreak: 0, lastActiveDate: null, multiplier: 1.0 },
            rareTitleStr: JSON.stringify({ unlocked: [] }),
            ddaysStr: '[]',
            ddayCaption: '',
            friends: [],
            syncEnabled: false,
            gpsEnabled: false,
            pushEnabled: false,
            cameraEnabled: false,
            lang: 'ko',
            instaId: '',
            linkedinId: '',
            diaryStr: '{}',
            libraryStr: JSON.stringify({ books: [] }),
            moviesStr: JSON.stringify({ items: [], rewardedIds: [] }),
            subscription: subscriptionPayload,
        });
        console.log('✅ Firestore users 문서 신규 생성 (subscription 포함)');
    }

    // ── 4. 결과 출력 ──
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 테스트 계정 준비 완료');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  UID      : ${uid}`);
    console.log(`  이메일   : ${TEST_EMAIL}`);
    console.log(`  비밀번호 : ${TEST_PASSWORD}`);
    console.log('  권한     : admin (Custom Claim)');
    console.log('  구독     : noAds=true, unlimitedDiyQuests=true, plan=test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
    console.error('❌ 오류 발생:', err.message || err);
    process.exit(1);
});
