const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const scheduleOpts = { region: "asia-northeast3", timeZone: "Asia/Seoul" };
const PERIOD_LABELS = { daily: "일별", weekly: "주별", monthly: "월별", quarterly: "분기별", yearly: "연도별" };

function makeSessionId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function runScheduledBackup(period) {
    const db = getFirestore();
    const configSnap = await db.collection("admin_config").doc("backup_scheduler").get();
    const config = configSnap.exists ? configSnap.data() : {};

    if (!config[period]?.enabled) {
        console.log(`[BackupScheduler] ${period} 백업 비활성화됨, 스킵`);
        return;
    }

    const sessionId = makeSessionId();
    const usersSnap = await db.collection("users").get();
    let count = 0;
    let batch = db.batch();
    let batchCount = 0;
    const memo = `자동 백업 (${PERIOD_LABELS[period]})`;
    const createdBy = `scheduler:${period}`;

    for (const userDoc of usersSnap.docs) {
        const ref = db.collection("user_backups").doc();
        batch.set(ref, {
            uid: userDoc.id,
            data: userDoc.data(),
            memo,
            sessionId,
            createdAt: FieldValue.serverTimestamp(),
            createdBy
        });
        batchCount++;
        count++;
        if (batchCount === 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) await batch.commit();

    await db.collection("backup_sessions").doc(sessionId).set({
        sessionId,
        type: "scheduled",
        period,
        memo,
        userCount: count,
        createdAt: FieldValue.serverTimestamp(),
        createdBy
    });

    await db.collection("admin_config").doc("backup_scheduler").set({
        [period]: { enabled: true, lastRun: FieldValue.serverTimestamp(), lastCount: count }
    }, { merge: true });

    console.log(`[BackupScheduler] ${period} 완료: ${count}명 sessionId=${sessionId}`);
}

exports.scheduledBackupDaily = onSchedule(
    { ...scheduleOpts, schedule: "0 2 * * *" },
    () => runScheduledBackup("daily")
);

exports.scheduledBackupWeekly = onSchedule(
    { ...scheduleOpts, schedule: "0 4 * * 0" },
    () => runScheduledBackup("weekly")
);

exports.scheduledBackupMonthly = onSchedule(
    { ...scheduleOpts, schedule: "0 3 1 * *" },
    () => runScheduledBackup("monthly")
);

exports.scheduledBackupQuarterly = onSchedule(
    { ...scheduleOpts, schedule: "0 3 1 1,4,7,10 *" },
    () => runScheduledBackup("quarterly")
);

exports.scheduledBackupYearly = onSchedule(
    { ...scheduleOpts, schedule: "0 3 1 1 *" },
    () => runScheduledBackup("yearly")
);

exports.makeSessionId = makeSessionId;
