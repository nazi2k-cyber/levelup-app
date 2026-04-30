const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { sendSms, decryptPhone, maskPhone } = require("./smsGateway");
const crypto = require("crypto");

let _db;
function db() {
    if (!_db) _db = getFirestore();
    return _db;
}

const scheduleOpts = { region: "asia-northeast3" };
const SCAN_INTERVAL = process.env.HACKING_SCAN_INTERVAL || "*/5 * * * *";
const SMS_DAILY_CAP = Number(process.env.SMS_DAILY_CAP || 200);
const SMS_SCORE_THRESHOLD = 80;

// ─── 탐지 룰 기본값 ───
// security_rules/{ruleId} 문서가 없으면 이 값을 사용한다.
const DEFAULT_RULES = [
    {
        id: "login_failure_spike",
        name: "로그인 실패 폭증",
        enabled: true,
        sourceType: "brute_force",
        severity: "high",
        score: 70,
        threshold: 10,
        windowMinutes: 60,
        cooldownMinutes: 30,
    },
    {
        id: "repeat_points_spike",
        name: "반복 포인트 급증",
        enabled: true,
        sourceType: "repeat_points_spike",
        severity: "high",
        score: 75,
        threshold: 1,
        windowMinutes: 1440,
        cooldownMinutes: 60,
    },
    {
        id: "stats_manipulation",
        name: "스탯 조작 의심",
        enabled: true,
        sourceType: "stats_decrease",
        severity: "critical",
        score: 90,
        threshold: 1,
        windowMinutes: 1440,
        cooldownMinutes: 30,
    },
    {
        id: "admin_claim_suspicious",
        name: "어드민 클레임 이상",
        enabled: true,
        sourceType: "admin_claim_set",
        severity: "high",
        score: 80,
        threshold: 2,
        windowMinutes: 60,
        cooldownMinutes: 60,
    },
    {
        id: "dormant_admin_access",
        name: "휴면 어드민 접근",
        enabled: true,
        sourceType: "dormant_admin",
        severity: "medium",
        score: 50,
        threshold: 1,
        windowMinutes: 10080,
        cooldownMinutes: 10080,
    },
];

// ─── 분산 락 ───
const LOCK_TTL_MS = 4 * 60 * 1000; // 4분

async function acquireLock(lockName) {
    const ref = db().collection("scheduler_locks").doc(lockName);
    const runId = crypto.randomBytes(8).toString("hex");

    return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();

        if (snap.exists) {
            const expiresAt = snap.data().expiresAt?.toMillis?.() || 0;
            if (now < expiresAt) return null; // 이미 잠김
        }

        tx.set(ref, {
            lockedAt: Timestamp.fromMillis(now),
            expiresAt: Timestamp.fromMillis(now + LOCK_TTL_MS),
            runId,
        });
        return runId;
    });
}

async function releaseLock(lockName, runId) {
    const ref = db().collection("scheduler_locks").doc(lockName);
    try {
        await db().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().runId === runId) {
                tx.delete(ref);
            }
        });
    } catch (e) {
        console.warn("[HackingDetection] 락 해제 실패:", e.message);
    }
}

// ─── 룰 로드 ───
async function loadRules() {
    const snap = await db().collection("security_rules").get();
    if (snap.empty) return DEFAULT_RULES;

    const dbRules = {};
    snap.docs.forEach((d) => { dbRules[d.id] = { id: d.id, ...d.data() }; });

    // DEFAULT_RULES 기반으로 병합 (DB에 있으면 DB 우선)
    return DEFAULT_RULES.map((def) => dbRules[def.id] ? { ...def, ...dbRules[def.id] } : def);
}

// ─── Idempotency key ───
function makeIdempotencyKey(ruleId, clusterKey, windowMinutes) {
    const windowMs = windowMinutes * 60 * 1000;
    const slot = Math.floor(Date.now() / windowMs);
    return crypto.createHash("sha1").update(`${ruleId}:${clusterKey}:${slot}`).digest("hex");
}

// ─── 최근 이벤트 조회 ───
async function queryRecentAlerts(sourceType, windowMinutes) {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const snap = await db()
        .collection("security_alerts")
        .where("type", "==", sourceType)
        .where("detectedAt", ">=", Timestamp.fromDate(since))
        .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── 클러스터 키 결정 ───
function getClusterKey(alert) {
    if (alert.userId) return `uid:${alert.userId}`;
    if (alert.targetEmail) return `email:${alert.targetEmail}`;
    return `unknown:${alert.id}`;
}

// ─── 점수 보정 (이벤트 수가 threshold를 초과할수록 최대 +20점) ───
function bonusScore(eventCount, threshold, baseScore) {
    if (threshold <= 0) return 0;
    const ratio = (eventCount - threshold) / threshold;
    const bonus = Math.min(20, Math.floor(ratio * 10));
    return Math.min(100, baseScore + bonus);
}

// ─── Daily SMS 발송 건수 조회 ───
async function getDailySmsSentCount() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const snap = await db()
        .collection("security_sms_logs")
        .where("status", "==", "sent")
        .where("sentAt", ">=", Timestamp.fromDate(dayStart))
        .get();
    return snap.size;
}

// ─── 어드민 SMS 수신자 조회 ───
async function getAdminSmsRecipients() {
    const snap = await db()
        .collection("admin_contacts")
        .where("smsEnabled", "==", true)
        .get();
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// ─── 쿨다운 확인 ───
async function isInCooldown(ruleId, clusterKey, cooldownMinutes) {
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const since = new Date(Date.now() - cooldownMs);
    const snap = await db()
        .collection("security_sms_logs")
        .where("ruleId", "==", ruleId)
        .where("clusterKey", "==", clusterKey)
        .where("lastAttemptAt", ">=", Timestamp.fromDate(since))
        .limit(1)
        .get();
    return !snap.empty;
}

// ─── Finding 중복 확인 ───
async function findingExists(idempotencyKey) {
    const snap = await db()
        .collection("security_findings")
        .where("idempotencyKey", "==", idempotencyKey)
        .limit(1)
        .get();
    return !snap.empty;
}

// ─── SMS 발송 트리거 ───
async function triggerSmsIfNeeded(finding, rule, runId) {
    const { ruleId, clusterKey, severity, score } = finding;

    if (!["critical", "high"].includes(severity)) return;
    if (score < SMS_SCORE_THRESHOLD && severity !== "critical") return;

    // 쿨다운 체크
    if (await isInCooldown(ruleId, clusterKey, rule.cooldownMinutes)) {
        console.log(`[HackingDetection] 쿨다운 중 skip — rule=${ruleId} cluster=${clusterKey}`);
        await logSms({ finding, rule, status: "skipped_cooldown", recipients: [], runId });
        return;
    }

    // 일일 상한 체크
    const dailyCount = await getDailySmsSentCount();
    if (dailyCount >= SMS_DAILY_CAP) {
        console.warn(`[HackingDetection] 일일 SMS 상한 도달 (${dailyCount}/${SMS_DAILY_CAP})`);
        await logSms({ finding, rule, status: "skipped_cap", recipients: [], runId });
        return;
    }

    const recipients = await getAdminSmsRecipients();
    if (recipients.length === 0) {
        console.warn("[HackingDetection] SMS 수신자 없음 — admin_contacts 등록 필요");
        return;
    }

    const message = buildSmsMessage(finding, rule);
    let anySuccess = false;

    for (const contact of recipients) {
        const phone = decryptPhone(contact.encryptedPhone);
        if (!phone) {
            console.warn(`[HackingDetection] 전화번호 복호화 실패 uid=${contact.uid}`);
            continue;
        }
        const result = await sendSms(phone, message);
        if (result.success || result.dryRun) anySuccess = true;
    }

    const status = anySuccess ? "sent" : "failed";
    const logRef = await logSms({ finding, rule, status, recipients, runId });

    // finding 에 SMS 전송 여부 업데이트
    await db()
        .collection("security_findings")
        .doc(finding.id)
        .update({ smsSent: anySuccess, smsLogId: logRef.id });

    console.log(`[HackingDetection] SMS ${status} — rule=${ruleId} cluster=${clusterKey} recipients=${recipients.length}`);
}

function buildSmsMessage(finding, rule) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    return `[보안경보] 해킹의심 탐지\n규칙: ${rule.name}, 위험도: ${finding.severity.toUpperCase()}\n대상: ${finding.clusterKey}, 이벤트: ${finding.eventCount}건\n시각: ${now}`;
}

async function logSms({ finding, rule, status, recipients, runId }) {
    const ref = db().collection("security_sms_logs").doc();
    await ref.set({
        findingId: finding.id || null,
        ruleId: finding.ruleId,
        clusterKey: finding.clusterKey,
        recipients: recipients.map((r) => ({ uid: r.uid, maskedPhone: r.maskedPhone || "***" })),
        message: status.startsWith("skipped") ? null : buildSmsMessage(finding, rule),
        status,
        attempts: ["sent", "failed"].includes(status) ? 1 : 0,
        sentAt: status === "sent" ? FieldValue.serverTimestamp() : null,
        lastAttemptAt: FieldValue.serverTimestamp(),
        idempotencyKey: finding.idempotencyKey,
        schedulerRunId: runId,
        gatewayResponse: null,
    });
    return ref;
}

// ─── 메인 스케줄러 ───
exports.detectHackingAttempts = onSchedule(
    { ...scheduleOpts, schedule: SCAN_INTERVAL },
    async () => {
        const lockName = "detectHackingAttempts";
        const runId = await acquireLock(lockName);
        if (!runId) {
            console.log("[HackingDetection] 이미 실행 중 — 락 획득 실패, 스킵");
            return;
        }

        const runStartAt = Date.now();
        console.log(`[HackingDetection] 스캔 시작 runId=${runId}`);

        try {
            const rules = await loadRules();
            const enabledRules = rules.filter((r) => r.enabled);
            let totalFindings = 0;

            for (const rule of enabledRules) {
                const events = await queryRecentAlerts(rule.sourceType, rule.windowMinutes);
                if (events.length === 0) continue;

                // 클러스터별 집계
                const clusters = {};
                events.forEach((ev) => {
                    const key = getClusterKey(ev);
                    if (!clusters[key]) clusters[key] = [];
                    clusters[key].push(ev);
                });

                for (const [clusterKey, clusterEvents] of Object.entries(clusters)) {
                    if (clusterEvents.length < rule.threshold) continue;

                    const idempKey = makeIdempotencyKey(rule.id, clusterKey, rule.windowMinutes);
                    if (await findingExists(idempKey)) continue;

                    const score = bonusScore(clusterEvents.length, rule.threshold, rule.score);
                    const ref = db().collection("security_findings").doc();
                    const finding = {
                        id: ref.id,
                        ruleId: rule.id,
                        ruleName: rule.name,
                        severity: rule.severity,
                        score,
                        clusterKey,
                        eventCount: clusterEvents.length,
                        relatedAlertIds: clusterEvents.slice(0, 20).map((e) => e.id),
                        detectedAt: FieldValue.serverTimestamp(),
                        schedulerRunId: runId,
                        smsSent: false,
                        smsLogId: null,
                        idempotencyKey: idempKey,
                    };

                    await ref.set(finding);
                    totalFindings++;
                    console.warn(`[HackingDetection] finding 생성 rule=${rule.id} cluster=${clusterKey} score=${score} severity=${rule.severity}`);

                    await triggerSmsIfNeeded(finding, rule, runId);
                }
            }

            const elapsed = Date.now() - runStartAt;
            console.log(`[HackingDetection] 스캔 완료 runId=${runId} findings=${totalFindings} elapsed=${elapsed}ms`);
        } finally {
            await releaseLock(lockName, runId);
        }
    }
);
