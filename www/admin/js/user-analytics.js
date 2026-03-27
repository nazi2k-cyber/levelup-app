// ─── User Analytics ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;

export function initUserAnalytics(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>유저 분석</h2>
            <div class="stats-grid" id="ua-stats">
                <div class="stat-card"><div class="stat-value" id="ua-total">—</div><div class="stat-label">전체 사용자</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-active7">—</div><div class="stat-label">7일 액티브</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-active30">—</div><div class="stat-label">30일 액티브</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-rate">—</div><div class="stat-label">활성률 (30일)</div></div>
            </div>
            <h2 class="mt-16">가입 경로</h2>
            <div class="stats-grid" id="ua-signup">
                <div class="stat-card"><div class="stat-value" id="ua-google">—</div><div class="stat-label">Google</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-email">—</div><div class="stat-label">이메일</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-other">—</div><div class="stat-label">기타</div></div>
            </div>
            <h2 class="mt-16">생년월일 / 기대 나이</h2>
            <div class="stats-grid" id="ua-life-status">
                <div class="stat-card"><div class="stat-value" id="ua-birthday-count">—</div><div class="stat-label">생년월일 설정</div></div>
                <div class="stat-card"><div class="stat-value" id="ua-consent-rate">—</div><div class="stat-label">개인정보 동의율</div></div>
            </div>
            <div class="ua-charts-row mt-16">
                <div class="ua-chart-box">
                    <h2>연령대 분포</h2>
                    <div id="ua-age-chart"></div>
                </div>
                <div class="ua-chart-box">
                    <h2>기대 나이 분포</h2>
                    <div id="ua-expect-age-chart"></div>
                </div>
            </div>
            <div class="ua-charts-row mt-16">
                <div class="ua-chart-box">
                    <h2>국적/언어 분포</h2>
                    <div id="ua-lang-chart"></div>
                </div>
                <div class="ua-chart-box">
                    <h2>레벨 분포</h2>
                    <div id="ua-level-chart"></div>
                </div>
            </div>
            <button class="btn btn-outline btn-sm mt-16" id="ua-refresh-btn">새로고침</button>
        </div>
    `;
    document.getElementById("ua-refresh-btn").addEventListener("click", loadUserAnalytics);
}

export async function loadUserAnalytics() {
    tlog("Analytics", "유저 분석 데이터 로딩...");
    try {
        const ping = httpsCallable(functions, "ping");
        const result = await ping({ action: "getUserAnalytics" });
        const d = result.data;

        // 기본 통계
        document.getElementById("ua-total").textContent = d.totalUsers;
        document.getElementById("ua-active7").textContent = d.active7d;
        document.getElementById("ua-active30").textContent = d.active30d;
        const rate = d.totalUsers > 0 ? ((d.active30d / d.totalUsers) * 100).toFixed(1) : "0";
        document.getElementById("ua-rate").textContent = rate + "%";

        // 가입 경로
        document.getElementById("ua-google").textContent = d.signupGoogle;
        document.getElementById("ua-email").textContent = d.signupEmail;
        document.getElementById("ua-other").textContent = d.signupOther;

        // 생년월일 / 기대 나이 / 개인정보 동의
        document.getElementById("ua-birthday-count").textContent = d.birthdaySetCount || 0;
        const consentRate = d.totalUsers > 0 ? (((d.birthdaySetCount || 0) / d.totalUsers) * 100).toFixed(1) : "0";
        document.getElementById("ua-consent-rate").textContent = consentRate + "%";

        // 연령대 분포 바 차트
        renderBarChart("ua-age-chart", d.ageGroupDistribution || {}, ageGroupLabel, AGE_GROUP_ORDER);

        // 기대 나이 분포 바 차트 (숫자 순 정렬)
        const expectAgeOrder = Object.keys(d.expectAgeDistribution || {}).sort((a, b) => Number(a) - Number(b));
        renderBarChart("ua-expect-age-chart", d.expectAgeDistribution || {}, k => k + "세", expectAgeOrder);

        // 국적/언어 바 차트
        renderBarChart("ua-lang-chart", d.langCount, langLabel);

        // 레벨 분포 바 차트
        renderBarChart("ua-level-chart", d.levelDistribution);

        tok("Analytics", `유저 분석 완료: 전체 ${d.totalUsers}명, 액티브(30일) ${d.active30d}명`);
    } catch (e) {
        terror("Analytics", "유저 분석 로드 실패: " + e.message);
    }
}

const LANG_LABELS = {
    ko: "한국어",
    en: "English",
    ja: "日本語",
    zh: "中文",
    es: "Español",
    fr: "Français",
    de: "Deutsch"
};

function langLabel(key) {
    return LANG_LABELS[key] || key.toUpperCase();
}

const AGE_GROUP_ORDER = ["10세 미만", "10대", "20대", "30대", "40대", "50대", "60세 이상"];
function ageGroupLabel(key) { return key; }

function renderBarChart(containerId, data, labelFn, customOrder) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let entries;
    if (customOrder) {
        entries = customOrder.filter(k => data[k] !== undefined).map(k => [k, data[k]]);
    } else {
        entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    }
    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    const total = entries.reduce((s, e) => s + e[1], 0);

    if (entries.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">데이터 없음</p>';
        return;
    }

    const COLORS = ["#00e5ff", "#4caf50", "#ffc107", "#ff5252", "#b388ff", "#ff80ab", "#80d8ff", "#ccff90"];

    el.innerHTML = entries.map(([key, val], i) => {
        const pct = ((val / total) * 100).toFixed(1);
        const barWidth = ((val / maxVal) * 100).toFixed(1);
        const label = labelFn ? labelFn(key) : key;
        const color = COLORS[i % COLORS.length];
        return `
            <div class="ua-bar-row">
                <span class="ua-bar-label">${label}</span>
                <div class="ua-bar-track">
                    <div class="ua-bar-fill" style="width:${barWidth}%; background:${color}"></div>
                </div>
                <span class="ua-bar-value">${val} <span class="text-sub">(${pct}%)</span></span>
            </div>
        `;
    }).join("");
}

window._loadUserAnalytics = loadUserAnalytics;
