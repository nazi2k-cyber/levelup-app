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

// ─── Admin claim helper ───

const ADMIN_EMAILS = ["nazi2k@gmail.com"];

async function assertAdmin(request) {
    if (request.auth?.token?.admin) return;

    // Fallback: check admin email list + verify/repair custom claim
    const email = request.auth?.token?.email;
    if (email && ADMIN_EMAILS.includes(email)) {
        // Token custom claim missing — re-verify from Auth server
        try {
            const user = await getAuth().getUser(request.auth.uid);
            if (user.customClaims?.admin) return; // claim exists server-side, token was stale
            // Claim not set yet — set it now for future requests
            await getAuth().setCustomUserClaims(request.auth.uid, { admin: true });
            console.log("[assertAdmin] Auto-repaired admin claim for", email);
        } catch (e) {
            console.error("[assertAdmin] Claim repair failed:", e.message);
        }
        return; // Allow through since email is in admin list
    }

    throw new HttpsError("permission-denied", "권한이 없습니다.");
}

// ─── setAdminClaim: 관리자 Custom Claims 설정 (기존 관리자만 호출 가능) ───

exports.setAdminClaim = onCall(callableOpts, async (request) => {
    await assertAdmin(request);

    const { uid } = request.data || {};
    if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid는 필수 문자열입니다.");
    }

    await getAuth().setCustomUserClaims(uid, { admin: true });
    console.log(`[setAdminClaim] admin claim set for uid: ${uid}`);
    return { success: true, uid };
});

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
            type: "test_" + (type || "raid_start")
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

    const message = {
        topic: "announcements",
        notification: { title, body },
        data: {
            tab: targetTab || "",
            type: "announcement"
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
            type: "raid_alert",
            slot: slotLabel
        },
        android: {
            priority: "high",
            notification: {
                channelId: "raid_alerts",
                sound: "default",
                clickAction: "FLUTTER_NOTIFICATION_CLICK"
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
            type: "daily_reminder"
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
                type: msgType,
                daysAway: String(diffDays)
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
        const filename = file.name.split("/").pop().replace(".jpg", "");
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
