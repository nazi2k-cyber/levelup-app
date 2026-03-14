const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// Callable 함수 공통 옵션 (Gen 2 Cloud Run 호환)
const callableOpts = {
    region: "asia-northeast3",
    cors: true,
    invoker: "public"
};

// ─── 0. 진단용 Ping (Callable) ───

exports.ping = onCall(callableOpts, async (request) => {
    const result = {
        ok: true,
        ts: new Date().toISOString(),
        auth: request.auth ? request.auth.token.email : null,
        node: process.version,
        region: process.env.FUNCTION_REGION || "unknown",
        firestore: null,
        fcm: null
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
        // messaging/invalid-argument = FCM API 연결 성공 (토큰만 무효)
        if (e.code === "messaging/invalid-argument" || e.code === "messaging/registration-token-not-registered") {
            result.fcm = "ok (API reachable, token invalid as expected)";
        } else {
            result.fcm = "FAIL: " + (e.code || "") + " " + (e.message || e);
        }
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

// ─── 1. 레이드 알림 (매일 05:55, 11:25, 18:55 KST — 레이드 시작 5분 전) ───

async function handleRaidAlert() {
    const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getHours();

    let slotLabel;
    if (kstHour <= 6) slotLabel = "06:00~08:00";
    else if (kstHour <= 12) slotLabel = "11:30~13:30";
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

exports.sendRaidAlert0555 = onSchedule({ schedule: "55 5 * * *", ...raidScheduleOpts }, handleRaidAlert);
exports.sendRaidAlert1125 = onSchedule({ schedule: "25 11 * * *", ...raidScheduleOpts }, handleRaidAlert);
exports.sendRaidAlert1855 = onSchedule({ schedule: "55 18 * * *", ...raidScheduleOpts }, handleRaidAlert);

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

exports.sendAnnouncement = onCall(callableOpts, async (request) => {
    // 관리자 인증 확인
    const callerEmail = request.auth?.token?.email;
    if (callerEmail !== "nazi2k@gmail.com") {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    const { title, body, targetTab } = request.data;
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

    try {
        const response = await messaging.send(message);
        console.log("[공지사항] 발송 완료:", response);
        return { success: true, messageId: response };
    } catch (e) {
        console.error("[공지사항] 발송 실패:", e);
        throw new HttpsError("unknown", "공지사항 발송 실패: " + e.message);
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
    const callerEmail = request.auth?.token?.email;
    if (callerEmail !== "nazi2k@gmail.com") {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    const { token, topic, type, lang, customTitle, customBody } = request.data;
    if (!token && !topic) {
        throw new HttpsError("invalid-argument", "token 또는 topic은 필수입니다.");
    }

    let notification;
    if (type === "custom") {
        if (!customTitle || !customBody) throw new HttpsError("invalid-argument", "커스텀 알림은 제목과 본문이 필수입니다.");
        notification = { title: customTitle, body: customBody };
    } else {
        notification = getLocalizedMessage(type || "raid_start", lang || "ko");
    }

    const message = {
        notification,
        data: {
            tab: "status",
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

    if (token) message.token = token;
    else message.topic = topic;

    const target = token ? token.substring(0, 20) + "..." : "topic:" + topic;

    try {
        const response = await messaging.send(message);

        // 발송 이력 기록
        await db.collection("push_logs").add({
            timestamp: new Date(),
            type: type || "raid_start",
            target,
            success: true,
            messageId: response,
            sender: callerEmail
        });

        console.log("[테스트 발송] 성공:", response);
        return { success: true, messageId: response };
    } catch (e) {
        // 실패 이력 기록
        await db.collection("push_logs").add({
            timestamp: new Date(),
            type: type || "raid_start",
            target,
            success: false,
            error: e.code || e.message,
            sender: callerEmail
        });

        console.error("[테스트 발송] 실패:", e);
        throw new HttpsError("unknown", "발송 실패: " + (e.code || e.message));
    }
});

// ─── 7. 푸시 활성 유저 목록 조회 (Callable — 관리자 전용) ───

exports.getTestUsers = onCall(callableOpts, async (request) => {
    const callerEmail = request.auth?.token?.email;
    if (callerEmail !== "nazi2k@gmail.com") {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    try {
        const usersSnap = await db.collection("users")
            .where("pushEnabled", "==", true)
            .limit(100)
            .get();

        const now = new Date();
        const users = usersSnap.docs.map(doc => {
            const data = doc.data();
            let lastActiveDate = null;
            let diffDays = null;
            try {
                const streak = JSON.parse(data.streakStr || "{}");
                if (streak.lastActiveDate) {
                    lastActiveDate = streak.lastActiveDate;
                    diffDays = Math.floor((now - new Date(streak.lastActiveDate)) / (1000 * 60 * 60 * 24));
                }
            } catch { /* ignore */ }

            return {
                uid: doc.id,
                displayName: data.displayName || data.nickname || doc.id.substring(0, 8),
                lang: data.lang || "ko",
                fcmToken: data.fcmToken || null,
                lastActiveDate,
                diffDays
            };
        });
        return { users };
    } catch (e) {
        console.error("[getTestUsers] Error:", e);
        throw new HttpsError("unknown", "유저 목록 조회 실패: " + e.message);
    }
});

// ─── 8. 발송 이력 조회 (Callable — 관리자 전용) ───

exports.getPushLogs = onCall(callableOpts, async (request) => {
    const callerEmail = request.auth?.token?.email;
    if (callerEmail !== "nazi2k@gmail.com") {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    try {
        const logsSnap = await db.collection("push_logs")
            .orderBy("timestamp", "desc")
            .limit(50)
            .get();

        const logs = logsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                timestamp: data.timestamp?.toDate?.() ? data.timestamp.toDate().toISOString() : String(data.timestamp),
                type: data.type,
                target: data.target,
                success: data.success,
                messageId: data.messageId || null,
                error: data.error || null,
                sender: data.sender
            };
        });
        return { logs };
    } catch (e) {
        console.error("[getPushLogs] Error:", e);
        throw new HttpsError("unknown", "로그 조회 실패: " + e.message);
    }
});
