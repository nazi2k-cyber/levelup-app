const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// ─── NSFWJS (1차 로컬 이미지 스크리닝, 무료) ───
let nsfwModel = null;
async function getNsfwModel() {
    if (!nsfwModel) {
        try {
            require("@tensorflow/tfjs");
            const nsfw = require("nsfwjs");
            nsfwModel = await nsfw.load("MobileNetV2");
            console.log("[NSFWJS] 모델 로드 완료 (MobileNetV2, pure JS)");
        } catch (e) {
            console.warn("[NSFWJS] 모델 로드 실패:", e.message);
            return null;
        }
    }
    return nsfwModel;
}

// ─── Azure Content Safety API (2차 정밀 이미지 스크리닝) ───
let azureClient = null;
let _azureInitError = null; // 마지막 초기화 실패 사유 (구체적 에러 메시지)
function getAzureClient() {
    if (!azureClient) {
        const endpoint = process.env.AZURE_CS_ENDPOINT;
        const key = process.env.AZURE_CS_KEY;
        if (!endpoint && !key) {
            _azureInitError = "AZURE_CS_ENDPOINT 및 AZURE_CS_KEY 환경변수가 모두 설정되지 않았습니다";
            console.warn(`[Azure] ${_azureInitError}. 이미지 스크리닝이 비활성화됩니다.`);
            return null;
        }
        if (!endpoint) {
            _azureInitError = "AZURE_CS_ENDPOINT 환경변수가 설정되지 않았습니다";
            console.warn(`[Azure] ${_azureInitError}. 이미지 스크리닝이 비활성화됩니다.`);
            return null;
        }
        if (!key) {
            _azureInitError = "AZURE_CS_KEY 환경변수가 설정되지 않았습니다";
            console.warn(`[Azure] ${_azureInitError}. 이미지 스크리닝이 비활성화됩니다.`);
            return null;
        }
        try {
            const ContentSafetyClient = require("@azure-rest/ai-content-safety").default;
            const { AzureKeyCredential } = require("@azure/core-auth");
            azureClient = ContentSafetyClient(endpoint, new AzureKeyCredential(key));
            _azureInitError = null; // 성공 시 에러 초기화
        } catch (e) {
            _azureInitError = `패키지 로드 실패: ${e.message}`;
            console.warn(`[Azure] ${_azureInitError}`);
            return null;
        }
    }
    return azureClient;
}

function getAzureInitError() {
    return _azureInitError;
}

// Callable 함수 공통 옵션 (Gen 2 Cloud Run 호환)
const callableOpts = {
    region: "asia-northeast3",
    cors: true,
    invoker: "public"
};

// ping 함수 전용 옵션 (이미지 스크리닝 시 NSFWJS 모델 로딩에 메모리/타임아웃 필요)
const pingCallableOpts = {
    region: "asia-northeast3",
    cors: true,
    invoker: "public",
    memory: "1GiB",
    timeoutSeconds: 120
};

// ─── Admin / Master claim helper ───

const ADMIN_EMAILS = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map(e => e.trim()).filter(Boolean)
    : [];

const MASTER_EMAILS = process.env.MASTER_EMAILS
    ? process.env.MASTER_EMAILS.split(",").map(e => e.trim()).filter(Boolean)
    : [];

async function assertAdmin(request) {
    if (request.auth?.token?.admin) return;
    if (request.auth?.token?.adminOperator) return;

    // Fallback: check admin email list + verify/repair custom claim
    const email = request.auth?.token?.email;

    // Master email → auto-repair with both master + admin claims
    if (email && MASTER_EMAILS.includes(email)) {
        try {
            const user = await getAuth().getUser(request.auth.uid);
            const existing = user.customClaims || {};
            if (existing.admin && existing.master) return;
            await getAuth().setCustomUserClaims(request.auth.uid, { ...existing, admin: true, master: true });
            console.log("[assertAdmin] Auto-repaired master+admin claim for", email);
        } catch (e) {
            console.error("[assertAdmin] Claim repair failed:", e.message);
        }
        return;
    }

    if (email && ADMIN_EMAILS.includes(email)) {
        try {
            const user = await getAuth().getUser(request.auth.uid);
            if (user.customClaims?.admin) return;
            await getAuth().setCustomUserClaims(request.auth.uid, { ...(user.customClaims || {}), admin: true });
            console.log("[assertAdmin] Auto-repaired admin claim for", email);
        } catch (e) {
            console.error("[assertAdmin] Claim repair failed:", e.message);
        }
        return;
    }

    throw new HttpsError("permission-denied", "권한이 없습니다.");
}

/** Master 계정만 호출 가능 */
async function assertMaster(request) {
    const email = request.auth?.token?.email;

    // Check master claim first
    if (request.auth?.token?.master) return;

    // Fallback: check master email list
    if (email && MASTER_EMAILS.includes(email)) {
        try {
            const user = await getAuth().getUser(request.auth.uid);
            const existing = user.customClaims || {};
            if (!existing.master) {
                await getAuth().setCustomUserClaims(request.auth.uid, { ...existing, admin: true, master: true });
                console.log("[assertMaster] Auto-repaired master claim for", email);
            }
        } catch (e) {
            console.error("[assertMaster] Claim repair failed:", e.message);
        }
        return;
    }

    throw new HttpsError("permission-denied", "마스터 계정만 사용할 수 있습니다.");
}

// ─── syncClaims: 로그인 시 이메일 기반 claim 자동 동기화 ───

exports.syncClaims = onCall(callableOpts, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const email = request.auth.token.email;
    const uid = request.auth.uid;
    if (!email) return { updated: false, reason: "no email" };

    const user = await getAuth().getUser(uid);
    const existing = user.customClaims || {};
    let updated = false;

    // 마스터 이메일 확인 → master + admin claim 설정
    if (MASTER_EMAILS.includes(email)) {
        if (!existing.master || !existing.admin) {
            await getAuth().setCustomUserClaims(uid, { ...existing, master: true, admin: true });
            console.log("[syncClaims] Master claims set for", email);
            updated = true;
        }
    }
    // 관리자 이메일 확인 → admin claim 설정
    else if (ADMIN_EMAILS.includes(email)) {
        if (!existing.admin) {
            await getAuth().setCustomUserClaims(uid, { ...existing, admin: true });
            console.log("[syncClaims] Admin claim set for", email);
            updated = true;
        }
    }

    return { updated, master: MASTER_EMAILS.includes(email), admin: ADMIN_EMAILS.includes(email) || MASTER_EMAILS.includes(email) };
});

// ─── setAdminClaim: 관리자 Custom Claims 설정 (마스터 계정만 호출 가능) ───

exports.setAdminClaim = onCall(callableOpts, async (request) => {
    await assertMaster(request);

    const { uid } = request.data || {};
    if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid는 필수 문자열입니다.");
    }

    const user = await getAuth().getUser(uid);
    const existing = user.customClaims || {};
    await getAuth().setCustomUserClaims(uid, { ...existing, admin: true });
    console.log(`[setAdminClaim] admin claim set for uid: ${uid} by master: ${request.auth.token.email}`);
    return { success: true, uid };
});

// ─── setAdminOperator: 관리자 페이지 운영 권한 부여 (마스터 계정만 호출 가능) ───

exports.setAdminOperator = onCall(callableOpts, async (request) => {
    await assertMaster(request);

    const { uid } = request.data || {};
    if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid는 필수 문자열입니다.");
    }

    const user = await getAuth().getUser(uid);
    const existing = user.customClaims || {};
    await getAuth().setCustomUserClaims(uid, { ...existing, adminOperator: true });
    console.log(`[setAdminOperator] adminOperator claim set for uid: ${uid} by master: ${request.auth.token.email}`);
    return { success: true, uid };
});

// ─── removeAdminOperator: 관리자 페이지 운영 권한 회수 (마스터 계정만 호출 가능) ───

exports.removeAdminOperator = onCall(callableOpts, async (request) => {
    await assertMaster(request);

    const { uid } = request.data || {};
    if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid는 필수 문자열입니다.");
    }

    const user = await getAuth().getUser(uid);
    const existing = user.customClaims || {};
    delete existing.adminOperator;
    await getAuth().setCustomUserClaims(uid, existing);
    console.log(`[removeAdminOperator] adminOperator claim removed for uid: ${uid} by master: ${request.auth.token.email}`);
    return { success: true, uid };
});

// ─── listAdminOperators: 운영 권한 보유자 목록 조회 (마스터 계정만 호출 가능) ───

async function handleListAdminOperators(request) {
    await assertMaster(request);

    const listResult = await getAuth().listUsers(1000);
    const operators = [];

    for (const user of listResult.users) {
        const claims = user.customClaims || {};
        if (claims.adminOperator || claims.admin || claims.master) {
            operators.push({
                uid: user.uid,
                email: user.email || null,
                displayName: user.displayName || null,
                master: !!claims.master,
                admin: !!claims.admin,
                adminOperator: !!claims.adminOperator,
                disabled: user.disabled
            });
        }
    }

    return { operators };
}

// ─── Admin action handlers (shared between ping router and individual exports) ───

async function handleGetTestUsers(request) {
    await assertAdmin(request);

    console.log("[getTestUsers] Querying pushEnabled users...");
    const usersSnap = await db.collection("users")
        .where("pushEnabled", "==", true)
        .limit(100)
        .get();
    console.log("[getTestUsers] Found", usersSnap.size, "users");

    const now = new Date();
    const users = [];
    for (const doc of usersSnap.docs) {
        try {
            const data = doc.data();
            let lastActiveDate = null;
            let diffDays = null;
            try {
                const streak = JSON.parse(data.streakStr || "{}");
                if (streak.lastActiveDate) {
                    lastActiveDate = String(streak.lastActiveDate);
                    const d = Math.floor((now - new Date(streak.lastActiveDate)) / (1000 * 60 * 60 * 24));
                    diffDays = Number.isFinite(d) ? d : null;
                }
            } catch (_e) { /* ignore streak parse error */ }

            // Determine streak stage: N/A, 2d_inactive, 3d+_inactive
            let streakStage = "none"; // 미해당
            if (diffDays !== null) {
                if (diffDays >= 3) streakStage = "3d+";
                else if (diffDays >= 2) streakStage = "2d";
            }

            users.push({
                uid: String(doc.id),
                displayName: String(data.name || data.displayName || doc.id.substring(0, 8)),
                nickname: data.name ? String(data.name) : null,
                lang: String(data.lang || "ko"),
                fcmToken: data.fcmToken ? String(data.fcmToken) : null,
                lastActiveDate,
                diffDays,
                streakStage
            });
        } catch (docErr) {
            console.warn("[getTestUsers] Skipping doc", doc.id, docErr.message);
        }
    }
    console.log("[getTestUsers] Returning", users.length, "users");
    return { users };
}

async function handleGetPushLogs(request) {
    await assertAdmin(request);

    console.log("[getPushLogs] Querying push_logs...");
    const logsSnap = await db.collection("push_logs")
        .orderBy("timestamp", "desc")
        .limit(50)
        .get();
    console.log("[getPushLogs] Found", logsSnap.size, "logs");

    // Build user lookup maps (by uid and by token)
    const usersSnap = await db.collection("users").get();
    const uidToUser = {};
    const tokenToUser = {};
    for (const uDoc of usersSnap.docs) {
        const uData = uDoc.data();
        const info = {
            uid: uDoc.id,
            displayName: String(uData.name || uData.displayName || uDoc.id.substring(0, 8)),
            nickname: uData.name ? String(uData.name) : null
        };
        uidToUser[uDoc.id] = info;
        if (uData.fcmToken) {
            tokenToUser[String(uData.fcmToken)] = info;
            // Also map truncated token (as stored in logs: first 20 chars + "...")
            tokenToUser[String(uData.fcmToken).substring(0, 20) + "..."] = info;
        }
    }

    const logs = [];
    for (const doc of logsSnap.docs) {
        try {
            const data = doc.data();
            let ts;
            try {
                ts = data.timestamp && typeof data.timestamp.toDate === "function"
                    ? data.timestamp.toDate().toISOString()
                    : String(data.timestamp || "");
            } catch (_e) {
                ts = String(data.timestamp || "");
            }
            const target = String(data.target || "");
            // Resolve user: prefer uid field, fallback to token matching
            const userInfo = (data.uid && uidToUser[data.uid]) || tokenToUser[target] || null;
            logs.push({
                id: String(doc.id),
                timestamp: ts,
                type: String(data.type || ""),
                target,
                success: !!data.success,
                messageId: data.messageId ? String(data.messageId) : null,
                error: data.error ? String(data.error) : null,
                sender: data.sender ? String(data.sender) : null,
                uid: data.uid ? String(data.uid) : null,
                userName: userInfo ? userInfo.displayName : null,
                userNickname: userInfo ? userInfo.nickname : null
            });
        } catch (docErr) {
            console.warn("[getPushLogs] Skipping doc", doc.id, docErr.message);
        }
    }
    console.log("[getPushLogs] Returning", logs.length, "logs");
    return { logs };
}

async function handleGetClientErrorLogs(request) {
    await assertAdmin(request);

    const limit = Math.min(Number(request.data?.limit || 50), 200);
    console.log("[getClientErrorLogs] Querying app_error_logs, limit=", limit);

    const logsSnap = await db.collection("app_error_logs")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

    const logs = logsSnap.docs.map((d) => {
        const data = d.data();
        return {
            id: String(d.id),
            uid: String(data.uid || ""),
            category: String(data.category || ""),
            message: String(data.message || ""),
            detail: String(data.detail || ""),
            createdAt: Number(data.createdAt || 0)
        };
    });

    return { logs };
}

async function handleSendTestNotification(request) {
    const callerEmail = request.auth?.token?.email;
    const reqData = request.data || {};
    console.log("[sendTestNotification] caller:", callerEmail, "data:", JSON.stringify(reqData));
    await assertAdmin(request);

    const { token, topic, type, lang, customTitle, customBody } = reqData;
    if (!token && !topic) {
        throw new HttpsError("invalid-argument", "token 또는 topic은 필수입니다.");
    }

    let notification;
    if (type === "custom") {
        if (!customTitle || !customBody) throw new HttpsError("invalid-argument", "커스텀 알림은 제목과 본문이 필수입니다.");
        notification = { title: String(customTitle), body: String(customBody) };
    } else {
        notification = getLocalizedMessage(type || "raid_start", lang || "ko");
    }

    // 알림 타입에 따른 대상 탭 매핑
    const typeTabMap = {
        raid_start: "dungeon",
        raid_alert: "dungeon",
        daily_reminder: "diary",
        quest_reminder: "quests",
        streak_warning: "status",
        streak_broken: "status",
        custom: "status"
    };
    const targetTab = typeTabMap[type] || "status";

    const message = {
        notification,
        data: {
            tab: targetTab,
            target: targetTab,
            type: "test_" + (type || "raid_start"),
            link: "levelup://tab/" + (targetTab || "status")
        },
        android: {
            priority: "high",
            notification: {
                channelId: "test",
                sound: "default"
            }
        }
    };

    if (token) message.token = String(token);
    else message.topic = String(topic);

    const target = token ? String(token).substring(0, 20) + "..." : "topic:" + topic;

    // Resolve uid from token for logging
    let targetUid = null;
    if (token) {
        try {
            const uSnap = await db.collection("users").where("fcmToken", "==", String(token)).limit(1).get();
            if (!uSnap.empty) targetUid = uSnap.docs[0].id;
        } catch (_e) { /* ignore lookup failure */ }
    }

    try {
        const response = await messaging.send(message);
        console.log("[sendTestNotification] FCM success:", response);

        await db.collection("push_logs").add({
            timestamp: new Date(),
            type: String(type || "raid_start"),
            target: String(target),
            success: true,
            messageId: String(response),
            sender: String(callerEmail),
            uid: targetUid
        });

        return { success: true, messageId: String(response) };
    } catch (e) {
        console.error("[sendTestNotification] FCM failed:", e.code, e.message);
        try {
            await db.collection("push_logs").add({
                timestamp: new Date(),
                type: String(type || "raid_start"),
                target: String(target),
                success: false,
                error: String(e.code || e.message),
                sender: String(callerEmail),
                uid: targetUid
            });
        } catch (logErr) {
            console.error("[sendTestNotification] Log write failed:", logErr.message);
        }

        throw new HttpsError("failed-precondition", "발송 실패: " + String(e.code || e.message));
    }
}

async function handleSendAnnouncement(request) {
    await assertAdmin(request);

    const { title, body, targetTab } = request.data || {};
    if (!title || !body) {
        throw new HttpsError("invalid-argument", "title과 body는 필수입니다.");
    }

    const announcementTab = targetTab || "status";
    const message = {
        topic: "announcements",
        notification: { title, body },
        data: {
            tab: announcementTab,
            target: announcementTab,
            type: "announcement",
            link: "levelup://tab/" + announcementTab
        },
        android: {
            priority: "high",
            notification: {
                channelId: "announcements",
                sound: "default"
            }
        }
    };

    const response = await messaging.send(message);
    console.log("[공지사항] 발송 완료:", response);
    return { success: true, messageId: response };
}

// ─── Admin: 유저 관리 핸들러 ───

// 전체 유저 목록 조회 (관리자용)
async function handleAdminListUsers(request) {
    await assertAdmin(request);

    const usersSnap = await db.collection("users").get();
    const users = [];

    for (const doc of usersSnap.docs) {
        const data = doc.data();
        let displayName = data.name || data.displayName || doc.id.substring(0, 8);
        let email = null;
        try {
            const authUser = await getAuth().getUser(doc.id);
            email = authUser.email || null;
        } catch (_) { /* user may not exist in Auth */ }

        users.push({
            uid: doc.id,
            displayName: String(displayName),
            email,
            level: data.level || 1,
            disabled: false
        });
    }

    // Auth에서 disabled 상태도 확인
    for (const u of users) {
        try {
            const authUser = await getAuth().getUser(u.uid);
            u.disabled = authUser.disabled || false;
            u.email = authUser.email || u.email;
        } catch (_) { /* ignore */ }
    }

    // 유저별 신고 누적 횟수 집계 (기각 제외 = post_reports에 남아있는 것만)
    try {
        const reportsSnap = await db.collection("post_reports").get();
        const reportCountByUid = {};
        for (const rdoc of reportsSnap.docs) {
            const rdata = rdoc.data();
            const pid = rdata.postId || rdoc.id;
            const rparts = pid.split("_");
            const rOwnerUid = rparts.slice(0, -1).join("_");
            reportCountByUid[rOwnerUid] = (reportCountByUid[rOwnerUid] || 0) + (rdata.reportCount || 0);
        }
        for (const u of users) {
            u.reportCount = reportCountByUid[u.uid] || 0;
        }
    } catch(_) { /* reports count fail - continue */ }

    return { users };
}

// 유저 데이터 백업 생성
async function handleBackupUserData(request) {
    await assertAdmin(request);
    const { uid, memo } = request.data || {};
    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) throw new HttpsError("not-found", "유저를 찾을 수 없습니다.");

    const backupRef = await db.collection("user_backups").add({
        uid: String(uid),
        data: userDoc.data(),
        memo: String(memo || "수동 백업"),
        createdAt: new Date(),
        createdBy: request.auth.token.email || request.auth.uid
    });

    console.log(`[backupUserData] Backup created for ${uid}: ${backupRef.id}`);
    return { success: true, backupId: backupRef.id };
}

// 유저 백업 목록 조회
async function handleListBackups(request) {
    await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    const backupsSnap = await db.collection("user_backups")
        .where("uid", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

    const backups = backupsSnap.docs.map(d => {
        const data = d.data();
        let ts;
        try {
            ts = data.createdAt && typeof data.createdAt.toDate === "function"
                ? data.createdAt.toDate().toISOString()
                : String(data.createdAt || "");
        } catch (_) { ts = ""; }
        return {
            id: d.id,
            memo: String(data.memo || ""),
            createdAt: ts,
            createdBy: String(data.createdBy || "")
        };
    });

    return { backups };
}

// 특정 유저 데이터 초기화
async function handleResetUserData(request) {
    await assertAdmin(request);
    const { uid, resetAll } = request.data || {};

    if (resetAll) {
        // 전체 유저 데이터 초기화
        const usersSnap = await db.collection("users").get();
        let count = 0;
        for (const userDoc of usersSnap.docs) {
            // 초기화 전 자동 백업
            await db.collection("user_backups").add({
                uid: userDoc.id,
                data: userDoc.data(),
                memo: "전체 초기화 전 자동 백업",
                createdAt: new Date(),
                createdBy: request.auth.token.email || request.auth.uid
            });
            await db.collection("users").doc(userDoc.id).set({
                name: userDoc.data().name || "헌터",
                level: 1,
                points: 0,
                stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
                pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
                friends: [],
                pushEnabled: userDoc.data().pushEnabled || false,
                fcmToken: userDoc.data().fcmToken || null,
                syncEnabled: false,
                gpsEnabled: false
            });
            count++;
        }
        // 전체 초기화 시 usernames 컬렉션도 초기화 (재로그인 시 재등록됨)
        const usernamesSnap = await db.collection("usernames").get();
        const batch = db.batch();
        usernamesSnap.docs.forEach(d => batch.delete(d.ref));
        if (!usernamesSnap.empty) await batch.commit();
        console.log(`[resetUserData] All ${count} users reset, ${usernamesSnap.size} usernames cleared`);
        return { success: true, resetCount: count };
    }

    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) throw new HttpsError("not-found", "유저를 찾을 수 없습니다.");

    // 초기화 전 자동 백업
    await db.collection("user_backups").add({
        uid: String(uid),
        data: userDoc.data(),
        memo: "데이터 초기화 전 자동 백업",
        createdAt: new Date(),
        createdBy: request.auth.token.email || request.auth.uid
    });

    const existingData = userDoc.data();
    await db.collection("users").doc(uid).set({
        name: existingData.name || "헌터",
        level: 1,
        points: 0,
        stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
        pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
        friends: [],
        pushEnabled: existingData.pushEnabled || false,
        fcmToken: existingData.fcmToken || null,
        syncEnabled: false,
        gpsEnabled: false
    });

    console.log(`[resetUserData] User ${uid} data reset`);
    return { success: true };
}

// 특정 시점으로 롤백
async function handleRollbackUserData(request) {
    await assertAdmin(request);
    const { uid, backupId } = request.data || {};
    if (!uid || !backupId) throw new HttpsError("invalid-argument", "uid와 backupId는 필수입니다.");

    const backupDoc = await db.collection("user_backups").doc(backupId).get();
    if (!backupDoc.exists) throw new HttpsError("not-found", "백업을 찾을 수 없습니다.");

    const backupData = backupDoc.data();
    if (backupData.uid !== uid) throw new HttpsError("invalid-argument", "백업의 uid가 일치하지 않습니다.");

    // 롤백 전 현재 상태 백업
    const currentDoc = await db.collection("users").doc(uid).get();
    if (currentDoc.exists) {
        await db.collection("user_backups").add({
            uid: String(uid),
            data: currentDoc.data(),
            memo: `롤백 전 자동 백업 (→ ${backupId})`,
            createdAt: new Date(),
            createdBy: request.auth.token.email || request.auth.uid
        });
    }

    await db.collection("users").doc(uid).set(backupData.data);
    console.log(`[rollbackUserData] User ${uid} rolled back to backup ${backupId}`);
    return { success: true };
}

// 비밀번호 재설정 링크 생성
async function handleResetPassword(request) {
    await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    const user = await getAuth().getUser(uid);
    if (!user.email) throw new HttpsError("failed-precondition", "이메일이 없는 계정입니다.");

    const link = await getAuth().generatePasswordResetLink(user.email);
    console.log(`[resetPassword] Password reset link generated for ${user.email}`);
    return { success: true, email: user.email, link };
}

// 계정 사용 중지/활성화
async function handleDisableAccount(request) {
    await assertAdmin(request);
    const { uid, disabled } = request.data || {};
    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    await getAuth().updateUser(uid, { disabled: !!disabled });
    console.log(`[disableAccount] User ${uid} disabled: ${!!disabled}`);
    return { success: true, disabled: !!disabled };
}

// 계정 삭제
// 유저의 닉네임 예약 해제 (usernames 컬렉션에서 해당 uid의 문서 삭제)
async function releaseUsernameByUid(uid) {
    try {
        const snap = await db.collection("usernames").where("uid", "==", uid).get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        if (!snap.empty) {
            await batch.commit();
            console.log(`[releaseUsername] ${snap.size}개 닉네임 예약 해제 (uid: ${uid})`);
        }
    } catch (e) {
        console.warn(`[releaseUsername] 닉네임 해제 실패 (uid: ${uid}):`, e.message);
    }
}

async function handleDeleteAccount(request) {
    await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid) throw new HttpsError("invalid-argument", "uid는 필수입니다.");

    // 삭제 전 백업
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
        await db.collection("user_backups").add({
            uid: String(uid),
            data: userDoc.data(),
            memo: "계정 삭제 전 자동 백업",
            createdAt: new Date(),
            createdBy: request.auth.token.email || request.auth.uid
        });
        await db.collection("users").doc(uid).delete();
    }

    // 닉네임 예약 해제
    await releaseUsernameByUid(uid);

    await getAuth().deleteUser(uid);
    console.log(`[deleteAccount] User ${uid} deleted`);
    return { success: true };
}

// 사용자 본인 계정 삭제 (Google 정책 준수: 사용자가 직접 계정 삭제 가능)
async function handleDeleteMyAccount(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }
    const uid = request.auth.uid;

    // 삭제 전 백업
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
        await db.collection("user_backups").add({
            uid: String(uid),
            data: userDoc.data(),
            memo: "사용자 직접 계정 삭제 (Google 정책)",
            createdAt: new Date(),
            createdBy: request.auth.token.email || uid
        });
        await db.collection("users").doc(uid).delete();
    }

    // 프로필 이미지 삭제 (원본 + 썸네일)
    try {
        const bucket = getStorage().bucket();
        const [files] = await bucket.getFiles({ prefix: `profile_images/${uid}` });
        for (const file of files) {
            await file.delete();
            try { await bucket.file(`thumbs/${file.name}`).delete(); } catch (e) { }
        }
        console.log(`[deleteMyAccount] Profile images (+thumbs) deleted for ${uid}`);
    } catch (e) {
        console.warn(`[deleteMyAccount] 프로필 이미지 삭제 실패 (uid: ${uid}):`, e.message);
    }

    // 닉네임 예약 해제
    await releaseUsernameByUid(uid);

    // Firebase Auth 계정 삭제
    await getAuth().deleteUser(uid);
    console.log(`[deleteMyAccount] User ${uid} self-deleted`);
    return { success: true };
}

// 닉네임 일괄 마이그레이션: 모든 기존 유저의 name을 usernames 컬렉션에 등록
// 중복 닉네임은 선착순(레벨 높은 순) → 나머지는 #2, #3 등 접미사 부여
async function handleMigrateUsernames(request) {
    await assertAdmin(request);
    const usersSnap = await db.collection("users").get();

    // name → [{ uid, level }] 그룹핑
    const nameMap = {};
    usersSnap.docs.forEach(d => {
        const data = d.data();
        const name = (data.name || "").trim();
        if (!name) return;
        if (!nameMap[name]) nameMap[name] = [];
        nameMap[name].push({ uid: d.id, level: data.level || 1 });
    });

    // 기존 usernames 컬렉션 초기화
    const oldSnap = await db.collection("usernames").get();
    if (!oldSnap.empty) {
        const delBatch = db.batch();
        oldSnap.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
    }

    let claimed = 0;
    let renamed = 0;
    const renamedList = [];

    for (const [name, users] of Object.entries(nameMap)) {
        // 레벨 높은 순 정렬 → 1등이 원본 이름 선점
        users.sort((a, b) => b.level - a.level);

        for (let i = 0; i < users.length; i++) {
            const { uid } = users[i];
            if (i === 0) {
                // 원본 이름 선점
                const key = name.toLowerCase().replace(/\s+/g, ' ');
                await db.collection("usernames").doc(key).set({
                    uid, name, claimedAt: Date.now()
                });
                claimed++;
            } else {
                // 중복 → 접미사 부여
                let suffix = i + 1;
                let newName = `${name}#${suffix}`;
                let key = newName.toLowerCase().replace(/\s+/g, ' ');
                // 혹시 이미 존재하면 번호 올림
                while ((await db.collection("usernames").doc(key).get()).exists) {
                    suffix++;
                    newName = `${name}#${suffix}`;
                    key = newName.toLowerCase().replace(/\s+/g, ' ');
                }
                await db.collection("usernames").doc(key).set({
                    uid, name: newName, claimedAt: Date.now()
                });
                // users/{uid} 문서도 업데이트
                await db.collection("users").doc(uid).update({ name: newName });
                renamed++;
                renamedList.push({ uid: uid.substring(0, 8), from: name, to: newName });
            }
        }
    }

    console.log(`[migrateUsernames] claimed=${claimed}, renamed=${renamed}`, renamedList);
    return { success: true, claimed, renamed, renamedList };
}

// ─── 0. Ping + Admin API Router (Callable) ───
// Routes admin actions through the working ping function to bypass
// per-function Cloud Run deployment/IAM issues in Gen 2.

// ─── Admin: 유저 분석 핸들러 ───

async function handleGetUserAnalytics(request) {
    await assertAdmin(request);

    const usersSnap = await db.collection("users").get();
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    let totalUsers = 0;
    let active7d = 0;
    let active30d = 0;
    const langCount = {};
    const levelDistribution = { "1-10": 0, "11-30": 0, "31-50": 0, "51-100": 0, "100+": 0 };

    // 생년월일 / 기대 나이 / 개인정보 동의 통계
    let birthdaySetCount = 0;
    const expectAgeDistribution = {};
    const ageGroupDistribution = {};

    // ISBN 기반 많이 읽은 책 집계
    const bookCountMap = {}; // isbn -> { count, title, author, publisher, thumbnail }

    for (const doc of usersSnap.docs) {
        totalUsers++;
        const data = doc.data();

        // 활성 유저 계산 (streak 기반)
        try {
            const streak = JSON.parse(data.streakStr || "{}");
            if (streak.lastActiveDate) {
                const lastActive = new Date(streak.lastActiveDate).getTime();
                if ((now - lastActive) <= sevenDays) active7d++;
                if ((now - lastActive) <= thirtyDays) active30d++;
            }
        } catch (_) { /* ignore */ }

        // 언어/국적 집계
        const lang = data.lang || "ko";
        langCount[lang] = (langCount[lang] || 0) + 1;

        // 생년월일 / 기대 나이 분석
        try {
            const lifeStatus = JSON.parse(data.lifeStatusStr || "{}");
            if (lifeStatus.birthday) {
                birthdaySetCount++;
                const expectAge = lifeStatus.expectAge || 80;
                const eaKey = String(expectAge);
                expectAgeDistribution[eaKey] = (expectAgeDistribution[eaKey] || 0) + 1;

                const birth = new Date(lifeStatus.birthday);
                const ageDiff = now - birth.getTime();
                const currentAge = Math.floor(ageDiff / (365.25 * 24 * 60 * 60 * 1000));
                let ageGroup;
                if (currentAge < 10) ageGroup = "10세 미만";
                else if (currentAge < 20) ageGroup = "10대";
                else if (currentAge < 30) ageGroup = "20대";
                else if (currentAge < 40) ageGroup = "30대";
                else if (currentAge < 50) ageGroup = "40대";
                else if (currentAge < 60) ageGroup = "50대";
                else ageGroup = "60세 이상";
                ageGroupDistribution[ageGroup] = (ageGroupDistribution[ageGroup] || 0) + 1;
            }
        } catch (_) { /* ignore */ }

        // ISBN 기반 도서 집계 (libraryStr 파싱)
        try {
            const lib = JSON.parse(data.libraryStr || "{}");
            const books = Array.isArray(lib.books) ? lib.books : [];
            for (const book of books) {
                const isbn = book.isbn;
                if (!isbn) continue;
                if (!bookCountMap[isbn]) {
                    bookCountMap[isbn] = {
                        count: 0,
                        title: book.title || "",
                        author: book.author || "",
                        publisher: book.publisher || "",
                        thumbnail: book.thumbnail || ""
                    };
                }
                bookCountMap[isbn].count++;
            }
        } catch (_) { /* ignore */ }

        // 레벨 분포
        const lv = data.level || 1;
        if (lv <= 10) levelDistribution["1-10"]++;
        else if (lv <= 30) levelDistribution["11-30"]++;
        else if (lv <= 50) levelDistribution["31-50"]++;
        else if (lv <= 100) levelDistribution["51-100"]++;
        else levelDistribution["100+"]++;
    }

    // Firebase Auth에서 가입 경로 집계
    let signupGoogle = 0;
    let signupEmail = 0;
    let signupOther = 0;
    try {
        const listResult = await getAuth().listUsers(1000);
        for (const user of listResult.users) {
            const providers = user.providerData.map(p => p.providerId);
            if (providers.includes("google.com")) {
                signupGoogle++;
            } else if (providers.includes("password")) {
                signupEmail++;
            } else {
                signupOther++;
            }
        }
    } catch (e) {
        console.error("[getUserAnalytics] Auth listUsers failed:", e.message);
    }

    // Top 10 많이 읽은 책 (ISBN 기준, 등록 유저 수 내림차순)
    const topBooks = Object.entries(bookCountMap)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([isbn, info]) => ({
            isbn,
            title: info.title,
            author: info.author,
            publisher: info.publisher,
            thumbnail: info.thumbnail,
            count: info.count
        }));

    return {
        totalUsers,
        active7d,
        active30d,
        signupGoogle,
        signupEmail,
        signupOther,
        langCount,
        levelDistribution,
        birthdaySetCount,
        expectAgeDistribution,
        ageGroupDistribution,
        topBooks
    };
}

// ─── ISBN 도서 검색 (한국 도서 API 프록시) ───
async function handleLookupIsbn(request) {
    const isbn = (request.data?.isbn || "").replace(/[-\s]/g, "");
    if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
        throw new HttpsError("invalid-argument", "유효한 ISBN을 입력해주세요 (10자리 또는 13자리)");
    }

    // 1) 알라딘 API (한국 도서 검색 최우선)
    const aladinKey = process.env.ALADIN_TTB_KEY;
    if (aladinKey) {
        try {
            const idType = isbn.length === 13 ? "ISBN13" : "ISBN";
            const url = `http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${aladinKey}&itemIdType=${idType}&ItemId=${isbn}&output=js&Version=20131101&OptResult=packing`;
            const res = await fetch(url);
            let text = await res.text();
            // 알라딘 output=js는 JSONP 형태일 수 있음 — callback wrapper 제거
            text = text.replace(/^[^({]*\(/, "").replace(/\);?\s*$/, "");
            const data = JSON.parse(text);
            if (data.item && data.item.length > 0) {
                const item = data.item[0];
                return {
                    source: "aladin",
                    book: {
                        isbn: isbn,
                        title: item.title || "",
                        author: item.author || "",
                        publisher: item.publisher || "",
                        thumbnail: item.cover || "",
                        description: item.description || "",
                        pubDate: item.pubDate || "",
                        price: item.priceStandard || 0,
                        pages: (item.subInfo && item.subInfo.itemPage) || item.itemPage || 0,
                        url: item.link || ""
                    }
                };
            }
        } catch (e) {
            console.warn("[lookupIsbn] Aladin error:", e.message);
        }
    }

    // 2) 카카오 책 검색 API
    const kakaoKey = process.env.KAKAO_REST_API_KEY;
    if (kakaoKey) {
        try {
            const url = `https://dapi.kakao.com/v3/search/book?query=${isbn}&target=isbn`;
            const res = await fetch(url, {
                headers: { "Authorization": `KakaoAK ${kakaoKey}` }
            });
            const data = await res.json();
            if (data.documents && data.documents.length > 0) {
                const doc = data.documents[0];
                return {
                    source: "kakao",
                    book: {
                        isbn: isbn,
                        title: doc.title || "",
                        author: (doc.authors || []).join(", "),
                        publisher: doc.publisher || "",
                        thumbnail: doc.thumbnail || "",
                        description: doc.contents || "",
                        pubDate: doc.datetime ? doc.datetime.substring(0, 10) : "",
                        price: doc.price || 0,
                        url: doc.url || ""
                    }
                };
            }
        } catch (e) {
            console.warn("[lookupIsbn] Kakao error:", e.message);
        }
    }

    // 3) Google Books API (키 불필요 — 최종 폴백)
    try {
        const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.items && data.items.length > 0) {
            const vol = data.items[0].volumeInfo;
            return {
                source: "google",
                book: {
                    isbn: isbn,
                    title: vol.title || "",
                    author: (vol.authors || []).join(", "),
                    publisher: vol.publisher || "",
                    thumbnail: (vol.imageLinks && (vol.imageLinks.thumbnail || vol.imageLinks.smallThumbnail)) || "",
                    description: vol.description || "",
                    pubDate: vol.publishedDate || "",
                    pages: vol.pageCount || 0
                }
            };
        }
    } catch (e) {
        console.warn("[lookupIsbn] Google Books error:", e.message);
    }

    return { source: null, book: null };
}

// ─── 도서 키워드 검색 (제목/저자/출판사) ───
async function handleSearchBooks(request) {
    const query = (request.data?.query || "").trim();
    const page = Math.max(1, parseInt(request.data?.page) || 1);
    if (!query) {
        throw new HttpsError("invalid-argument", "검색어를 입력해주세요.");
    }

    // 1) 카카오 책 검색 API (키워드 검색)
    const kakaoKey = process.env.KAKAO_REST_API_KEY;
    if (kakaoKey) {
        try {
            const url = `https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(query)}&size=20&page=${page}`;
            const res = await fetch(url, {
                headers: { "Authorization": `KakaoAK ${kakaoKey}` }
            });
            const data = await res.json();
            if (data.documents && data.documents.length > 0) {
                const books = data.documents.map(doc => {
                    const isbns = (doc.isbn || "").split(" ").filter(Boolean);
                    return {
                        isbn: isbns[isbns.length - 1] || "",
                        title: doc.title || "",
                        author: (doc.authors || []).join(", "),
                        publisher: doc.publisher || "",
                        thumbnail: doc.thumbnail || "",
                        description: doc.contents || "",
                        pubDate: doc.datetime ? doc.datetime.substring(0, 10) : "",
                        price: doc.price || 0,
                        url: doc.url || "",
                        source: "kakao"
                    };
                });
                return {
                    books: books,
                    hasMore: !data.meta.is_end,
                    totalCount: data.meta.total_count || 0
                };
            }
        } catch (e) {
            console.warn("[searchBooks] Kakao error:", e.message);
        }
    }

    // 2) Google Books API 폴백
    try {
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&startIndex=${(page - 1) * 20}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.items && data.items.length > 0) {
            const books = data.items.map(item => {
                const vol = item.volumeInfo;
                const ids = vol.industryIdentifiers || [];
                const isbn13 = ids.find(i => i.type === "ISBN_13");
                const isbn10 = ids.find(i => i.type === "ISBN_10");
                return {
                    isbn: (isbn13 && isbn13.identifier) || (isbn10 && isbn10.identifier) || "",
                    title: vol.title || "",
                    author: (vol.authors || []).join(", "),
                    publisher: vol.publisher || "",
                    thumbnail: (vol.imageLinks && (vol.imageLinks.thumbnail || vol.imageLinks.smallThumbnail)) || "",
                    description: vol.description || "",
                    pubDate: vol.publishedDate || "",
                    pages: vol.pageCount || 0,
                    source: "google"
                };
            });
            return {
                books: books,
                hasMore: (data.totalItems || 0) > page * 20,
                totalCount: data.totalItems || 0
            };
        }
    } catch (e) {
        console.warn("[searchBooks] Google Books error:", e.message);
    }

    return { books: [], hasMore: false, totalCount: 0 };
}

exports.ping = onCall(pingCallableOpts, async (request) => {
    // ── Action router: handle admin actions via ping ──
    const action = request.data?.action;
    if (action) {
        try {
            switch (action) {
                case "getTestUsers":
                    return await handleGetTestUsers(request);
                case "getPushLogs":
                    return await handleGetPushLogs(request);
                case "sendTestNotification":
                    return await handleSendTestNotification(request);
                case "sendAnnouncement":
                    return await handleSendAnnouncement(request);
                case "getClientErrorLogs":
                    return await handleGetClientErrorLogs(request);
                case "adminListUsers":
                    return await handleAdminListUsers(request);
                case "backupUserData":
                    return await handleBackupUserData(request);
                case "listBackups":
                    return await handleListBackups(request);
                case "resetUserData":
                    return await handleResetUserData(request);
                case "rollbackUserData":
                    return await handleRollbackUserData(request);
                case "resetPassword":
                    return await handleResetPassword(request);
                case "disableAccount":
                    return await handleDisableAccount(request);
                case "deleteAccount":
                    return await handleDeleteAccount(request);
                case "deleteMyAccount":
                    return await handleDeleteMyAccount(request);
                case "screeningListPosts":
                    return await handleScreeningListPosts(request);
                case "screeningDeletePost":
                    return await handleScreeningDeletePost(request);
                case "screeningListReports":
                    return await handleScreeningListReports(request);
                case "screeningDismissReport":
                    return await handleScreeningDismissReport(request);
                case "migrateUsernames":
                    return await handleMigrateUsernames(request);
                case "listAdminOperators":
                    return await handleListAdminOperators(request);
                case "getUserAnalytics":
                    return await handleGetUserAnalytics(request);
                // ─── 자동 스크리닝 액션 ───
                case "autoScreenPost":
                    return await handleAutoScreenPost(request);
                case "batchScreenPosts":
                    return await handleBatchScreenPosts(request);
                case "batchScreenProfiles":
                    return await handleBatchScreenProfiles(request);
                case "getScreeningResults":
                    return await handleGetScreeningResults(request);
                case "reviewScreenedPost":
                    return await handleReviewScreenedPost(request);
                case "getScreeningConfig":
                    return await handleGetScreeningConfig(request);
                case "updateScreeningConfig":
                    return await handleUpdateScreeningConfig(request);
                case "getScreeningStats":
                    return await handleGetScreeningStats(request);
                // ─── ISBN 도서 검색 ───
                case "lookupIsbn":
                    return await handleLookupIsbn(request);
                // ─── 도서 키워드 검색 ───
                case "searchBooks":
                    return await handleSearchBooks(request);
                default:
                    throw new HttpsError("invalid-argument", "Unknown action: " + action);
            }
        } catch (e) {
            if (e instanceof HttpsError) throw e;
            console.error("[ping/" + action + "] Unhandled:", e);
            throw new HttpsError("internal", action + " failed: " + String(e.message || e).substring(0, 500));
        }
    }

    // ── Default: diagnostic ping ──
    const result = {
        ok: true,
        ts: new Date().toISOString(),
        auth: request.auth ? request.auth.token.email : null,
        node: process.version,
        region: process.env.FUNCTION_REGION || "unknown",
        firestore: null,
        fcm: null,
        diag: null
    };

    // Firestore 접근 테스트
    try {
        const snap = await db.collection("users").limit(1).get();
        result.firestore = "ok (" + snap.size + " docs)";
    } catch (e) {
        result.firestore = "FAIL: " + (e.code || "") + " " + (e.message || e);
    }

    // FCM 접근 테스트 (dry-run: 유효하지 않은 토큰으로 send 시도)
    try {
        await messaging.send({ token: "test-invalid-token", notification: { title: "ping" } }, true);
        result.fcm = "ok (dry-run)";
    } catch (e) {
        if (e.code === "messaging/invalid-argument" || e.code === "messaging/registration-token-not-registered") {
            result.fcm = "ok (API reachable, token invalid as expected)";
        } else {
            result.fcm = "FAIL: " + (e.code || "") + " " + (e.message || e);
        }
    }

    // 진단 모드
    if (request.data && request.data.diag) {
        const diag = {};
        diag.adminEmail = request.auth?.token?.email || null;
        diag.isAdmin = !!(request.auth?.token?.admin);

        try {
            const usersSnap = await db.collection("users")
                .where("pushEnabled", "==", true)
                .limit(5)
                .get();
            diag.pushUsers = "ok (" + usersSnap.size + " docs)";
        } catch (e) {
            diag.pushUsers = "FAIL: " + (e.code || "") + " " + (e.message || e);
        }

        try {
            const logsSnap = await db.collection("push_logs")
                .orderBy("timestamp", "desc")
                .limit(5)
                .get();
            diag.pushLogs = "ok (" + logsSnap.size + " docs)";
        } catch (e) {
            diag.pushLogs = "FAIL: " + (e.code || "") + " " + (e.message || e);
        }

        try {
            await messaging.send({ topic: "raid_alerts", notification: { title: "diag" } }, true);
            diag.fcmTopic = "ok (dry-run)";
        } catch (e) {
            diag.fcmTopic = "FAIL: " + (e.code || "") + " " + (e.message || e);
        }

        result.diag = diag;
    }

    return result;
});

// ─── 다국어 알림 메시지 ───

const MESSAGES = {
    raid_start: {
        ko: { title: "⚔️ 레이드 출현!", body: "이상 현상이 감지되었습니다. 지금 바로 참여하세요!" },
        en: { title: "⚔️ Raid Alert!", body: "An anomaly has been detected. Join the raid now!" },
        ja: { title: "⚔️ レイド出現!", body: "異常現象が検知されました。今すぐ参加しましょう!" }
    },
    daily_reminder: {
        ko: { title: "🎯 오늘의 퀘스트가 기다리고 있어요", body: "일일 퀘스트를 완료하고 경험치를 획득하세요!" },
        en: { title: "🎯 Daily quests are waiting", body: "Complete your daily quests and earn XP!" },
        ja: { title: "🎯 本日のクエストが待っています", body: "デイリークエストを完了してEXPを獲得しよう!" }
    },
    streak_warning: {
        ko: { title: "🔥 스트릭이 위험해요!", body: "2일째 미접속 중입니다. 내일까지 접속하지 않으면 스탯이 감소합니다!" },
        en: { title: "🔥 Your streak is at risk!", body: "You've been away for 2 days. Log in before tomorrow or your stats will decay!" },
        ja: { title: "🔥 ストリークが危険です!", body: "2日間未接続です。明日までにログインしないとステータスが減少します!" }
    },
    streak_broken: {
        ko: { title: "💔 스트릭이 끊어졌습니다", body: "스탯 감소가 시작됩니다. 지금 접속하여 다시 쌓아보세요!" },
        en: { title: "💔 Streak broken", body: "Stat decay has begun. Log in now to start rebuilding!" },
        ja: { title: "💔 ストリークが途切れました", body: "ステータス減少が始まりました。今すぐログインして立て直しましょう!" }
    }
};

/**
 * 사용자 언어에 맞는 메시지 반환
 */
function getLocalizedMessage(type, lang) {
    const msgs = MESSAGES[type];
    if (!msgs) return { title: "LEVEL UP: REBOOT", body: "" };
    return msgs[lang] || msgs.en || msgs.ko;
}

// ─── 1. 레이드 알림 (매일 06:00, 11:30, 19:00 KST — 레이드 오픈 시간과 동기화) ───

async function handleRaidAlert() {
    const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getHours();

    let slotLabel;
    if (kstHour <= 8) slotLabel = "06:00~08:00";
    else if (kstHour <= 13) slotLabel = "11:30~13:30";
    else slotLabel = "19:00~21:00";

    // 토픽 기반 발송 (pushEnabled 유저가 구독 중)
    const message = {
        topic: "raid_alerts",
        notification: {
            title: MESSAGES.raid_start.ko.title,
            body: MESSAGES.raid_start.ko.body
        },
        data: {
            tab: "dungeon",
            target: "dungeon",
            type: "raid_alert",
            slot: slotLabel,
            link: "levelup://tab/dungeon"
        },
        android: {
            priority: "high",
            notification: {
                channelId: "raid_alerts",
                sound: "default"
            }
        }
    };

    try {
        const response = await messaging.send(message);
        console.log(`[레이드 알림] ${slotLabel} 발송 완료:`, response);
    } catch (e) {
        console.error("[레이드 알림] 발송 실패:", e);
    }
}

const raidScheduleOpts = { timeZone: "Asia/Seoul", region: "asia-northeast3" };

exports.sendRaidAlert0600 = onSchedule({ schedule: "0 6 * * *", ...raidScheduleOpts }, handleRaidAlert);
exports.sendRaidAlert1130 = onSchedule({ schedule: "30 11 * * *", ...raidScheduleOpts }, handleRaidAlert);
exports.sendRaidAlert1900 = onSchedule({ schedule: "0 19 * * *", ...raidScheduleOpts }, handleRaidAlert);

// ─── 2. 일일 리마인더 (매일 09:00 KST) ───

exports.sendDailyReminder = onSchedule({
    schedule: "0 9 * * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    const message = {
        topic: "daily_reminder",
        notification: {
            title: MESSAGES.daily_reminder.ko.title,
            body: MESSAGES.daily_reminder.ko.body
        },
        data: {
            tab: "quests",
            target: "quests",
            type: "daily_reminder",
            link: "levelup://tab/quests"
        },
        android: {
            priority: "high",
            notification: {
                channelId: "daily_reminder",
                sound: "default"
            }
        }
    };

    try {
        const response = await messaging.send(message);
        console.log("[일일 리마인더] 발송 완료:", response);
    } catch (e) {
        console.error("[일일 리마인더] 발송 실패:", e);
    }
});

// ─── 3. 스트릭 위험 경고 (매일 21:00 KST — 2일 이상 미접속 유저에게 개별 발송) ───

exports.sendStreakWarnings = onSchedule({
    schedule: "0 21 * * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // pushEnabled이고 fcmToken이 있는 전체 유저 조회
    const usersSnap = await db.collection("users")
        .where("pushEnabled", "==", true)
        .get();

    let warningCount = 0;
    let brokenCount = 0;
    const invalidTokens = [];

    for (const doc of usersSnap.docs) {
        const data = doc.data();
        if (!data.fcmToken) continue;

        // streakStr에서 lastActiveDate 파싱
        let streak;
        try {
            streak = JSON.parse(data.streakStr || "{}");
        } catch {
            continue;
        }

        if (!streak.lastActiveDate) continue;

        const lastActive = new Date(streak.lastActiveDate);
        const diffDays = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));

        if (diffDays < 2) continue; // 최근 접속 유저는 스킵

        // 언어 감지 (Firestore에 저장된 언어 또는 기본 ko)
        const lang = data.lang || "ko";
        const isWarning = diffDays === 2;
        const msgType = isWarning ? "streak_warning" : "streak_broken";
        const msg = getLocalizedMessage(msgType, lang);

        const notification = {
            token: data.fcmToken,
            notification: {
                title: msg.title,
                body: msg.body
            },
            data: {
                tab: "status",
                target: "status",
                type: msgType,
                daysAway: String(diffDays),
                link: "levelup://tab/status"
            },
            android: {
                priority: "high",
                notification: {
                    channelId: "streak_warning",
                    sound: "default"
                }
            }
        };

        try {
            const response = await messaging.send(notification);
            if (isWarning) warningCount++;
            else brokenCount++;
            // Log successful send
            await db.collection("push_logs").add({
                timestamp: new Date(),
                type: msgType,
                target: String(data.fcmToken).substring(0, 20) + "...",
                success: true,
                messageId: String(response),
                sender: "system/sendStreakWarnings",
                uid: doc.id
            });
        } catch (e) {
            // 유효하지 않은 토큰 수집 (앱 삭제 등)
            if (e.code === "messaging/registration-token-not-registered" ||
                e.code === "messaging/invalid-registration-token") {
                invalidTokens.push(doc.id);
            }
            console.warn(`[스트릭 경고] ${doc.id} 발송 실패:`, e.code || e.message);
            // Log failed send
            try {
                await db.collection("push_logs").add({
                    timestamp: new Date(),
                    type: msgType,
                    target: String(data.fcmToken).substring(0, 20) + "...",
                    success: false,
                    error: String(e.code || e.message),
                    sender: "system/sendStreakWarnings",
                    uid: doc.id
                });
            } catch (_logErr) { /* ignore */ }
        }
    }

    // 유효하지 않은 토큰 정리
    for (const uid of invalidTokens) {
        await db.collection("users").doc(uid).update({
            fcmToken: null,
            pushEnabled: false
        });
    }

    console.log(`[스트릭 경고] 경고: ${warningCount}명, 끊어짐: ${brokenCount}명, 토큰 정리: ${invalidTokens.length}건`);
});

// ─── 4. 공지사항 수동 발송 (Callable Function — 관리자 전용) ───
// NOTE: Individual exports kept for direct invocation; primary path is via ping router.

exports.sendAnnouncement = onCall(callableOpts, async (request) => {
    try {
        return await handleSendAnnouncement(request);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", "sendAnnouncement crashed: " + (e.stack || e.message || String(e)));
    }
});

// ─── 5. FCM 토큰 갱신 시 Firestore 자동 업데이트 ───

exports.cleanupInactiveTokens = onSchedule({
    schedule: "0 3 * * 0",  // 매주 일요일 03:00 KST
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    // 30일 이상 미접속 유저의 토큰 정리
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const usersSnap = await db.collection("users")
        .where("pushEnabled", "==", true)
        .get();

    let cleanedCount = 0;

    for (const doc of usersSnap.docs) {
        const data = doc.data();
        if (!data.fcmToken) continue;

        let streak;
        try {
            streak = JSON.parse(data.streakStr || "{}");
        } catch {
            continue;
        }

        if (!streak.lastActiveDate) continue;

        const lastActive = new Date(streak.lastActiveDate);
        if (lastActive < thirtyDaysAgo) {
            await db.collection("users").doc(doc.id).update({
                fcmToken: null,
                pushEnabled: false
            });
            cleanedCount++;
        }
    }

    console.log(`[토큰 정리] ${cleanedCount}건의 비활성 토큰 정리 완료`);
});

// ─── 6. 테스트 푸시 발송 (Callable — 관리자 전용) ───

exports.sendTestNotification = onCall(callableOpts, async (request) => {
    try {
        return await handleSendTestNotification(request);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("[sendTestNotification] Unhandled:", e);
        throw new HttpsError("internal", "sendTestNotification crashed: " + String(e.message || e).substring(0, 500));
    }
});

// ─── 7. 푸시 활성 유저 목록 조회 (Callable — 관리자 전용) ───

exports.getTestUsers = onCall(callableOpts, async (request) => {
    try {
        return await handleGetTestUsers(request);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("[getTestUsers] Error:", e);
        throw new HttpsError("internal", "getTestUsers failed: " + String(e.message || e).substring(0, 500));
    }
});

// ─── 8. 발송 이력 조회 (Callable — 관리자 전용) ───

exports.getPushLogs = onCall(callableOpts, async (request) => {
    try {
        return await handleGetPushLogs(request);
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("[getPushLogs] Error:", e);
        throw new HttpsError("internal", "getPushLogs failed: " + String(e.message || e).substring(0, 500));
    }
});

// ─── 포스팅 스크리닝: 전체 Day1 포스트 목록 조회 (관리자 전용) ───

async function handleScreeningListPosts(request) {
    await assertAdmin(request);

    const usersSnap = await db.collection("users").where("hasActiveReels", "==", true).get();
    const now = Date.now();
    const allPosts = [];

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        if (!data.reelsStr) continue;
        try {
            const posts = JSON.parse(data.reelsStr);
            for (const post of posts) {
                const age = now - (post.timestamp || 0);
                if (age < 24 * 60 * 60 * 1000) {
                    allPosts.push({
                        ownerUid: userDoc.id,
                        ownerName: data.name || post.userName || "—",
                        ownerEmail: null, // filled below if needed
                        timestamp: post.timestamp,
                        dateKST: post.dateKST || "",
                        caption: post.caption || "",
                        photo: post.photo || "",
                        mood: post.mood || "",
                        remainingMs: (24 * 60 * 60 * 1000) - age,
                    });
                }
            }
        } catch (e) { /* skip malformed reelsStr */ }
    }

    // Sort newest first
    allPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    console.log(`[screeningListPosts] ${allPosts.length} active posts found`);
    return { posts: allPosts };
}

// ─── 포스팅 스크리닝: 강제 삭제 (관리자 전용) ───

async function handleScreeningDeletePost(request) {
    await assertAdmin(request);

    const { ownerUid, timestamp } = request.data || {};
    if (!ownerUid || !timestamp) {
        throw new HttpsError("invalid-argument", "ownerUid와 timestamp는 필수입니다.");
    }

    const userRef = db.collection("users").doc(ownerUid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
        throw new HttpsError("not-found", "유저를 찾을 수 없습니다.");
    }

    const data = userDoc.data();
    let posts = [];
    if (data.reelsStr) {
        try { posts = JSON.parse(data.reelsStr); } catch (e) { posts = []; }
    }

    const before = posts.length;
    posts = posts.filter(p => p.timestamp !== timestamp);
    const after = posts.length;

    if (before === after) {
        throw new HttpsError("not-found", "해당 포스트를 찾을 수 없습니다.");
    }

    // Update user document
    const hasActive = posts.some(p => (Date.now() - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
    await userRef.update({
        reelsStr: JSON.stringify(posts),
        hasActiveReels: hasActive,
    });

    // Delete associated reactions
    const postId = `${ownerUid}_${timestamp}`;
    try {
        await db.collection("reels_reactions").doc(postId).delete();
    } catch (e) { /* reactions doc may not exist */ }

    // Delete photo from Storage if it's a storage URL
    const deletedPost = data.reelsStr ? JSON.parse(data.reelsStr).find(p => p.timestamp === timestamp) : null;
    if (deletedPost?.photo && deletedPost.photo.includes("firebasestorage")) {
        try {
            const bucket = getStorage().bucket();
            const fileName = `reels_photos/${timestamp}.webp`;
            await bucket.file(fileName).delete();
            // 썸네일도 삭제
            try { await bucket.file(`thumbs/${fileName}`).delete(); } catch (e) { /* 썸네일 없을 수 있음 */ }
        } catch (e) {
            // Try jpg fallback
            try {
                const bucket = getStorage().bucket();
                await bucket.file(`reels_photos/${timestamp}.jpg`).delete();
                try { await bucket.file(`thumbs/reels_photos/${timestamp}.jpg`).delete(); } catch (e3) { }
            } catch (e2) { /* photo may not exist or different name */ }
        }
    }

    const adminEmail = request.auth.token.email || request.auth.uid;
    console.log(`[screeningDeletePost] Admin ${adminEmail} deleted post ${postId} from user ${ownerUid}`);

    return { success: true, deletedPostId: postId, remainingPosts: posts.length };
}

// ─── 신고 목록 조회 (관리자 전용) ───

async function handleScreeningListReports(request) {
    await assertAdmin(request);

    const reportsSnap = await db.collection("post_reports").orderBy("lastReportedAt", "desc").get();
    const reports = [];

    for (const doc of reportsSnap.docs) {
        const data = doc.data();
        const postId = data.postId || doc.id;

        // postId에서 ownerUid와 timestamp 추출하여 캡션/사진 가져오기
        const parts = postId.split("_");
        const ownerUid = parts.slice(0, -1).join("_");
        let caption = "";
        let photo = "";
        let ownerName = "";

        try {
            const userDoc = await db.collection("users").doc(ownerUid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                ownerName = userData.name || "";
                if (userData.reelsStr) {
                    const posts = JSON.parse(userData.reelsStr);
                    const ts = parseInt(parts[parts.length - 1], 10);
                    const post = posts.find(p => p.timestamp === ts);
                    if (post) {
                        caption = post.caption || "";
                        photo = post.photo || "";
                    }
                }
            }
        } catch (e) { /* skip */ }

        reports.push({
            postId: postId,
            ownerName: ownerName,
            caption: caption,
            photo: photo,
            reporters: data.reporters || [],
            reportCount: data.reportCount || 0,
            lastReportedAt: data.lastReportedAt || 0,
        });
    }

    console.log(`[screeningListReports] ${reports.length} reports found`);
    return { reports };
}

// ─── 신고 기각 (관리자 전용) ───

async function handleScreeningDismissReport(request) {
    await assertAdmin(request);

    const { postId } = request.data || {};
    if (!postId) {
        throw new HttpsError("invalid-argument", "postId는 필수입니다.");
    }

    await db.collection("post_reports").doc(postId).delete();

    const adminEmail = request.auth.token.email || request.auth.uid;
    console.log(`[screeningDismissReport] Admin ${adminEmail} dismissed report for ${postId}`);

    return { success: true, dismissedPostId: postId };
}

// ─── 자동 스크리닝: 기본 한국어 금칙어 사전 ───

const DEFAULT_SCREENING_KEYWORDS = {
    profanity: {
        keywords: ["시발", "씨발", "ㅅㅂ", "ㅆㅂ", "개새끼", "ㄱㅅㄲ", "병신", "ㅂㅅ", "지랄", "ㅈㄹ", "미친놈", "미친년", "꺼져", "닥쳐", "존나", "ㅈㄴ", "애미", "느금마", "좆", "보지"],
        severity: "medium",
        enabled: true
    },
    hate: {
        keywords: ["한남충", "한녀충", "틀딱", "급식충", "맘충", "장애인놈", "흑형", "짱깨", "쪽바리", "똥남아"],
        severity: "high",
        enabled: true
    },
    spam: {
        keywords: ["텔레그램", "카톡방", "오픈채팅", "부업", "재택알바", "고수익", "일당", "투자수익", "코인추천"],
        severity: "low",
        enabled: true
    },
    nsfw: {
        keywords: ["섹스", "야동", "포르노", "자위", "성인방", "음란", "벗방", "누드"],
        severity: "high",
        enabled: true
    },
    illegal: {
        keywords: ["대포통장", "마약", "필로폰", "대마", "도박사이트", "불법촬영", "몰카"],
        severity: "high",
        enabled: true
    }
};

const SEVERITY_ORDER = { low: 1, medium: 2, high: 3 };

// ─── 자동 스크리닝: 텍스트 스크리닝 유틸 ───

function screenCaption(caption, categories) {
    if (!caption || !categories) return [];
    const flags = [];
    const lowerCaption = caption.toLowerCase();

    for (const [catName, catConfig] of Object.entries(categories)) {
        if (!catConfig.enabled) continue;
        for (const keyword of (catConfig.keywords || [])) {
            if (lowerCaption.includes(keyword.toLowerCase())) {
                flags.push({
                    keyword,
                    category: catName,
                    severity: catConfig.severity || "low"
                });
            }
        }
    }
    return flags;
}

function getOverallSeverity(textFlags, imageFlags) {
    let maxSev = "low";
    let hasAnyFlag = false;

    for (const f of (textFlags || [])) {
        hasAnyFlag = true;
        if ((SEVERITY_ORDER[f.severity] || 0) > (SEVERITY_ORDER[maxSev] || 0)) {
            maxSev = f.severity;
        }
    }

    if (imageFlags) {
        const likelihoodSeverityMap = {
            VERY_LIKELY: "high",
            LIKELY: "high",
            POSSIBLE: "medium",
            UNLIKELY: "low",
            VERY_UNLIKELY: "low"
        };
        for (const [key, likelihood] of Object.entries(imageFlags)) {
            if (key.startsWith("_")) continue; // 메타데이터 필드 스킵 (_source, _nsfwScores 등)
            const sev = likelihoodSeverityMap[likelihood] || "low";
            if (sev !== "low") hasAnyFlag = true;
            if ((SEVERITY_ORDER[sev] || 0) > (SEVERITY_ORDER[maxSev] || 0)) {
                maxSev = sev;
            }
        }
    }

    return hasAnyFlag ? maxSev : null;
}

// ─── 자동 스크리닝: 이미지 다운로드 유틸 ───

async function downloadImage(photoUrl) {
    const https = require("https");
    const http = require("http");
    return new Promise((resolve, reject) => {
        const mod = photoUrl.startsWith("https") ? https : http;
        mod.get(photoUrl, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        }).on("error", reject);
    });
}

// ─── 자동 스크리닝: NSFWJS 1차 로컬 스크리닝 (무료) ───

function nsfwProbToLikelihood(probability) {
    if (probability > 0.85) return "VERY_LIKELY";
    if (probability > 0.65) return "LIKELY";
    if (probability > 0.35) return "POSSIBLE";
    if (probability > 0.15) return "UNLIKELY";
    return "VERY_UNLIKELY";
}

async function screenImageLocal(photoUrl) {
    const model = await getNsfwModel();
    if (!model || !photoUrl) return null;

    try {
        const tf = require("@tensorflow/tfjs");
        const sharp = require("sharp");
        const imageBuffer = await downloadImage(photoUrl);

        // sharp로 이미지 디코딩 → 224x224 RGB raw pixels
        const { data, info } = await sharp(imageBuffer)
            .resize(224, 224)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // raw pixel data → tf.tensor3d
        const decodedImage = tf.tensor3d(
            new Uint8Array(data),
            [info.height, info.width, 3]
        );
        const predictions = await model.classify(decodedImage);
        decodedImage.dispose();

        // predictions: [{className: "Porn"|"Sexy"|"Hentai"|"Neutral"|"Drawing", probability: 0~1}]
        const scores = {};
        for (const p of predictions) scores[p.className] = p.probability;

        return {
            porn: scores.Porn || 0,
            sexy: scores.Sexy || 0,
            hentai: scores.Hentai || 0,
            neutral: scores.Neutral || 0,
            drawing: scores.Drawing || 0,
        };
    } catch (e) {
        console.error("[screenImageLocal] NSFWJS 추론 실패:", e.message);
        return null;
    }
}

// ─── 자동 스크리닝: Azure Content Safety 2차 정밀 스크리닝 ───

function azureSeverityToLikelihood(severity) {
    if (severity >= 5) return "VERY_LIKELY";
    if (severity >= 4) return "LIKELY";
    if (severity >= 2) return "POSSIBLE";
    if (severity >= 1) return "UNLIKELY";
    return "VERY_UNLIKELY";
}

// Azure F0 한도 초과(429) 감지 시 자동 중단
let _azureRateLimited = false;
let _azureRateLimitedAt = 0;
const AZURE_RATE_LIMIT_COOLDOWN = 60 * 60 * 1000; // 1시간 후 재시도

async function screenImageAzure(photoUrl) {
    // 429 한도 초과 상태면 호출 스킵 (쿨다운 후 자동 재시도)
    if (_azureRateLimited) {
        if (Date.now() - _azureRateLimitedAt < AZURE_RATE_LIMIT_COOLDOWN) {
            return null;
        }
        // 쿨다운 경과 → 재시도 허용
        _azureRateLimited = false;
        console.log("[screenImageAzure] Azure 쿨다운 경과, 재시도 허용");
    }

    const client = getAzureClient();
    if (!client) {
        console.warn(`[screenImageAzure] Azure 클라이언트 사용 불가: ${getAzureInitError() || "알 수 없는 원인"}`);
        return null;
    }
    if (!photoUrl) return null;

    try {
        const imageBuffer = await downloadImage(photoUrl);
        const base64Content = imageBuffer.toString("base64");

        const result = await client.path("/image:analyze").post({
            body: {
                image: { content: base64Content },
                categories: ["Sexual", "Violence", "Hate", "SelfHarm"]
            }
        });

        if (result.status === "429") {
            _azureRateLimited = true;
            _azureRateLimitedAt = Date.now();
            console.error("[screenImageAzure] Azure F0 월간 한도 초과 (429). 1시간 동안 Azure 호출 중단, NSFWJS fallback 전환.");

            // Firestore에 한도 초과 알림 기록
            try {
                await db.collection("screening_config").doc("settings").set({
                    _azureRateLimitedAt: Date.now(),
                    _azureRateLimitMessage: "Azure Content Safety F0 월간 한도(5,000건) 초과. NSFWJS fallback으로 자동 전환됨."
                }, { merge: true });
            } catch (logErr) { /* 알림 기록 실패는 무시 */ }

            return null;
        }

        if (result.status !== "200") {
            console.error("[screenImageAzure] Azure API 오류:", result.status, result.body);
            return null;
        }

        const analysis = result.body.categoriesAnalysis || [];
        const getScore = (cat) => {
            const found = analysis.find(c => c.category === cat);
            return found ? found.severity : 0;
        };

        return {
            adult: azureSeverityToLikelihood(getScore("Sexual")),
            violence: azureSeverityToLikelihood(getScore("Violence")),
            racy: azureSeverityToLikelihood(getScore("Sexual")),
            hate: azureSeverityToLikelihood(getScore("Hate")),
            selfHarm: azureSeverityToLikelihood(getScore("SelfHarm"))
        };
    } catch (e) {
        console.error("[screenImageAzure] Azure Content Safety 호출 실패:", e.message);
        return null;
    }
}

// ─── 자동 스크리닝: 하이브리드 이미지 스크리닝 (NSFWJS → Azure) ───
//
// 1차: NSFWJS 로컬 추론 (무료, 성적 콘텐츠 감지)
//   → Porn/Hentai > 80% → 즉시 HIGH 플래그 (Azure 호출 안함)
//   → Neutral/Drawing > 90% → 통과 (Azure 호출 안함)
//   → 애매한 결과 (Sexy > 30% 등) → 2차 Azure 정밀 검사
// 2차: Azure Content Safety (유료, 전체 카테고리 감지)
//   → Sexual, Violence, Hate, SelfHarm 정밀 분석

async function screenImage(photoUrl, settings, meta) {
    if (!photoUrl) return null;

    // 1차: NSFWJS 로컬 스크리닝
    const localResult = await screenImageLocal(photoUrl);

    if (!localResult) {
        // NSFWJS 실패 (모델 로드 실패, 이미지 다운로드 실패 등)
        if (meta) {
            meta.nsfwjsVerdict = "error";
            meta.errors.push("NSFWJS 이미지 분석 실패 (모델 또는 이미지 오류)");
        }
        console.warn(`[screenImage] NSFWJS 1차 실패 → Azure fallback 시도`);
    } else {
        if (meta) meta.nsfwjsScores = localResult;

        // 명확한 부적절 이미지 → 즉시 플래그 (Azure 호출 불필요)
        if (localResult.porn > 0.80 || localResult.hentai > 0.80) {
            if (meta) meta.nsfwjsVerdict = "flagged";
            console.log(`[screenImage] NSFWJS 1차 판정: 부적절 (Porn=${localResult.porn.toFixed(2)}, Hentai=${localResult.hentai.toFixed(2)})`);
            return {
                adult: nsfwProbToLikelihood(localResult.porn),
                violence: "VERY_UNLIKELY",
                racy: nsfwProbToLikelihood(localResult.sexy),
                hate: "VERY_UNLIKELY",
                selfHarm: "VERY_UNLIKELY",
                _source: "nsfwjs",
                _nsfwScores: localResult
            };
        }

        // 명확한 일반 이미지 → 통과 (Azure 호출 불필요)
        if (localResult.neutral > 0.90 || localResult.drawing > 0.90) {
            if (meta) meta.nsfwjsVerdict = "safe";
            console.log(`[screenImage] NSFWJS 1차 판정: 안전 (Neutral=${localResult.neutral.toFixed(2)}, Drawing=${localResult.drawing.toFixed(2)})`);
            return null; // 플래그 없음
        }

        // 애매한 결과 → Azure 2차 검사 대상
        if (meta) meta.nsfwjsVerdict = "ambiguous";
        console.log(`[screenImage] NSFWJS 1차 판정: 애매 (Sexy=${localResult.sexy.toFixed(2)}, Porn=${localResult.porn.toFixed(2)}) → Azure 2차 검사`);
    }

    // 2차: Azure Content Safety 정밀 스크리닝 (NSFWJS 애매/실패 시)
    if (settings?.azureEnabled) {
        const azureResult = await screenImageAzure(photoUrl);
        if (azureResult) {
            azureResult._source = "azure";
            if (localResult) azureResult._nsfwScores = localResult;
            // Azure 결과에서 플래그 여부 판정
            const hasAzureFlag = ["adult", "violence", "racy", "hate", "selfHarm"].some(
                k => azureResult[k] && azureResult[k] !== "VERY_UNLIKELY" && azureResult[k] !== "UNLIKELY"
            );
            if (meta) meta.azureVerdict = hasAzureFlag ? "flagged" : "clean";
            console.log(`[screenImage] Azure 2차 판정: ${hasAzureFlag ? "플래그" : "정상"} (adult=${azureResult.adult}, violence=${azureResult.violence})`);
            return azureResult;
        } else {
            if (meta) {
                meta.azureVerdict = "error";
                meta.errors.push("Azure Content Safety 호출 실패 (API 오류/한도 초과/미설정)");
            }
            console.warn(`[screenImage] Azure 2차 실패 → NSFWJS fallback`);
        }
    }

    // NSFWJS 결과만으로 판정 (Azure 미사용 또는 실패 시)
    if (localResult && localResult.sexy > 0.30) {
        return {
            adult: nsfwProbToLikelihood(localResult.porn),
            violence: "VERY_UNLIKELY",
            racy: nsfwProbToLikelihood(localResult.sexy),
            hate: "VERY_UNLIKELY",
            selfHarm: "VERY_UNLIKELY",
            _source: "nsfwjs",
            _nsfwScores: localResult
        };
    }

    return null;
}

// ─── 자동 스크리닝: 스크리닝 설정 조회 ───

async function getScreeningConfig() {
    const settingsDoc = await db.collection("screening_config").doc("settings").get();
    const keywordsDoc = await db.collection("screening_config").doc("keywords").get();

    const settings = settingsDoc.exists ? settingsDoc.data() : {
        autoDeleteThreshold: "high",
        autoHideThreshold: "medium",
        imageScreeningEnabled: false,
        textScreeningEnabled: true,
        azureEnabled: false,
        notifyOnFlag: true
    };

    const keywords = keywordsDoc.exists ? keywordsDoc.data() : {
        categories: DEFAULT_SCREENING_KEYWORDS
    };

    return { settings, keywords };
}

// ─── 자동 스크리닝: 단일 포스트 스크리닝 실행 ───

async function executeScreening(post, config) {
    const { settings, keywords } = config;
    const postId = `${post.ownerUid}_${post.timestamp}`;

    // 실제 실행 추적 메타데이터 (verdict 기반)
    const meta = {
        textScreened: false,
        imageScreened: false,
        nsfwjsVerdict: null,    // "safe" | "flagged" | "ambiguous" | "error" | null
        nsfwjsScores: null,     // raw NSFWJS scores {porn, sexy, hentai, neutral, drawing}
        azureVerdict: null,      // "clean" | "flagged" | "error" | null
        errors: [],
    };

    // 텍스트 스크리닝
    let textFlags = [];
    if (settings.textScreeningEnabled) {
        meta.textScreened = true;
        textFlags = screenCaption(post.caption, keywords.categories);
    }

    // 이미지 스크리닝 (하이브리드: NSFWJS 1차 → Azure 2차)
    let imageFlags = null;
    if (settings.imageScreeningEnabled && post.photo) {
        meta.imageScreened = true;
        imageFlags = await screenImage(post.photo, settings, meta);
    }

    const overallSeverity = getOverallSeverity(textFlags, imageFlags);

    // 플래그 없음 → clean 또는 pending 판정
    if (!overallSeverity) {
        // NSFWJS 애매/오류 + Azure 실패 시 → 수동 검토 대기
        const needsReview = meta.imageScreened &&
            (meta.nsfwjsVerdict === "ambiguous" || meta.nsfwjsVerdict === "error") &&
            (meta.azureVerdict === "error" || meta.azureVerdict === null);
        const cleanStatus = needsReview ? "pending" : "clean";

        const cleanDoc = {
            postId,
            type: "planner",
            ownerUid: post.ownerUid,
            ownerName: post.ownerName || "",
            caption: post.caption || "",
            photo: post.photo || "",
            screenedAt: Date.now(),
            status: cleanStatus,
            overallSeverity: needsReview ? "low" : null,
            textFlags: [],
            imageFlags: null,
            engineData: meta.imageScreened ? {
                nsfwjsVerdict: meta.nsfwjsVerdict,
                nsfwjsScores: meta.nsfwjsScores,
                azureVerdict: meta.azureVerdict,
                errors: meta.errors.length > 0 ? meta.errors : null,
                needsReview: needsReview || null,
            } : null,
        };
        await db.collection("screening_results").doc(postId).set(cleanDoc);
        return { status: cleanStatus, _meta: meta };
    }

    // 자동 조치 결정
    let status = "pending";
    const sevLevel = SEVERITY_ORDER[overallSeverity] || 0;

    if (settings.autoDeleteThreshold && sevLevel >= SEVERITY_ORDER[settings.autoDeleteThreshold]) {
        status = "auto_deleted";
    } else if (settings.autoHideThreshold && sevLevel >= SEVERITY_ORDER[settings.autoHideThreshold]) {
        status = "auto_hidden";
    }

    const screeningResult = {
        postId,
        type: "planner",
        ownerUid: post.ownerUid,
        ownerName: post.ownerName || "",
        caption: post.caption || "",
        photo: post.photo || "",
        screenedAt: Date.now(),
        textFlags,
        imageFlags,
        overallSeverity,
        status,
        reviewedBy: null,
        reviewedAt: null,
        // 엔진 진단 데이터
        engineData: meta.imageScreened ? {
            nsfwjsVerdict: meta.nsfwjsVerdict,
            nsfwjsScores: meta.nsfwjsScores,
            azureVerdict: meta.azureVerdict,
            errors: meta.errors.length > 0 ? meta.errors : null,
        } : null,
    };

    // Firestore에 저장
    await db.collection("screening_results").doc(postId).set(screeningResult);

    // 자동 삭제 실행
    if (status === "auto_deleted") {
        try {
            await performAutoDelete(post.ownerUid, post.timestamp);
            console.log(`[AutoScreen] 자동 삭제 실행: ${postId} (severity: ${overallSeverity})`);
        } catch (e) {
            console.error(`[AutoScreen] 자동 삭제 실패: ${postId}`, e.message);
        }
    }

    screeningResult._meta = meta;
    return screeningResult;
}

// ─── 자동 스크리닝: 자동 삭제 실행 ───

async function performAutoDelete(ownerUid, timestamp) {
    const userRef = db.collection("users").doc(ownerUid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return;

    const data = userDoc.data();
    let posts = [];
    if (data.reelsStr) {
        try { posts = JSON.parse(data.reelsStr); } catch (e) { posts = []; }
    }

    posts = posts.filter(p => p.timestamp !== timestamp);
    const hasActive = posts.some(p => (Date.now() - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);

    await userRef.update({
        reelsStr: JSON.stringify(posts),
        hasActiveReels: hasActive,
    });

    // 리액션 삭제
    const postId = `${ownerUid}_${timestamp}`;
    try { await db.collection("reels_reactions").doc(postId).delete(); } catch (e) { }

    // 스토리지 사진 삭제 (원본 + 썸네일)
    try {
        const bucket = getStorage().bucket();
        await bucket.file(`reels_photos/${timestamp}.webp`).delete();
        try { await bucket.file(`thumbs/reels_photos/${timestamp}.webp`).delete(); } catch (e) { }
    } catch (e) {
        try {
            const bucket = getStorage().bucket();
            await bucket.file(`reels_photos/${timestamp}.jpg`).delete();
            try { await bucket.file(`thumbs/reels_photos/${timestamp}.jpg`).delete(); } catch (e3) { }
        } catch (e2) { }
    }
}

// ─── 자동 스크리닝: 프로필 이미지 스크리닝 실행 ───

async function executeProfileScreening(uid, photoURL, config) {
    const { settings } = config;
    const postId = `profile_${uid}`;

    const meta = {
        imageScreened: false,
        nsfwjsVerdict: null,
        nsfwjsScores: null,
        azureVerdict: null,
        errors: [],
    };

    // 이미지 스크리닝 (하이브리드: NSFWJS 1차 → Azure 2차)
    let imageFlags = null;
    if (settings.imageScreeningEnabled && photoURL) {
        meta.imageScreened = true;
        imageFlags = await screenImage(photoURL, settings, meta);
    }

    const overallSeverity = getOverallSeverity([], imageFlags);

    if (!overallSeverity) {
        const needsReview = meta.imageScreened &&
            (meta.nsfwjsVerdict === "ambiguous" || meta.nsfwjsVerdict === "error") &&
            (meta.azureVerdict === "error" || meta.azureVerdict === null);
        const cleanStatus = needsReview ? "pending" : "clean";

        const cleanDoc = {
            postId,
            type: "profile",
            ownerUid: uid,
            ownerName: "",
            photo: photoURL || "",
            screenedAt: Date.now(),
            status: cleanStatus,
            overallSeverity: needsReview ? "low" : null,
            textFlags: [],
            imageFlags: null,
            engineData: meta.imageScreened ? {
                nsfwjsVerdict: meta.nsfwjsVerdict,
                nsfwjsScores: meta.nsfwjsScores,
                azureVerdict: meta.azureVerdict,
                errors: meta.errors.length > 0 ? meta.errors : null,
                needsReview: needsReview || null,
            } : null,
        };
        await db.collection("screening_results").doc(postId).set(cleanDoc);
        return { status: cleanStatus, _meta: meta };
    }

    let status = "pending";
    const sevLevel = SEVERITY_ORDER[overallSeverity] || 0;

    if (settings.autoDeleteThreshold && sevLevel >= SEVERITY_ORDER[settings.autoDeleteThreshold]) {
        status = "auto_deleted";
    } else if (settings.autoHideThreshold && sevLevel >= SEVERITY_ORDER[settings.autoHideThreshold]) {
        status = "auto_hidden";
    }

    const screeningResult = {
        postId,
        type: "profile",
        ownerUid: uid,
        ownerName: "",
        photo: photoURL || "",
        screenedAt: Date.now(),
        textFlags: [],
        imageFlags,
        overallSeverity,
        status,
        reviewedBy: null,
        reviewedAt: null,
        engineData: meta.imageScreened ? {
            nsfwjsVerdict: meta.nsfwjsVerdict,
            nsfwjsScores: meta.nsfwjsScores,
            azureVerdict: meta.azureVerdict,
            errors: meta.errors.length > 0 ? meta.errors : null,
        } : null,
    };

    await db.collection("screening_results").doc(postId).set(screeningResult);

    // 프로필 이미지 자동 삭제: photoURL 필드 제거
    if (status === "auto_deleted") {
        try {
            await db.collection("users").doc(uid).update({ photoURL: null });
            const bucket = getStorage().bucket();
            const [files] = await bucket.getFiles({ prefix: `profile_images/${uid}` });
            for (const file of files) {
                await file.delete();
                try { await bucket.file(`thumbs/${file.name}`).delete(); } catch (e) { }
            }
            console.log(`[ProfileScreen] 프로필 이미지 자동 삭제: ${uid} (severity: ${overallSeverity})`);
        } catch (e) {
            console.error(`[ProfileScreen] 프로필 이미지 자동 삭제 실패: ${uid}`, e.message);
        }
    }

    screeningResult._meta = meta;
    return screeningResult;
}

// ─── 자동 스크리닝: 핸들러 — 프로필 일괄 스크리닝 ───

async function handleBatchScreenProfiles(request) {
    await assertAdmin(request);

    const { forceRescan } = request.data || {};
    const config = await getScreeningConfig();

    // forceRescan 시 기존 프로필 screening_results 삭제
    if (forceRescan) {
        const existingSnap = await db.collection("screening_results")
            .where("type", "==", "profile").get();
        if (existingSnap.size > 0) {
            const batch = db.batch();
            let batchCount = 0;
            for (const doc of existingSnap.docs) {
                batch.delete(doc.ref);
                batchCount++;
                if (batchCount >= 500) break;
            }
            await batch.commit();
            if (existingSnap.size > 500) {
                const batch2 = db.batch();
                for (const doc of existingSnap.docs.slice(500)) {
                    batch2.delete(doc.ref);
                }
                await batch2.commit();
            }
            console.log(`[batchScreenProfiles] forceRescan: deleted ${existingSnap.size} existing profile screening results`);
        }
    }

    // 프로필 이미지가 있는 모든 유저 조회
    const usersSnap = await db.collection("users").get();

    let screenedCount = 0;
    let flaggedCount = 0;
    let autoDeletedCount = 0;
    let autoHiddenCount = 0;
    let skippedCount = 0;
    let imageScreenedCount = 0;
    let imageFlaggedCount = 0;
    let nsfwjsCount = 0;
    let nsfwjsFlaggedCount = 0;
    let nsfwjsSafeCount = 0;
    let nsfwjsAmbiguousCount = 0;
    let nsfwjsErrorCount = 0;
    let azureCount = 0;
    let azureFlaggedCount = 0;
    let azureErrorCount = 0;

    const imageEnabled = !!config.settings.imageScreeningEnabled;
    const azureEnabled = !!config.settings.azureEnabled;

    // 엔진 구동 상태 사전 점검
    let nsfwjsModelReady = false;
    let nsfwjsModelError = null;
    let azureClientReady = false;
    let azureClientError = null;

    if (imageEnabled) {
        try {
            const model = await getNsfwModel();
            nsfwjsModelReady = !!model;
            if (!model) nsfwjsModelError = "NSFWJS 모델 로드 실패 (null 반환)";
        } catch (e) { nsfwjsModelError = e.message; }

        if (azureEnabled) {
            try {
                const client = getAzureClient();
                azureClientReady = !!client;
                if (!client) azureClientError = getAzureInitError() || "Azure 클라이언트 초기화 실패";
            } catch (e) { azureClientError = e.message; }
        }
    }

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const photoURL = data.photoURL;
        if (!photoURL || typeof photoURL !== "string" || !photoURL.startsWith("http")) continue;

        const postId = `profile_${userDoc.id}`;

        // 이미 스크리닝된 프로필은 스킵
        if (!forceRescan) {
            const existingDoc = await db.collection("screening_results").doc(postId).get();
            if (existingDoc.exists) { skippedCount++; continue; }
        }

        screenedCount++;
        const result = await executeProfileScreening(userDoc.id, photoURL, config);

        if (result && result._meta) {
            const m = result._meta;
            if (m.imageScreened) imageScreenedCount++;
            if (m.nsfwjsVerdict) {
                nsfwjsCount++;
                if (m.nsfwjsVerdict === "safe") nsfwjsSafeCount++;
                else if (m.nsfwjsVerdict === "flagged") nsfwjsFlaggedCount++;
                else if (m.nsfwjsVerdict === "ambiguous") nsfwjsAmbiguousCount++;
                else if (m.nsfwjsVerdict === "error") nsfwjsErrorCount++;
            }
            if (m.azureVerdict) {
                azureCount++;
                if (m.azureVerdict === "flagged") azureFlaggedCount++;
                else if (m.azureVerdict === "error") azureErrorCount++;
            }
            for (const err of (m.errors || [])) {
                console.warn(`[batchScreenProfiles] ${postId}: ${err}`);
            }
        }

        if (result && result.status !== "clean") {
            flaggedCount++;
            if (result.status === "auto_deleted") autoDeletedCount++;
            if (result.status === "auto_hidden") autoHiddenCount++;
            if (result.imageFlags) imageFlaggedCount++;
        }
    }

    const adminEmail = request.auth.token.email || request.auth.uid;
    console.log(`[batchScreenProfiles] Admin ${adminEmail}: screened=${screenedCount}, flagged=${flaggedCount}, skipped=${skippedCount}`);

    return {
        screenedCount,
        flaggedCount,
        autoDeletedCount,
        autoHiddenCount,
        skippedCount,
        detail: {
            imageEnabled,
            azureEnabled,
            nsfwjsModelReady,
            nsfwjsModelError,
            azureClientReady,
            azureClientError,
            imageScreenedCount,
            imageFlaggedCount,
            nsfwjsCount,
            nsfwjsFlaggedCount,
            nsfwjsSafeCount,
            nsfwjsAmbiguousCount,
            nsfwjsErrorCount,
            azureCount,
            azureFlaggedCount,
            azureErrorCount,
        }
    };
}

// ─── 자동 스크리닝: 핸들러 — 단일 포스트 스크리닝 ───

async function handleAutoScreenPost(request) {
    await assertAdmin(request);

    const { ownerUid, timestamp } = request.data || {};
    if (!ownerUid || !timestamp) {
        throw new HttpsError("invalid-argument", "ownerUid와 timestamp는 필수입니다.");
    }

    const config = await getScreeningConfig();

    // 포스트 데이터 가져오기
    const userDoc = await db.collection("users").doc(ownerUid).get();
    if (!userDoc.exists) throw new HttpsError("not-found", "유저를 찾을 수 없습니다.");

    const data = userDoc.data();
    let posts = [];
    if (data.reelsStr) {
        try { posts = JSON.parse(data.reelsStr); } catch (e) { posts = []; }
    }

    const post = posts.find(p => p.timestamp === timestamp);
    if (!post) throw new HttpsError("not-found", "포스트를 찾을 수 없습니다.");

    const result = await executeScreening({
        ownerUid,
        ownerName: data.name || post.userName || "",
        timestamp: post.timestamp,
        caption: post.caption || "",
        photo: post.photo || "",
    }, config);

    const flagged = result && result.status !== "clean";
    return { result: flagged ? result : null, flagged };
}

// ─── 자동 스크리닝: 핸들러 — 일괄 스크리닝 ───

async function handleBatchScreenPosts(request) {
    await assertAdmin(request);

    const { forceRescan } = request.data || {};
    const config = await getScreeningConfig();
    const usersSnap = await db.collection("users").where("hasActiveReels", "==", true).get();
    const now = Date.now();

    // forceRescan(전수조사) 시 기존 screening_results 전체 삭제 (고아 문서 정리)
    if (forceRescan) {
        const existingSnap = await db.collection("screening_results").get();
        const batch = db.batch();
        let batchCount = 0;
        for (const doc of existingSnap.docs) {
            batch.delete(doc.ref);
            batchCount++;
            if (batchCount >= 500) break; // Firestore batch limit
        }
        if (batchCount > 0) {
            await batch.commit();
            console.log(`[batchScreenPosts] forceRescan: deleted ${batchCount} existing screening results`);
        }
        // 500건 초과 시 추가 삭제
        if (existingSnap.size > 500) {
            const remaining = existingSnap.docs.slice(500);
            const batch2 = db.batch();
            for (const doc of remaining) {
                batch2.delete(doc.ref);
            }
            await batch2.commit();
            console.log(`[batchScreenPosts] forceRescan: deleted ${remaining.length} more screening results`);
        }
    }
    let screenedCount = 0;
    let flaggedCount = 0;
    let autoDeletedCount = 0;
    let autoHiddenCount = 0;
    let skippedCount = 0;

    // 실제 실행 기반 상세 통계 (verdict 기반)
    let textScreenedCount = 0;
    let textFlaggedCount = 0;
    let imageScreenedCount = 0;
    let imageFlaggedCount = 0;
    // NSFWJS 판정별 카운트
    let nsfwjsCount = 0;
    let nsfwjsFlaggedCount = 0;
    let nsfwjsSafeCount = 0;
    let nsfwjsAmbiguousCount = 0;
    let nsfwjsErrorCount = 0;
    // Azure 실제 호출 기반 카운트
    let azureCount = 0;
    let azureFlaggedCount = 0;
    let azureErrorCount = 0;

    const textEnabled = config.settings.textScreeningEnabled !== false;
    const imageEnabled = !!config.settings.imageScreeningEnabled;
    const azureEnabled = !!config.settings.azureEnabled;

    // 엔진 구동 상태 사전 점검
    let nsfwjsModelReady = false;
    let nsfwjsModelError = null;
    let azureClientReady = false;
    let azureClientError = null;

    if (imageEnabled) {
        try {
            const model = await getNsfwModel();
            nsfwjsModelReady = !!model;
            if (!model) nsfwjsModelError = "NSFWJS 모델 로드 실패 (null 반환)";
        } catch (e) {
            nsfwjsModelError = e.message;
        }
        console.log(`[batchScreenPosts] NSFWJS 엔진: ${nsfwjsModelReady ? "구동 성공" : "구동 실패 — " + nsfwjsModelError}`);

        if (azureEnabled) {
            try {
                const client = getAzureClient();
                azureClientReady = !!client;
                if (!client) azureClientError = getAzureInitError() || "Azure 클라이언트 초기화 실패 (알 수 없는 원인)";
            } catch (e) {
                azureClientError = e.message;
            }
            console.log(`[batchScreenPosts] Azure 엔진: ${azureClientReady ? "구동 성공" : "구동 실패 — " + azureClientError}`);
        }
    }

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        if (!data.reelsStr) continue;

        let posts = [];
        try { posts = JSON.parse(data.reelsStr); } catch (e) { continue; }

        for (const post of posts) {
            const age = now - (post.timestamp || 0);
            if (age >= 24 * 60 * 60 * 1000) continue;

            // 이미 스크리닝된 포스트는 스킵 (forceRescan 시 이미 전체 삭제됨)
            const postId = `${userDoc.id}_${post.timestamp}`;
            if (!forceRescan) {
                const existingDoc = await db.collection("screening_results").doc(postId).get();
                if (existingDoc.exists) { skippedCount++; continue; }
            }

            screenedCount++;
            const result = await executeScreening({
                ownerUid: userDoc.id,
                ownerName: data.name || post.userName || "",
                timestamp: post.timestamp,
                caption: post.caption || "",
                photo: post.photo || "",
            }, config);

            // _meta 기반 실제 실행 통계 집계 (verdict 기반)
            if (result && result._meta) {
                const m = result._meta;
                if (m.textScreened) textScreenedCount++;
                if (m.imageScreened) imageScreenedCount++;

                // NSFWJS 판정별 집계
                if (m.nsfwjsVerdict) {
                    nsfwjsCount++;
                    if (m.nsfwjsVerdict === "safe") nsfwjsSafeCount++;
                    else if (m.nsfwjsVerdict === "flagged") nsfwjsFlaggedCount++;
                    else if (m.nsfwjsVerdict === "ambiguous") nsfwjsAmbiguousCount++;
                    else if (m.nsfwjsVerdict === "error") nsfwjsErrorCount++;
                }

                // Azure 실제 호출 기반 집계 (호출된 건만 카운트)
                if (m.azureVerdict) {
                    azureCount++;
                    if (m.azureVerdict === "flagged") azureFlaggedCount++;
                    else if (m.azureVerdict === "error") azureErrorCount++;
                }

                // 오류 로그
                for (const err of (m.errors || [])) {
                    console.warn(`[batchScreenPosts] ${postId}: ${err}`);
                }
            }

            // 플래그 통계 (clean이 아닌 경우만)
            if (result && result.status !== "clean") {
                flaggedCount++;
                if (result.status === "auto_deleted") autoDeletedCount++;
                if (result.status === "auto_hidden") autoHiddenCount++;
                if (result.textFlags && result.textFlags.length > 0) textFlaggedCount++;
                if (result.imageFlags) imageFlaggedCount++;
            }
        }
    }

    const adminEmail = request.auth.token.email || request.auth.uid;
    console.log(`[batchScreenPosts] Admin ${adminEmail}: screened=${screenedCount}, flagged=${flaggedCount}, skipped=${skippedCount}, autoDeleted=${autoDeletedCount}, autoHidden=${autoHiddenCount}`);

    return {
        screenedCount,
        flaggedCount,
        autoDeletedCount,
        autoHiddenCount,
        skippedCount,
        detail: {
            textEnabled,
            imageEnabled,
            azureEnabled,
            // 엔진 구동 상태
            nsfwjsModelReady,
            nsfwjsModelError,
            azureClientReady,
            azureClientError,
            // 텍스트 상세
            textScreenedCount,
            textFlaggedCount,
            // 이미지 상세
            imageScreenedCount,
            imageFlaggedCount,
            // NSFWJS 판정별 상세
            nsfwjsCount,
            nsfwjsFlaggedCount,
            nsfwjsSafeCount,
            nsfwjsAmbiguousCount,
            nsfwjsErrorCount,
            // Azure 실제 호출 기반 상세
            azureCount,
            azureFlaggedCount,
            azureErrorCount,
        }
    };
}

// ─── 자동 스크리닝: 핸들러 — 스크리닝 결과 조회 ───

async function handleGetScreeningResults(request) {
    await assertAdmin(request);

    const { status, severity, type, limit: maxResults } = request.data || {};
    let q = db.collection("screening_results").orderBy("screenedAt", "desc");

    if (type) q = q.where("type", "==", type);
    if (status) q = q.where("status", "==", status);
    if (severity) q = q.where("overallSeverity", "==", severity);
    q = q.limit(maxResults || 100);

    const snap = await q.get();
    // 모든 상태의 결과를 반환 (clean 포함)
    const results = snap.docs.map(doc => doc.data());

    return { results };
}

// ─── 자동 스크리닝: 핸들러 — 관리자 승인/거부 ───

async function handleReviewScreenedPost(request) {
    await assertAdmin(request);

    const { postId, reviewAction } = request.data || {};
    if (!postId || !reviewAction) {
        throw new HttpsError("invalid-argument", "postId와 reviewAction은 필수입니다.");
    }
    if (!["approved", "rejected"].includes(reviewAction)) {
        throw new HttpsError("invalid-argument", "reviewAction은 'approved' 또는 'rejected'이어야 합니다.");
    }

    const docRef = db.collection("screening_results").doc(postId);
    const doc = await docRef.get();
    if (!doc.exists) {
        throw new HttpsError("not-found", "스크리닝 결과를 찾을 수 없습니다.");
    }

    const adminEmail = request.auth.token.email || request.auth.uid;
    await docRef.update({
        status: reviewAction,
        reviewedBy: adminEmail,
        reviewedAt: Date.now()
    });

    // 거부 시 포스트 삭제
    if (reviewAction === "rejected") {
        const data = doc.data();
        const parts = postId.split("_");
        const ownerUid = parts.slice(0, -1).join("_");
        const timestamp = parseInt(parts[parts.length - 1], 10);
        try {
            await performAutoDelete(ownerUid, timestamp);
        } catch (e) {
            console.error(`[reviewScreenedPost] 포스트 삭제 실패: ${postId}`, e.message);
        }
    }

    console.log(`[reviewScreenedPost] Admin ${adminEmail}: ${reviewAction} post ${postId}`);
    return { success: true, postId, reviewAction };
}

// ─── 자동 스크리닝: 핸들러 — 설정 조회 ───

async function handleGetScreeningConfig(request) {
    await assertAdmin(request);
    const config = await getScreeningConfig();
    return config;
}

// ─── 자동 스크리닝: 핸들러 — 설정 업데이트 ───

async function handleUpdateScreeningConfig(request) {
    await assertAdmin(request);

    const { settings, keywords } = request.data || {};

    if (settings) {
        await db.collection("screening_config").doc("settings").set(settings, { merge: true });
    }
    if (keywords) {
        await db.collection("screening_config").doc("keywords").set(keywords, { merge: true });
    }

    const adminEmail = request.auth.token.email || request.auth.uid;
    console.log(`[updateScreeningConfig] Admin ${adminEmail} updated screening config`);

    return { success: true };
}

// ─── 자동 스크리닝: 핸들러 — 스크리닝 통계 ───

async function handleGetScreeningStats(request) {
    await assertAdmin(request);

    const { type } = request.data || {};
    let snap;
    if (type) {
        snap = await db.collection("screening_results").where("type", "==", type).get();
    } else {
        snap = await db.collection("screening_results").get();
    }
    let total = 0, pending = 0, approved = 0, rejected = 0, autoDeleted = 0, autoHidden = 0, clean = 0;
    let byCategory = {};
    let bySeverity = { low: 0, medium: 0, high: 0 };

    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.status === "clean") { clean++; continue; } // clean은 플래그 통계에서 제외
        total++;
        switch (data.status) {
            case "pending": pending++; break;
            case "approved": approved++; break;
            case "rejected": rejected++; break;
            case "auto_deleted": autoDeleted++; break;
            case "auto_hidden": autoHidden++; break;
        }
        if (data.overallSeverity) {
            bySeverity[data.overallSeverity] = (bySeverity[data.overallSeverity] || 0) + 1;
        }
        for (const flag of (data.textFlags || [])) {
            byCategory[flag.category] = (byCategory[flag.category] || 0) + 1;
        }
    }

    // Azure 한도 초과 상태 포함
    let azureRateLimited = null;
    try {
        const settingsDoc = await db.collection("screening_config").doc("settings").get();
        if (settingsDoc.exists) {
            const s = settingsDoc.data();
            if (s._azureRateLimitedAt) azureRateLimited = s._azureRateLimitedAt;
        }
    } catch (e) { /* ignore */ }

    return { total, pending, approved, rejected, autoDeleted, autoHidden, clean, byCategory, bySeverity, azureRateLimited };
}

// --- 만료 릴스 사진 정리 (매일 04:00 KST) ---
exports.cleanupExpiredReelsPhotos = onSchedule({
    schedule: "0 4 * * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix: "reels_photos/" });
    const cutoff = Date.now() - (25 * 60 * 60 * 1000);

    let deletedCount = 0;
    for (const file of files) {
        const filename = file.name.split("/").pop().replace(/\.(jpg|jpeg|webp|png)$/i, "");
        const ts = parseInt(filename, 10);
        if (!isNaN(ts) && ts < cutoff) {
            await file.delete();
            // 썸네일도 삭제
            try { await bucket.file(`thumbs/${file.name}`).delete(); } catch (e) { /* 썸네일 없을 수 있음 */ }
            deletedCount++;
        }
    }
    console.log(`[Storage Cleanup] ${deletedCount}개 만료 릴스 사진(+썸네일) 삭제 완료`);

    // hasActiveReels 리셋: 활성 릴스가 없는 사용자 정리
    const usersSnap = await db.collection("users").where("hasActiveReels", "==", true).get();
    let resetCount = 0;
    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        if (data.reelsStr) {
            try {
                const posts = JSON.parse(data.reelsStr);
                const hasValid = posts.some(p => (Date.now() - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
                if (!hasValid) {
                    await userDoc.ref.update({ hasActiveReels: false });
                    resetCount++;
                }
            } catch(e) {
                await userDoc.ref.update({ hasActiveReels: false });
                resetCount++;
            }
        } else {
            await userDoc.ref.update({ hasActiveReels: false });
            resetCount++;
        }
    }
    console.log(`[Reels Cleanup] ${resetCount}명 hasActiveReels 리셋 완료`);
});

// 매일 04:00 KST — 만료된 플래너 사진 자동 삭제 (25시간 보존)
exports.cleanupExpiredPlannerPhotos = onSchedule({
    schedule: "0 4 * * *",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix: "planner_photos/" });
    const cutoffDate = new Date(Date.now() - (25 * 60 * 60 * 1000));
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    let deletedCount = 0;
    for (const file of files) {
        const filename = file.name.split("/").pop().replace(/\.(jpg|jpeg|webp|png)$/i, "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(filename) && filename <= cutoffStr) {
            await file.delete();
            // 썸네일도 삭제
            try { await bucket.file(`thumbs/${file.name}`).delete(); } catch (e) { /* 썸네일 없을 수 있음 */ }
            deletedCount++;
        }
    }
    console.log(`[Storage Cleanup] ${deletedCount}개 만료 플래너 사진(+썸네일) 삭제 완료`);
});

// ─── 이미지 썸네일 자동 생성 (Storage trigger) ───

const THUMB_PREFIX = "thumbs/";
const THUMB_WIDTH = 240;
const THUMB_QUALITY = 80;
const ALLOWED_PREFIXES = ["reels_photos/", "profile_images/", "planner_photos/"];

// Cache-Control 매핑 (원본 업로드 시 설정과 동일)
const CACHE_CONTROL_MAP = {
    "reels_photos/": "public, max-age=86400",
    "profile_images/": "public, max-age=604800, immutable",
    "planner_photos/": "no-cache",
};

exports.generateThumbnail = onObjectFinalized({
    region: "asia-northeast3",
    memory: "256MiB",
    timeoutSeconds: 60,
}, async (event) => {
    const filePath = event.data.name; // e.g. "reels_photos/uid/123.webp"
    const contentType = event.data.contentType;

    // 무한루프 방지: thumbs/ 경로는 무시
    if (filePath.startsWith(THUMB_PREFIX)) {
        return;
    }

    // 이미지 파일만 처리
    if (!contentType || !contentType.startsWith("image/")) {
        return;
    }

    // 허용된 경로(reels_photos/, profile_images/, planner_photos/)만 처리
    const matchedPrefix = ALLOWED_PREFIXES.find(p => filePath.startsWith(p));
    if (!matchedPrefix) {
        return;
    }

    const sharp = require("sharp");
    const bucket = getStorage().bucket();
    const thumbPath = `${THUMB_PREFIX}${filePath}`;

    try {
        // 원본 다운로드
        const [originalBuffer] = await bucket.file(filePath).download();

        // sharp로 리사이즈: 240px 너비, WebP, quality 80
        const thumbBuffer = await sharp(originalBuffer)
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: THUMB_QUALITY })
            .toBuffer();

        // 썸네일 업로드
        const thumbFile = bucket.file(thumbPath);
        await thumbFile.save(thumbBuffer, {
            metadata: {
                contentType: "image/webp",
                cacheControl: CACHE_CONTROL_MAP[matchedPrefix] || "public, max-age=86400",
            },
        });

        const reduction = originalBuffer.length > 0
            ? Math.round((1 - thumbBuffer.length / originalBuffer.length) * 100)
            : 0;
        console.log(`[Thumbnail] ${filePath} → ${thumbPath} (${originalBuffer.length} → ${thumbBuffer.length} bytes, -${reduction}%)`);
    } catch (e) {
        console.error(`[Thumbnail] 썸네일 생성 실패 (${filePath}):`, e.message);
    }
});
