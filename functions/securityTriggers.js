const { onDocumentUpdated, onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

let _db;
function db() {
    if (!_db) _db = getFirestore();
    return _db;
}

const triggerOpts = { region: "asia-northeast3" };

// 포인트 급증 감지 — users 문서 업데이트 시 실시간 검사
exports.onUserPointsUpdate = onDocumentUpdated(
    { ...triggerOpts, document: "users/{userId}" },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        const delta = (after.points || 0) - (before.points || 0);

        if (delta > 50000) {
            await db().collection("security_alerts").add({
                type: "points_spike",
                userId: event.params.userId,
                delta,
                pointsBefore: before.points || 0,
                pointsAfter: after.points || 0,
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(`[SecurityTrigger] points_spike uid=${event.params.userId} delta=${delta}`);
        }
    }
);

// 대량 삭제 감지 — users 문서에서 stats 필드가 한 번에 대규모 감소 시
exports.onUserStatsReset = onDocumentUpdated(
    { ...triggerOpts, document: "users/{userId}" },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        const questBefore = before.stats?.totalQuestsCompleted || 0;
        const questAfter = after.stats?.totalQuestsCompleted || 0;

        // 퀘스트 완료 수가 감소한 경우 — 데이터 조작 의심
        if (questBefore > 0 && questAfter < questBefore) {
            await db().collection("security_alerts").add({
                type: "stats_decrease",
                userId: event.params.userId,
                field: "totalQuestsCompleted",
                before: questBefore,
                after: questAfter,
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(`[SecurityTrigger] stats_decrease uid=${event.params.userId} quests: ${questBefore}→${questAfter}`);
        }
    }
);

// 어드민 클레임 부여 감사 — admin_audit_log 신규 문서 생성 시 security_alerts에 기록
exports.onAdminClaimSet = onDocumentCreated(
    { ...triggerOpts, document: "admin_audit_log/{logId}" },
    async (event) => {
        const data = event.data.data();
        await db().collection("security_alerts").add({
            type: "admin_claim_set",
            targetUid: data.targetUid || null,
            targetEmail: data.targetEmail || null,
            grantedBy: data.grantedBy || null,
            claimType: data.claimType || null,
            detectedAt: FieldValue.serverTimestamp(),
        });
        console.log(`[SecurityTrigger] admin_claim_set logId=${event.params.logId}`);
    }
);

// 신고 접수 시 totalReportCount 누적 관리
// 경고 알림은 관리자 삭제 처리(삭제 + 안내 발송) 시에만 발송됨
exports.onPostReportWritten = onDocumentWritten(
    { ...triggerOpts, document: "post_reports/{postId}" },
    async (event) => {
        const after = event.data?.after?.data();
        const before = event.data?.before?.data();
        if (!after) return; // 삭제 이벤트는 무시

        const newCount = after.reportCount || 0;
        const oldCount = before?.reportCount || 0;

        const postId = event.params.postId;
        const ownerUid = postId.split("_").slice(0, -1).join("_");
        if (!ownerUid) return;

        // 신고 누적 이력 관리 — 기각/삭제 시에도 감소하지 않음
        const added = newCount - oldCount;
        if (added > 0) {
            try {
                await db().collection("users").doc(ownerUid).update({
                    totalReportCount: FieldValue.increment(added)
                });
                console.log(`[SecurityTrigger] totalReportCount +${added} for uid=${ownerUid} (total=${newCount})`);
            } catch (e) {
                console.warn("[SecurityTrigger] totalReportCount increment failed:", e.message);
            }
        }
    }
);
