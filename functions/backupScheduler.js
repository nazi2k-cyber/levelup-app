const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const scheduleOpts = { region: "asia-northeast3", timeZone: "Asia/Seoul" };
const PERIOD_LABELS = { daily: "일별", weekly: "주별", monthly: "월별", quarterly: "분기별", yearly: "연도별" };

const BACKUP_MAX_DOCS_PER_RUN = Number(process.env.BACKUP_MAX_DOCS_PER_RUN || 2000);
const BACKUP_MAX_MS_PER_RUN = Number(process.env.BACKUP_MAX_MS_PER_RUN || 240000);
const BACKUP_CURSOR_LAG_MINUTES = Number(process.env.BACKUP_CURSOR_LAG_MINUTES || 10);
const QUERY_PAGE_SIZE = 400;

function makeSessionId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function runScheduledBackup(period) {
    const db = getFirestore();
    const configRef = db.collection("admin_config").doc("backup_scheduler");
    const configSnap = await configRef.get();
    const config = configSnap.exists ? configSnap.data() : {};

    if (!config[period]?.enabled) {
        console.log(`[BackupScheduler] ${period} 백업 비활성화됨, 스킵`);
        return;
    }

    const nowMs = Date.now();
    const cursorLagMs = BACKUP_CURSOR_LAG_MINUTES * 60 * 1000;
    const safeUpperBound = Timestamp.fromMillis(nowMs - cursorLagMs);

    const sessionId = makeSessionId();
    const memo = `자동 백업 (${PERIOD_LABELS[period]})`;
    const createdBy = `scheduler:${period}`;
    const startedAtMs = nowMs;

    const previousCursor = config[period]?.lastCursorAt || null;
    let processed = 0;
    let lastProcessedUpdatedAt = previousCursor;
    let hasMore = false;

    while (processed < BACKUP_MAX_DOCS_PER_RUN && (Date.now() - startedAtMs) < BACKUP_MAX_MS_PER_RUN) {
        const queryLimit = Math.min(QUERY_PAGE_SIZE, BACKUP_MAX_DOCS_PER_RUN - processed);
        let query = db.collection("users")
            .where("updatedAt", "<=", safeUpperBound)
            .orderBy("updatedAt", "asc")
            .limit(queryLimit);

        if (lastProcessedUpdatedAt) {
            query = query.where("updatedAt", ">", lastProcessedUpdatedAt);
        }

        const usersSnap = await query.get();
        if (usersSnap.empty) {
            hasMore = false;
            break;
        }

        const commitGroups = [];
        let batch = db.batch();
        let batchOps = 0;

        for (const userDoc of usersSnap.docs) {
            const backupRef = db.collection("user_backups").doc();
            batch.set(backupRef, {
                uid: userDoc.id,
                data: userDoc.data(),
                memo,
                sessionId,
                createdAt: FieldValue.serverTimestamp(),
                createdBy
            });

            batch.set(userDoc.ref, {
                lastBackupAt: FieldValue.serverTimestamp()
            }, { merge: true });

            batchOps += 2;
            processed += 1;
            lastProcessedUpdatedAt = userDoc.get("updatedAt") || lastProcessedUpdatedAt;

            if (batchOps >= 400) {
                commitGroups.push(batch.commit());
                batch = db.batch();
                batchOps = 0;
            }

            if (processed >= BACKUP_MAX_DOCS_PER_RUN || (Date.now() - startedAtMs) >= BACKUP_MAX_MS_PER_RUN) {
                break;
            }
        }

        if (batchOps > 0) commitGroups.push(batch.commit());
        await Promise.all(commitGroups);

        hasMore = usersSnap.size === queryLimit && processed < BACKUP_MAX_DOCS_PER_RUN && (Date.now() - startedAtMs) < BACKUP_MAX_MS_PER_RUN;
        if (!hasMore) break;
    }

    const runMs = Date.now() - startedAtMs;

    await db.collection("backup_sessions").doc(sessionId).set({
        sessionId,
        type: "scheduled",
        period,
        memo,
        userCount: processed,
        hasMore,
        previousCursorAt: previousCursor || null,
        nextCursorAt: lastProcessedUpdatedAt || previousCursor || null,
        maxDocsPerRun: BACKUP_MAX_DOCS_PER_RUN,
        maxMsPerRun: BACKUP_MAX_MS_PER_RUN,
        createdAt: FieldValue.serverTimestamp(),
        runMs,
        createdBy
    });

    await configRef.set({
        [period]: {
            enabled: true,
            lastRun: FieldValue.serverTimestamp(),
            lastCount: processed,
            lastCursorAt: lastProcessedUpdatedAt || previousCursor || safeUpperBound,
            hasMore,
            lastRunMs: runMs
        }
    }, { merge: true });

    console.log(`[BackupScheduler] ${period} 완료: ${processed}명 sessionId=${sessionId} hasMore=${hasMore}`);
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
