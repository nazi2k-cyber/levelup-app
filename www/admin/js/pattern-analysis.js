// ─── Pattern Analysis ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;

export function initPatternAnalysis(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>패턴 분석</h2>
            <p class="text-sub text-sm" id="pa-computed-at" style="margin-bottom:16px;">데이터 로딩 중...</p>

            <!-- 섹션 1: 활성/잔존 지표 -->
            <h2 class="mt-16">활성/잔존 지표</h2>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="pa-dau">—</div><div class="stat-label">DAU (오늘)</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-wau">—</div><div class="stat-label">WAU (7일)</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-mau">—</div><div class="stat-label">MAU (30일)</div></div>
                <div class="stat-card">
                    <div class="stat-value" id="pa-stickiness">—</div>
                    <div class="stat-label">Stickiness (DAU/MAU)</div>
                    <div class="pa-meter-track"><div class="pa-meter-fill" id="pa-stickiness-meter" style="width:0%"></div></div>
                </div>
            </div>
            <div class="stats-grid mt-16">
                <div class="stat-card"><div class="stat-value" id="pa-d1">—</div><div class="stat-label">D1 리텐션</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-d7">—</div><div class="stat-label">D7 리텐션</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-d30">—</div><div class="stat-label">D30 리텐션</div></div>
            </div>

            <!-- 섹션 2: 사용자 세그먼트 -->
            <h2 class="mt-16">사용자 세그먼트</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="pa-seg-high">—</div>
                    <div class="stat-label">고활성 (7일 이내)</div>
                    <div><span class="pa-segment-pill pa-pill-high">HIGH</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="pa-seg-low">—</div>
                    <div class="stat-label">저활성 (8-30일)</div>
                    <div><span class="pa-segment-pill pa-pill-low">LOW</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="pa-seg-dormant">—</div>
                    <div class="stat-label">휴면 (30일 초과)</div>
                    <div><span class="pa-segment-pill pa-pill-dormant">DORMANT</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="pa-seg-new">—</div>
                    <div class="stat-label">신규 (7일 이내 가입)</div>
                    <div><span class="pa-segment-pill pa-pill-new">NEW</span></div>
                </div>
            </div>
            <div class="ua-chart-box mt-16">
                <h2>세그먼트 비율</h2>
                <div id="pa-seg-chart"></div>
            </div>

            <!-- 섹션 3: 스트릭 분석 -->
            <h2 class="mt-16">스트릭 분석</h2>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="pa-avg-streak">—</div><div class="stat-label">평균 스트릭 (일)</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-streak-risk">—</div><div class="stat-label">스트릭 위험 사용자</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-streak-zero">—</div><div class="stat-label">스트릭 0명</div></div>
            </div>
            <div class="ua-chart-box mt-16">
                <h2>스트릭 길이 분포</h2>
                <div id="pa-streak-chart"></div>
            </div>

            <!-- 섹션 4: 구독 현황 -->
            <h2 class="mt-16">구독 현황</h2>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="pa-subscribed">—</div><div class="stat-label">구독자 수</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-sub-rate">—</div><div class="stat-label">구독률</div></div>
                <div class="stat-card"><div class="stat-value" id="pa-free">—</div><div class="stat-label">무료 사용자</div></div>
            </div>
            <div class="ua-chart-box mt-16">
                <h2>플랜 분포</h2>
                <div id="pa-plan-chart"></div>
            </div>

            <!-- 섹션 5: 코호트 리텐션 -->
            <h2 class="mt-16">코호트 리텐션 (주차별 D1/D7/D30)</h2>
            <div id="pa-cohort-table"><p class="text-sub text-sm">데이터 로딩 중...</p></div>

            <!-- 섹션 6: 레벨 / 포인트 분포 -->
            <h2 class="mt-16">레벨 / 포인트 분포</h2>
            <div class="ua-charts-row">
                <div class="ua-chart-box">
                    <h2>레벨 분포</h2>
                    <div id="pa-level-chart"></div>
                </div>
                <div class="ua-chart-box">
                    <h2>포인트 분포</h2>
                    <div id="pa-points-chart"></div>
                </div>
            </div>

            <button class="btn btn-outline btn-sm mt-16" id="pa-refresh-btn">새로고침</button>
        </div>
    `;
    document.getElementById("pa-refresh-btn").addEventListener("click", loadPatternAnalysis);
}

export async function loadPatternAnalysis() {
    tlog("Pattern", "패턴 분석 데이터 로딩...");
    try {
        const ping = httpsCallable(functions, "ping");
        const result = await ping({ action: "getPatternAnalysis" });
        const d = result.data;

        // 집계 시각 표시
        const computedDate = new Date(d.computedAt).toLocaleString("ko-KR");
        document.getElementById("pa-computed-at").textContent = `기준 시각: ${computedDate} | 전체 사용자: ${d.totalUsers}명`;

        renderSection1(d);
        renderSection2(d);
        renderSection3(d);
        renderSection4(d);
        renderSection5(d);
        renderSection6(d);

        tok("Pattern", `패턴 분석 완료: DAU ${d.dau}, MAU ${d.mau}, 스티키니스 ${(d.stickiness * 100).toFixed(1)}%`);
    } catch (e) {
        terror("Pattern", "패턴 분석 로드 실패: " + e.message);
        const el = document.getElementById("pa-computed-at");
        if (el) el.textContent = "데이터 로드 실패: " + e.message;
    }
}

function renderSection1(d) {
    document.getElementById("pa-dau").textContent = d.dau;
    document.getElementById("pa-wau").textContent = d.wau;
    document.getElementById("pa-mau").textContent = d.mau;

    const stickyPct = (d.stickiness * 100).toFixed(1);
    document.getElementById("pa-stickiness").textContent = stickyPct + "%";
    const meterEl = document.getElementById("pa-stickiness-meter");
    if (meterEl) meterEl.style.width = Math.min(d.stickiness * 100, 100) + "%";

    document.getElementById("pa-d1").textContent =
        d.d1Eligible > 0 ? (d.d1RetentionRate * 100).toFixed(1) + "%" : "—";
    document.getElementById("pa-d7").textContent =
        d.d7Eligible > 0 ? (d.d7RetentionRate * 100).toFixed(1) + "%" : "—";
    document.getElementById("pa-d30").textContent =
        d.d30Eligible > 0 ? (d.d30RetentionRate * 100).toFixed(1) + "%" : "—";
}

function renderSection2(d) {
    document.getElementById("pa-seg-high").textContent    = d.segmentHighActive;
    document.getElementById("pa-seg-low").textContent     = d.segmentLowActive;
    document.getElementById("pa-seg-dormant").textContent = d.segmentDormant;
    document.getElementById("pa-seg-new").textContent     = d.segmentNew;

    const SEGMENT_LABELS = { "고활성": d.segmentHighActive, "저활성": d.segmentLowActive, "휴면": d.segmentDormant, "신규": d.segmentNew };
    renderBarChart("pa-seg-chart", SEGMENT_LABELS);
}

function renderSection3(d) {
    document.getElementById("pa-avg-streak").textContent  = d.avgStreak;
    document.getElementById("pa-streak-risk").textContent = d.streakAtRisk;
    document.getElementById("pa-streak-zero").textContent = d.streakZero;

    const STREAK_ORDER = ["0", "1-7", "8-30", "31-100", "100+"];
    renderBarChart("pa-streak-chart", d.streakDistribution, k => k + "일", STREAK_ORDER);
}

function renderSection4(d) {
    document.getElementById("pa-subscribed").textContent = d.subscribedCount;
    document.getElementById("pa-sub-rate").textContent   = (d.subscriptionRate * 100).toFixed(1) + "%";
    document.getElementById("pa-free").textContent       = d.freeCount;

    renderBarChart("pa-plan-chart", d.planDistribution);
}

function renderSection5(d) {
    const el = document.getElementById("pa-cohort-table");
    if (!el) return;

    if (!d.cohorts || d.cohorts.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">코호트 데이터 없음 (가입일 정보 필요)</p>';
        return;
    }

    const rows = d.cohorts.map(c => {
        const d1Cell  = c.d1Eligible  > 0 ? `<span class="${retentionCellClass(c.d1Rate)}">${(c.d1Rate  * 100).toFixed(1)}%</span>` : `<span class="pa-ret-na">—</span>`;
        const d7Cell  = c.d7Eligible  > 0 ? `<span class="${retentionCellClass(c.d7Rate)}">${(c.d7Rate  * 100).toFixed(1)}%</span>` : `<span class="pa-ret-na">—</span>`;
        const d30Cell = c.d30Eligible > 0 ? `<span class="${retentionCellClass(c.d30Rate)}">${(c.d30Rate * 100).toFixed(1)}%</span>` : `<span class="pa-ret-na">—</span>`;
        return `<tr>
            <td>${escapeHtml(c.week)}</td>
            <td>${c.size}명</td>
            <td>${d1Cell}</td>
            <td>${d7Cell}</td>
            <td>${d30Cell}</td>
        </tr>`;
    }).join("");

    el.innerHTML = `
        <table class="pa-retention-table">
            <thead>
                <tr>
                    <th>코호트 (주)</th>
                    <th>사용자 수</th>
                    <th>D1</th>
                    <th>D7</th>
                    <th>D30</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderSection6(d) {
    const LEVEL_ORDER = ["1-10", "11-30", "31-50", "51-100", "100+"];
    renderBarChart("pa-level-chart", d.levelDistribution, k => "Lv." + k, LEVEL_ORDER);

    const POINTS_ORDER = ["0-100", "101-1000", "1001-10000", "10000+"];
    renderBarChart("pa-points-chart", d.pointsDistribution, null, POINTS_ORDER);
}

function retentionCellClass(rate) {
    if (rate >= 0.4)  return "pa-ret-high";
    if (rate >= 0.2)  return "pa-ret-medium";
    return "pa-ret-low";
}

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
    const total  = entries.reduce((s, e) => s + e[1], 0);

    if (entries.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">데이터 없음</p>';
        return;
    }

    const COLORS = ["#00e5ff", "#4caf50", "#ffc107", "#ff5252", "#b388ff", "#ff80ab", "#80d8ff", "#ccff90"];

    el.innerHTML = entries.map(([key, val], i) => {
        const pct      = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
        const barWidth = ((val / maxVal) * 100).toFixed(1);
        const label    = labelFn ? labelFn(key) : key;
        const color    = COLORS[i % COLORS.length];
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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

window._loadPatternAnalysis = loadPatternAnalysis;
