const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

const POINTS_SPIKE_THRESHOLD = 50000;
const LEVEL_SPIKE_THRESHOLD = 5;

// users 문서 업데이트 시 포인트/레벨 이상 급증 감지
exports.onUserUpdate = onDocumentUpdated(
    { document: "users/{userId}", region: "asia-northeast3" },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        const pointsDelta = (after.points || 0) - (before.points || 0);
        const levelDelta = (after.level || 1) - (before.level || 1);

        const alerts = [];

        if (pointsDelta > POINTS_SPIKE_THRESHOLD) {
            alerts.push({
                type: "points_spike",
                userId: event.params.userId,
                delta: pointsDelta,
                before: before.points || 0,
                after: after.points || 0,
                detectedAt: FieldValue.serverTimestamp(),
            });
        }

        if (levelDelta > LEVEL_SPIKE_THRESHOLD) {
            alerts.push({
                type: "level_spike",
                userId: event.params.userId,
                delta: levelDelta,
                before: before.level || 1,
                after: after.level || 1,
                detectedAt: FieldValue.serverTimestamp(),
            });
        }

        for (const alert of alerts) {
            await db.collection("security_alerts").add(alert);
            console.warn(
                `[SecurityTrigger] ${alert.type} — userId: ${alert.userId}, delta: ${alert.delta}`
            );
        }
    }
);

// admin_audit_log 신규 문서 생성 감지 (어드민 권한 부여 이벤트)
exports.onAdminClaimSet = onDocumentCreated(
    { document: "admin_audit_log/{logId}", region: "asia-northeast3" },
    async (event) => {
        const data = event.data.data();
        console.log(
            `[SecurityTrigger] Admin claim granted — grantedTo: ${data?.grantedTo}, by: ${data?.grantedBy}, claim: ${data?.claim}`
        );
        // TODO: Slack 웹훅 또는 이메일 알림 연동 시 여기에 추가
    }
);
