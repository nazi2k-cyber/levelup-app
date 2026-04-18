const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const db = getFirestore();

// 매일 02:00 KST — 포인트 이상 급증 탐지 요약
exports.detectAnomalousPoints = onSchedule(
    { schedule: "0 2 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3" },
    async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const snap = await db.collection("security_alerts")
            .where("type", "==", "points_spike")
            .where("detectedAt", ">=", yesterday)
            .get();

        if (snap.empty) {
            console.log("[SecurityScheduler] 24시간 내 포인트 이상 탐지 없음");
            return;
        }

        await db.collection("security_reports").add({
            type: "daily_anomaly_summary",
            pointsSpikeCount: snap.size,
            alerts: snap.docs.map(d => d.id),
            generatedAt: FieldValue.serverTimestamp(),
        });

        console.warn(`[SecurityScheduler] 포인트 이상 ${snap.size}건 — 보안 리포트 저장 완료`);
    }
);

// 매시간 — 로그인 실패 급증 (Brute-force) 탐지
exports.detectBruteForce = onSchedule(
    { schedule: "0 * * * *", region: "asia-northeast3" },
    async () => {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;

        const snap = await db.collection("app_error_logs")
            .where("category", ">=", "auth/")
            .where("category", "<", "auth0")
            .where("createdAt", ">=", oneHourAgo)
            .get();

        const BRUTE_FORCE_THRESHOLD = 50;
        if (snap.size >= BRUTE_FORCE_THRESHOLD) {
            await db.collection("security_alerts").add({
                type: "brute_force_suspect",
                authErrorCount: snap.size,
                windowStart: new Date(oneHourAgo),
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(
                `[SecurityScheduler] Brute-force 의심 탐지: 1시간 내 Auth 오류 ${snap.size}건`
            );
        } else {
            console.log(`[SecurityScheduler] Auth 오류 ${snap.size}건 — 정상 범위`);
        }
    }
);

// 매주 월요일 09:00 KST — 휴면 어드민 계정 감사
exports.auditAdminAccounts = onSchedule(
    { schedule: "0 9 * * 1", timeZone: "Asia/Seoul", region: "asia-northeast3" },
    async () => {
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

        let nextPageToken;
        const dormantAdmins = [];

        do {
            const result = await getAuth().listUsers(1000, nextPageToken);
            nextPageToken = result.pageToken;

            for (const user of result.users) {
                const claims = user.customClaims || {};
                if (!claims.admin && !claims.master) continue;

                const lastSignIn = user.metadata.lastSignInTime
                    ? new Date(user.metadata.lastSignInTime).getTime()
                    : 0;

                if (lastSignIn < ninetyDaysAgo) {
                    dormantAdmins.push({
                        uid: user.uid,
                        email: user.email || "unknown",
                        claims,
                        lastSignIn: user.metadata.lastSignInTime || "없음",
                    });
                }
            }
        } while (nextPageToken);

        if (dormantAdmins.length > 0) {
            await db.collection("security_alerts").add({
                type: "dormant_admin_accounts",
                count: dormantAdmins.length,
                accounts: dormantAdmins,
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(
                `[SecurityScheduler] 90일 이상 미접속 어드민 ${dormantAdmins.length}명 발견`
            );
        } else {
            console.log("[SecurityScheduler] 휴면 어드민 없음");
        }
    }
);
