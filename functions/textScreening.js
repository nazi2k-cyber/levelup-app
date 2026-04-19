// ─── Azure Content Safety — 텍스트 독성 분석 ───
//
// 기존 Azure Content Safety 클라이언트(getAzureClient()) 재사용
// 엔드포인트: /text:analyze (api-version: 2023-10-01)
// 카테고리: Hate, Violence, Sexual, SelfHarm
// 심각도 레벨 (FourSeverityLevels):
//   0 = Safe, 2 = Low, 4 = Medium, 6 = High
//
// 무료 한도: F0 티어 5,000건/월 (이미지와 별도 쿼터)
// 환경 변수: AZURE_CS_ENDPOINT / AZURE_CS_KEY (이미지 스크리닝과 공유)

// 심각도 숫자 → 문자열 매핑
const SEVERITY_MAP = {
    0: null,       // 안전 — 플래그 없음
    2: "low",
    4: "medium",
    6: "high",
};

// 카테고리별 설정 — override: "high" 는 medium 이상 판정 시 high로 상향
const CATEGORY_CONFIG = {
    Hate:     { override: "high" }, // 혐오표현 — 위험도 상향
    Violence: { override: null },
    Sexual:   { override: null },
    SelfHarm: { override: "high" }, // 자해 — 위험도 상향
};

// Azure F0 텍스트 쿼터 초과 시 자동 중단 (이미지와 별도 상태)
let _rateLimited = false;
let _rateLimitedAt = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1시간 냉각

/**
 * Azure Content Safety 텍스트 분석
 * @param {Object} client getAzureClient() 반환값
 * @param {string} text 분석할 텍스트 (최대 10,000자)
 * @returns {Promise<Object|null>} {category: severityNumber} 맵 또는 null
 */
async function screenText(client, text) {
    if (!client || !text || !text.trim()) return null;

    // 쿼터 초과 냉각 중
    if (_rateLimited) {
        if (Date.now() - _rateLimitedAt < RATE_LIMIT_COOLDOWN_MS) {
            return null;
        }
        _rateLimited = false;
        console.log("[TextScreen] Azure 텍스트 쿼터 냉각 경과, 재시도 허용");
    }

    try {
        const result = await client.path("/text:analyze").post({
            body: {
                text: text.substring(0, 10000),
                categories: ["Hate", "Violence", "Sexual", "SelfHarm"],
                outputType: "FourSeverityLevels",
            }
        });

        if (result.status === "429") {
            _rateLimited = true;
            _rateLimitedAt = Date.now();
            console.warn("[TextScreen] Azure 텍스트 F0 한도 초과 (429). 1시간 냉각 시작.");
            return null;
        }

        if (result.status !== "200") {
            console.error("[TextScreen] Azure 텍스트 분석 오류:", result.status,
                JSON.stringify(result.body || {}).substring(0, 200));
            return null;
        }

        const scores = {};
        for (const item of (result.body.categoriesAnalysis || [])) {
            scores[item.category] = item.severity ?? 0;
        }
        return scores;
    } catch (e) {
        console.error("[TextScreen] Azure 텍스트 분석 호출 실패:", e.message);
        return null;
    }
}

/**
 * Azure 텍스트 분석 점수를 textFlags 형식으로 변환
 * @param {Object} scores {category: severityNumber} 맵
 * @returns {Array} textFlags 배열
 */
function scoresToFlags(scores) {
    if (!scores) return [];
    const flags = [];

    for (const [category, severityNum] of Object.entries(scores)) {
        let sev = SEVERITY_MAP[severityNum];
        if (!sev) continue; // 0 = Safe

        // Hate / SelfHarm: low → medium, medium → high 상향
        const cfg = CATEGORY_CONFIG[category];
        if (cfg?.override === "high") {
            if (sev === "medium") sev = "high";
            else if (sev === "low") sev = "medium";
        }

        flags.push({
            keyword: `[AI:${category}]`,
            category: `azure_${category.toLowerCase()}`,
            severity: sev,
            score: severityNum,
        });
    }

    const ORDER = { high: 2, medium: 1, low: 0 };
    flags.sort((a, b) => (ORDER[b.severity] || 0) - (ORDER[a.severity] || 0));
    return flags;
}

function isRateLimited() {
    return _rateLimited && (Date.now() - _rateLimitedAt < RATE_LIMIT_COOLDOWN_MS);
}

module.exports = { screenText, scoresToFlags, isRateLimited };
