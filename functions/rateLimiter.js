const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");

const db = getFirestore();

/**
 * Firestore 기반 슬라이딩 윈도우 Rate Limiter
 * @param {string} uid - 사용자 UID
 * @param {string} action - 액션 식별자 (e.g., 'sendTest', 'listUsers')
 * @param {number} maxCalls - 윈도우 내 최대 허용 호출 횟수
 * @param {number} windowSeconds - 슬라이딩 윈도우 크기 (초)
 * @throws {HttpsError} - 한도 초과 시 resource-exhausted 에러
 */
async function checkRateLimit(uid, action, maxCalls, windowSeconds) {
    const docId = `${uid}_${action}`;
    const ref = db.collection("rate_limits").doc(docId);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        const windowMs = windowSeconds * 1000;

        if (!snap.exists) {
            tx.set(ref, {
                uid,
                action,
                calls: 1,
                windowStart: now,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return;
        }

        const data = snap.data();

        if (now - data.windowStart > windowMs) {
            tx.set(ref, {
                uid,
                action,
                calls: 1,
                windowStart: now,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return;
        }

        if (data.calls >= maxCalls) {
            const resetInSeconds = Math.ceil((data.windowStart + windowMs - now) / 1000);
            throw new HttpsError(
                "resource-exhausted",
                `요청 한도 초과. ${resetInSeconds}초 후 다시 시도해주세요.`
            );
        }

        tx.update(ref, {
            calls: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
}

module.exports = { checkRateLimit };
