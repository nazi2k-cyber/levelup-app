const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");

const db = getFirestore();

const callableOpts = {
    region: "asia-northeast3",
    cors: true,
    invoker: "public",
};

async function countRecentErrors(categoryPrefix, hours = 24) {
    const since = Date.now() - hours * 60 * 60 * 1000;
    const snap = await db.collection("app_error_logs")
        .where("category", ">=", categoryPrefix)
        .where("category", "<", categoryPrefix + "\uffff")
        .where("createdAt", ">=", since)
        .get();
    return snap.size;
}

async function getRecentAlerts(type, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const snap = await db.collection("security_alerts")
        .where("type", "==", type)
        .where("detectedAt", ">=", since)
        .orderBy("detectedAt", "desc")
        .limit(20)
        .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 보안 대시보드 리포트 — 마스터 계정 전용
exports.getSecurityReport = onCall(callableOpts, async (request) => {
    if (!request.auth?.token?.master) {
        throw new HttpsError("permission-denied", "마스터 계정만 사용할 수 있습니다.");
    }

    const [
        loginFailures,
        pointAnomalies,
        levelAnomalies,
        toxicContent,
        blockedContent,
        dormantAdminAlerts,
    ] = await Promise.all([
        countRecentErrors("auth/"),
        getRecentAlerts("points_spike"),
        getRecentAlerts("level_spike"),
        getRecentAlerts("toxic_content"),
        getRecentAlerts("blocked_content"),
        getRecentAlerts("dormant_admin_accounts"),
    ]);

    const dormantAdminCount = dormantAdminAlerts.length > 0
        ? (dormantAdminAlerts[0].count || 0)
        : 0;

    return {
        generatedAt: new Date().toISOString(),
        last24h: {
            loginFailures,
            pointAnomalies: pointAnomalies.length,
            levelAnomalies: levelAnomalies.length,
            toxicContent: toxicContent.length,
            blockedContent: blockedContent.length,
        },
        dormantAdminCount,
        recentAlerts: [
            ...pointAnomalies,
            ...levelAnomalies,
            ...toxicContent,
            ...blockedContent,
        ]
            .sort((a, b) => {
                const aTime = a.detectedAt?.seconds ?? 0;
                const bTime = b.detectedAt?.seconds ?? 0;
                return bTime - aTime;
            })
            .slice(0, 30),
    };
});
