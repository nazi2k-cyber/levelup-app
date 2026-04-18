const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

// 금칙어 / 유해 패턴 목록
const BLOCKED_PATTERNS = [
    /https?:\/\/[^\s]*(bit\.ly|tinyurl\.com|goo\.gl|t\.co\/)[^\s]*/i,
    /(?:주민등록번호|신용카드\s*번호|계좌번호)[^가-힣\s]*\d{6,}/i,
    /(?:카드\s*번호|card\s*number)\s*:?\s*\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}/i,
];

function containsBlockedPattern(text) {
    if (!text || typeof text !== "string") return false;
    return BLOCKED_PATTERNS.some((p) => p.test(text));
}

// Google Perspective API 독성 분석 (무료 쿼터: 1 QPS)
// 환경변수 PERSPECTIVE_API_KEY 설정 시 활성화
async function analyzeWithPerspective(text) {
    const apiKey = process.env.PERSPECTIVE_API_KEY;
    if (!apiKey) return null;

    try {
        const response = await fetch(
            `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    comment: { text },
                    languages: ["ko", "en"],
                    requestedAttributes: { TOXICITY: {} },
                }),
                signal: AbortSignal.timeout(5000),
            }
        );

        if (!response.ok) return null;
        const result = await response.json();
        return result.attributeScores?.TOXICITY?.summaryScore?.value ?? null;
    } catch (e) {
        console.warn("[TextFilter] Perspective API 오류:", e.message);
        return null;
    }
}

// reels_reactions 컬렉션 쓰기 시 마지막 댓글 텍스트 필터링
exports.onReelsReactionWrite = onDocumentWritten(
    { document: "reels_reactions/{postId}", region: "asia-northeast3" },
    async (event) => {
        const after = event.data?.after;
        if (!after?.exists) return;

        const data = after.data();
        const comments = Array.isArray(data.comments) ? data.comments : [];
        if (comments.length === 0) return;

        const lastComment = comments[comments.length - 1];
        const commentText =
            typeof lastComment === "string"
                ? lastComment
                : (lastComment?.text || lastComment?.content || "");

        if (!commentText || commentText.length < 2) return;

        // 1차: 금칙어 패턴 검사 (즉각 차단)
        if (containsBlockedPattern(commentText)) {
            await db.collection("security_alerts").add({
                type: "blocked_content",
                postId: event.params.postId,
                reason: "blocked_pattern",
                preview: commentText.substring(0, 200),
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(`[TextFilter] 금칙어 패턴 감지: postId=${event.params.postId}`);
            return;
        }

        // 2차: Perspective API 독성 분석 (설정된 경우)
        const toxicityScore = await analyzeWithPerspective(commentText);
        if (toxicityScore !== null && toxicityScore >= 0.7) {
            await db.collection("security_alerts").add({
                type: "toxic_content",
                postId: event.params.postId,
                toxicityScore,
                preview: commentText.substring(0, 200),
                detectedAt: FieldValue.serverTimestamp(),
            });
            console.warn(
                `[TextFilter] 유해 콘텐츠 감지: postId=${event.params.postId}, score=${toxicityScore.toFixed(2)}`
            );
        }
    }
);
