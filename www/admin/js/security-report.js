// ─── Security Report Module (보안 리포트, 마스터 전용) ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;
const getSecurityReport = httpsCallable(functions, "getSecurityReport");

export function initSecurityReport(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <h2 style="margin:0;">보안 리포트</h2>
                <span class="badge badge-warn">MASTER ONLY</span>
            </div>
            <p class="text-sub text-sm mb-8">최근 24시간 보안 이벤트 요약. 스케줄러가 기록한 경보를 실시간으로 조회합니다.</p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:16px;">
                <button class="btn btn-outline btn-sm" id="btn-load-security-report">리포트 불러오기</button>
                <span class="text-sub text-sm" id="sr-generated-at"></span>
            </div>
            <div id="sr-body"></div>
        </div>
    `;
    document.getElementById("btn-load-security-report").addEventListener("click", loadReport);
}

export async function loadSecurityReport() {
    await loadReport();
}

async function loadReport() {
    const body = document.getElementById("sr-body");
    const generatedEl = document.getElementById("sr-generated-at");
    body.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    generatedEl.textContent = "";
    tlog("SecReport", "보안 리포트 로딩...");

    try {
        const result = await getSecurityReport();
        const d = result.data;
        tok("SecReport", `리포트 수신 완료 (${d.generatedAt})`);
        generatedEl.textContent = `생성: ${fmtDate(d.generatedAt)}`;
        body.innerHTML = renderReport(d);
        bindAlertTableExpand();
    } catch (e) {
        terror("SecReport", "리포트 로드 실패: " + (e.message || e.code));
        body.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message || e.code)}</p>`;
    }
}

function renderReport(d) {
    const anomalyCount = (d.pointAnomalies || []).length;
    const grantCount = (d.newAdminGrants || []).length;

    return `
        <!-- 요약 스탯 -->
        <div class="stats-grid" style="margin-bottom:20px;">
            ${statCard(d.loginFailures ?? "—", "인증 실패", d.loginFailures > 0 ? "error" : "ok")}
            ${statCard(d.bruteForceCount ?? "—", "Brute Force 탐지", d.bruteForceCount > 0 ? "error" : "ok")}
            ${statCard(anomalyCount, "포인트 이상치", anomalyCount > 0 ? "warn" : "ok")}
            ${statCard(d.contentFlags ?? "—", "콘텐츠 플래그", d.contentFlags > 0 ? "warn" : "ok")}
            ${statCard(grantCount, "신규 어드민 부여", grantCount > 0 ? "warn" : "ok")}
            ${statCard(d.inactiveAdminCount ?? "—", "비활성 어드민", d.inactiveAdminCount > 0 ? "warn" : "ok")}
        </div>

        <!-- 포인트 이상치 목록 -->
        <div class="sr-section">
            <button class="sr-section-toggle" data-target="sr-anomalies">
                포인트 이상치 <span class="badge badge-warn">${anomalyCount}건</span>
            </button>
            <div id="sr-anomalies" class="sr-section-body hidden">
                ${anomalyCount === 0
                    ? '<p class="text-sub text-sm">탐지된 이상치 없음</p>'
                    : renderAnomalyTable(d.pointAnomalies)}
            </div>
        </div>

        <!-- 신규 어드민 부여 -->
        <div class="sr-section">
            <button class="sr-section-toggle" data-target="sr-grants">
                신규 어드민 부여 <span class="badge badge-warn">${grantCount}건</span>
            </button>
            <div id="sr-grants" class="sr-section-body hidden">
                ${grantCount === 0
                    ? '<p class="text-sub text-sm">신규 부여 없음</p>'
                    : renderGrantTable(d.newAdminGrants)}
            </div>
        </div>
    `;
}

function statCard(value, label, state = "ok") {
    const colorMap = { ok: "var(--success)", warn: "var(--warning)", error: "var(--error)" };
    const color = colorMap[state] || "var(--accent)";
    return `
        <div class="stat-card">
            <div class="stat-value" style="color:${color};">${value}</div>
            <div class="stat-label">${label}</div>
        </div>`;
}

function renderAnomalyTable(alerts) {
    let html = `<table>
        <thead><tr>
            <th>사용자 UID</th>
            <th>24h 획득 포인트</th>
            <th>평균 (±σ)</th>
            <th>탐지 시각</th>
        </tr></thead><tbody>`;
    for (const a of alerts) {
        html += `<tr>
            <td class="text-sm" style="font-family:monospace;">${escHtml(a.userId || "—")}</td>
            <td><span class="badge badge-warn">${fmtNum(a.pointsGained24h)}</span></td>
            <td class="text-sub text-sm">${fmtNum(a.mean)} ± ${fmtNum(a.stdDev)}</td>
            <td class="text-sub text-sm">${fmtTs(a.detectedAt)}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function renderGrantTable(alerts) {
    let html = `<table>
        <thead><tr>
            <th>대상 이메일</th>
            <th>Claim 유형</th>
            <th>부여자</th>
            <th>시각</th>
        </tr></thead><tbody>`;
    for (const a of alerts) {
        html += `<tr>
            <td class="text-sm">${escHtml(a.targetEmail || a.targetUid || "—")}</td>
            <td><span class="badge badge-info">${escHtml(a.claimType || "—")}</span></td>
            <td class="text-sub text-sm" style="font-family:monospace;">${escHtml(a.grantedBy || "—")}</td>
            <td class="text-sub text-sm">${fmtTs(a.detectedAt)}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function bindAlertTableExpand() {
    document.querySelectorAll(".sr-section-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            target.classList.toggle("hidden");
        });
    });
}

// Firestore Timestamp ({_seconds, _nanoseconds}) 또는 ISO string 처리
function fmtTs(ts) {
    if (!ts) return "—";
    try {
        if (typeof ts === "string") return new Date(ts).toLocaleString("ko-KR");
        if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString("ko-KR");
        if (ts.seconds != null) return new Date(ts.seconds * 1000).toLocaleString("ko-KR");
    } catch (_) { /* fall through */ }
    return "—";
}

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("ko-KR"); } catch (_) { return iso || "—"; }
}

function fmtNum(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString("ko-KR");
}

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
}
