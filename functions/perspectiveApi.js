// ─── Google Perspective API — 텍스트 독성 분석 ───
//
// 무료 쿼터: 1 QPS (초당 1건)
// 엔드포인트: https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze
// 환경 변수: PERSPECTIVE_API_KEY (Firebase Functions secret)
//
// 지원 언어: 한국어(ko), 영어(en) 자동 감지
// 독성 점수 0~1 → 0.7 이상 high, 0.5~0.7 medium, 0.3~0.5 low

const PERSPECTIVE_ENDPOINT =
    "https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze";

// 카테고리별 임계값: 일반 속성은 0.7/0.5/0.3, 심각 속성은 한 단계 낮게 판정
const SCORE_THRESHOLDS = { high: 0.70, medium: 0.50, low: 0.30 };

// 심각 속성 — 점수가 낮아도 한 단계 상향
const HIGH_PRIORITY_ATTRS = new Set(["severe_toxicity", "identity_attack", "threat"]);

// 1 QPS 인메모리 레이트 리미터 (콜드 스타트마다 초기화됨)
let _lastCallAt = 0;
const MIN_INTERVAL_MS = 1100; // 1.1초 간격 (1 QPS + 여유)

// 쿼터 초과 시 자동 중단 상태
let _quotaExceeded = false;
let _quotaExceededAt = 0;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000; // 10분 냉각

function isEnabled() {
    return !!process.env.PERSPECTIVE_API_KEY;
}

function getStatus() {
    if (!isEnabled()) return { enabled: false, reason: "PERSPECTIVE_API_KEY 미설정" };
    if (_quotaExceeded) {
        const remaining = Math.max(0, QUOTA_COOLDOWN_MS - (Date.now() - _quotaExceededAt));
        if (remaining > 0) {
            return { enabled: false, reason: `쿼터 초과 냉각 중 (${Math.ceil(remaining / 1000)}초 남음)` };
        }
        _quotaExceeded = false;
    }
    return { enabled: true };
}

/**
 * Perspective API 텍스트 분석
 * @param {string} text 분석할 텍스트 (최대 3000자)
 * @param {string} [language="ko"] 언어 코드
 * @returns {Promise<Object|null>} 속성별 점수 맵 또는 null(비활성/실패)
 */
async function screenTextPerspective(text, language) {
    if (!text || !text.trim()) return null;

    const status = getStatus();
    if (!status.enabled) {
        if (isEnabled()) console.warn(`[Perspective] 비활성 상태: ${status.reason}`);
        return null;
    }

    // 1 QPS 레이트 리미팅
    const now = Date.now();
    const elapsed = now - _lastCallAt;
    if (elapsed < MIN_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    _lastCallAt = Date.now();

    const apiKey = process.env.PERSPECTIVE_API_KEY;
    const lang = language || "ko";

    const body = JSON.stringify({
        comment: { text: text.substring(0, 3000) },
        languages: [lang],
        requestedAttributes: {
            TOXICITY: {},
            SEVERE_TOXICITY: {},
            IDENTITY_ATTACK: {},
            INSULT: {},
            PROFANITY: {},
            THREAT: {},
        },
        doNotStore: true, // 개인정보 보호: Perspective에 텍스트 저장 금지
    });

    try {
        const https = require("https");
        const url = new URL(`${PERSPECTIVE_ENDPOINT}?key=${apiKey}`);

        const result = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
                timeout: 10000,
            }, (res) => {
                let raw = "";
                res.on("data", chunk => raw += chunk);
                res.on("end", () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                    catch (e) { reject(new Error(`Perspective 응답 파싱 실패: ${e.message}`)); }
                });
            });
            req.on("error", reject);
            req.on("timeout", () => { req.destroy(); reject(new Error("Perspective API 타임아웃 (10s)")); });
            req.write(body);
            req.end();
        });

        if (result.status === 429) {
            _quotaExceeded = true;
            _quotaExceededAt = Date.now();
            console.warn("[Perspective] 쿼터 한도 초과 (429). 10분 냉각 시작.");
            return null;
        }

        if (result.status !== 200) {
            const errMsg = result.body?.error?.message || JSON.stringify(result.body).substring(0, 200);
            console.error(`[Perspective] API 오류 ${result.status}: ${errMsg}`);
            return null;
        }

        // 속성별 점수 추출 (소문자 키)
        const scores = {};
        const attrs = result.body.attributeScores || {};
        for (const [attr, val] of Object.entries(attrs)) {
            const score = val?.summaryScore?.value;
            if (typeof score === "number") {
                scores[attr.toLowerCase()] = Math.round(score * 1000) / 1000;
            }
        }
        return scores;
    } catch (e) {
        console.error("[Perspective] 호출 실패:", e.message);
        return null;
    }
}

/**
 * Perspective 점수를 textFlags 형식으로 변환
 * @param {Object} scores 속성별 점수 맵
 * @returns {Array} textFlags 배열
 */
function perspectiveScoresToFlags(scores) {
    if (!scores) return [];
    const flags = [];

    for (const [attr, score] of Object.entries(scores)) {
        const isHighPriority = HIGH_PRIORITY_ATTRS.has(attr);

        let severity;
        // 심각 속성: medium 임계값부터 high로 상향 판정
        if (isHighPriority) {
            if (score >= SCORE_THRESHOLDS.medium) severity = "high";
            else if (score >= SCORE_THRESHOLDS.low) severity = "medium";
        } else {
            if (score >= SCORE_THRESHOLDS.high) severity = "high";
            else if (score >= SCORE_THRESHOLDS.medium) severity = "medium";
            else if (score >= SCORE_THRESHOLDS.low) severity = "low";
        }

        if (!severity) continue;

        flags.push({
            keyword: `[AI:${attr}]`,
            category: `perspective_${attr}`,
            severity,
            score,
        });
    }

    // 심각도 내림차순 정렬
    const ORDER = { high: 2, medium: 1, low: 0 };
    flags.sort((a, b) => (ORDER[b.severity] || 0) - (ORDER[a.severity] || 0));

    return flags;
}

/**
 * 쿼터 초과 상태를 Firestore에 기록
 * @param {Object} db Firestore 인스턴스
 */
async function logQuotaExceeded(db) {
    try {
        await db.collection("screening_config").doc("settings").set({
            _perspectiveQuotaExceededAt: Date.now(),
            _perspectiveQuotaMessage: "Perspective API 쿼터 초과 (1 QPS). 인메모리 10분 냉각 중.",
        }, { merge: true });
    } catch (e) { /* 알림 기록 실패는 무시 */ }
}

module.exports = {
    isEnabled,
    getStatus,
    screenTextPerspective,
    perspectiveScoresToFlags,
    logQuotaExceeded,
};
