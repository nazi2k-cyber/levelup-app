const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// Callable 함수 공통 옵션 (Gen 2 Cloud Run 호환)
const callableOpts = {
    region: "asia-northeast3",
    cors: true,
    invoker: "public"
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

            users.push({
                uid: String(doc.id),
                displayName: String(data.displayName || data.nickname || doc.id.substring(0, 8)),
                lang: String(data.lang || "ko"),
                fcmToken: data.fcmToken ? String(data.fcmToken) : null,
                lastActiveDate,
                diffDays
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
            logs.push({
                id: String(doc.id),
                timestamp: ts,
                type: String(data.type || ""),
                target: String(data.target || ""),
                success: !!data.success,
                messageId: data.messageId ? String(data.messageId) : null,
                error: data.error ? String(data.error) : null,
                sender: data.sender ? String(data.sender) : null
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

    try {
        const response = await messaging.send(message);
        console.log("[sendTestNotification] FCM success:", response);

        await db.collection("push_logs").add({
            timestamp: new Date(),
            type: String(type || "raid_start"),
            target: String(target),
            success: true,
            messageId: String(response),
            sender: String(callerEmail)
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
                sender: String(callerEmail)
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

    // 프로필 이미지 삭제
    try {
        const bucket = getStorage().bucket();
        const [files] = await bucket.getFiles({ prefix: `profile_images/${uid}` });
        for (const file of files) {
            await file.delete();
        }
        console.log(`[deleteMyAccount] Profile images deleted for ${uid}`);
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

exports.ping = onCall(callableOpts, async (request) => {
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
            await messaging.send(notification);
            if (isWarning) warningCount++;
            else brokenCount++;
        } catch (e) {
            // 유효하지 않은 토큰 수집 (앱 삭제 등)
            if (e.code === "messaging/registration-token-not-registered" ||
                e.code === "messaging/invalid-registration-token") {
                invalidTokens.push(doc.id);
            }
            console.warn(`[스트릭 경고] ${doc.id} 발송 실패:`, e.code || e.message);
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
        } catch (e) {
            // Try jpg fallback
            try {
                const bucket = getStorage().bucket();
                await bucket.file(`reels_photos/${timestamp}.jpg`).delete();
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
            deletedCount++;
        }
    }
    console.log(`[Storage Cleanup] ${deletedCount}개 만료 릴스 사진 삭제 완료`);

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
