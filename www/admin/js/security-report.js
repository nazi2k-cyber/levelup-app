// ─── Security Report Module (보안 리포트) ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror, twarn } from "./log-panel.js";
import { isMaster } from "./auth.js";

const getSecurityAlerts     = httpsCallable(functions, "getSecurityAlerts");
const getSecurityFindings   = httpsCallable(functions, "getSecurityFindings");
const getSecurityRules      = httpsCallable(functions, "getSecurityRules");
const updateSecurityRule    = httpsCallable(functions, "updateSecurityRule");
const getSmsAlertLogs       = httpsCallable(functions, "getSmsAlertLogs");
const getSmsConfig          = httpsCallable(functions, "getSmsConfig");
const updateSmsConfig       = httpsCallable(functions, "updateSmsConfig");
const registerAdminContact  = httpsCallable(functions, "registerAdminContact");
const getAdminContacts      = httpsCallable(functions, "getAdminContacts");
const removeAdminContact    = httpsCallable(functions, "removeAdminContact");
const getAiBotConfig        = httpsCallable(functions, "getAiBotConfig");
const updateAiBotConfig     = httpsCallable(functions, "updateAiBotConfig");
const getAiBotActionLogs    = httpsCallable(functions, "getAiBotActionLogs");

const ALERT_META = {
    points_spike:        { label: "포인트 급증",           color: "#ff9800" },
    repeat_points_spike: { label: "반복 포인트 급증",      color: "#ff5252" },
    stats_decrease:      { label: "스탯 감소 (조작 의심)", color: "#ff5252" },
    admin_claim_set:     { label: "어드민 클레임 부여",    color: "#00e5ff" },
    brute_force:         { label: "브루트포스 의심",        color: "#ff5252" },
    dormant_admin:       { label: "휴면 어드민",            color: "#ffc107" },
};

function alertMeta(type) {
    return ALERT_META[type] || { label: type, color: "#888", badgeClass: "sr-badge-info" };
}

let _container = null;
let _alerts = [];
let _filterType = "";
let _filterDays = 30;

// 탐지 결과 상태
let _findings = [];
let _findingDays = 7;
let _findingSeverity = "";

// SMS 이력 상태
let _smsLogs = [];

// 룰 상태
let _rules = [];

// 연락처 상태
let _contacts = [];

// AI Bot 액션 로그 상태
let _botLogs = [];
let _botLogDays = 7;

export function initSecurityReport(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    const masterSection = isMaster() ? `
        <div class="card" id="sr-ai-bot-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>AI 봇 설정 <span class="badge badge-info" style="font-size:10px;">MASTER</span></h2>
                <span id="sr-ai-key-status" class="text-sub text-sm">로딩 중...</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px; padding:10px 14px; background:#1a1a1a; border-radius:6px; border:1px solid #333;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <span class="text-sm" style="color:var(--text-sub); min-width:110px;">Claude API Key</span>
                    <input id="sr-ai-api-key" type="password" placeholder="sk-ant-api03-..." autocomplete="off"
                        style="flex:1; min-width:200px; padding:6px 10px; font-size:0.85rem; border:1px solid #444; border-radius:4px; background:#111; color:#fff;">
                    <button class="btn btn-sm" id="sr-btn-save-ai-key">저장</button>
                    <button class="btn btn-sm btn-outline" id="sr-btn-remove-ai-key" style="color:#ff5252;border-color:#ff5252;">삭제</button>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <span class="text-sm" style="color:var(--text-sub); min-width:110px;">Dry-run 모드</span>
                    <label style="display:flex; gap:6px; align-items:center; cursor:pointer;">
                        <input type="checkbox" id="sr-ai-dry-run">
                        <span class="text-sm">활성화 (AI 판단만, 실제 조치 미실행)</span>
                    </label>
                    <button class="btn btn-sm btn-outline" id="sr-btn-save-ai-dryrun">저장</button>
                </div>
            </div>
        </div>
        <div class="card" id="sr-rules-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>탐지 룰 설정 <span class="badge badge-info" style="font-size:10px;">MASTER</span></h2>
                <button class="btn btn-outline btn-sm" id="sr-btn-load-rules">룰 조회</button>
            </div>
            <div id="sr-rules-area"><p class="text-sub text-sm">조회 버튼을 눌러 룰을 불러오세요.</p></div>
        </div>
        <div class="card" id="sr-contacts-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>SMS 수신 어드민 연락처 <span class="badge badge-info" style="font-size:10px;">MASTER</span></h2>
                <button class="btn btn-outline btn-sm" id="sr-btn-load-contacts">조회</button>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:12px;">
                <input id="sr-contact-phone" type="tel" placeholder="01012345678 (숫자만)" style="flex:1; padding:6px 10px; font-size:0.85rem; border:1px solid #444; border-radius:4px; background:#1a1a1a; color:#fff;">
                <button class="btn btn-sm" id="sr-btn-register-contact">등록</button>
            </div>
            <div id="sr-contacts-area"><p class="text-sub text-sm">조회 버튼을 눌러 연락처를 불러오세요.</p></div>
        </div>
    ` : "";

    _container.innerHTML = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h2>보안 리포트 — 원시 알림</h2>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select id="sr-filter-days" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                        <option value="7">최근 7일</option>
                        <option value="30" selected>최근 30일</option>
                        <option value="60">최근 60일</option>
                        <option value="90">최근 90일</option>
                    </select>
                    <select id="sr-filter-type" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                        <option value="">전체 유형</option>
                        <option value="points_spike">포인트 급증</option>
                        <option value="repeat_points_spike">반복 포인트 급증</option>
                        <option value="stats_decrease">스탯 감소 (조작 의심)</option>
                        <option value="admin_claim_set">어드민 클레임 부여</option>
                        <option value="brute_force">브루트포스 의심</option>
                        <option value="dormant_admin">휴면 어드민</option>
                    </select>
                    <button class="btn btn-outline btn-sm" id="sr-btn-load">조회</button>
                </div>
            </div>
            <div id="sr-summary"></div>
        </div>
        <div id="sr-alerts-area"></div>

        <div class="card" id="sr-findings-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>해킹 탐지 결과 (Findings)</h2>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select id="sr-finding-days" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                        <option value="1">최근 1일</option>
                        <option value="7" selected>최근 7일</option>
                        <option value="30">최근 30일</option>
                    </select>
                    <select id="sr-finding-severity" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                        <option value="">전체 위험도</option>
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <button class="btn btn-outline btn-sm" id="sr-btn-load-findings">조회</button>
                </div>
            </div>
            <div id="sr-findings-area"><p class="text-sub text-sm">조회 버튼을 눌러 탐지 결과를 불러오세요.</p></div>
        </div>

        <div class="card" id="sr-bot-log-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>AI 봇 액션 로그</h2>
                <div style="display:flex; gap:8px; align-items:center;">
                    <select id="sr-bot-log-days" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                        <option value="1">최근 1일</option>
                        <option value="7" selected>최근 7일</option>
                        <option value="30">최근 30일</option>
                    </select>
                    <button class="btn btn-outline btn-sm" id="sr-btn-load-bot-logs">조회</button>
                </div>
            </div>
            <div id="sr-bot-log-area"><p class="text-sub text-sm">조회 버튼을 눌러 AI 봇 처리 이력을 불러오세요.</p></div>
        </div>

        <div class="card" id="sr-sms-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h2>SMS 발송 이력</h2>
                <button class="btn btn-outline btn-sm" id="sr-btn-load-sms">조회</button>
            </div>
            <div id="sr-sms-config-area" style="margin-bottom:14px; padding:10px 14px; background:#1a1a1a; border-radius:6px; border:1px solid #333;">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <span class="text-sm" style="color:var(--text-sub);">일일 SMS 상한</span>
                    <input id="sr-sms-daily-cap" type="number" min="0" max="10000" placeholder="로딩 중..."
                        style="width:90px; padding:4px 8px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; font-size:0.85rem;"
                        ${!isMaster() ? "disabled" : ""}>
                    <span class="text-sub" style="font-size:0.78rem;" id="sr-sms-cap-hint"></span>
                    ${isMaster() ? `<button class="btn btn-sm" id="sr-btn-save-cap">저장</button>` : ""}
                </div>
            </div>
            <div id="sr-sms-area"><p class="text-sub text-sm">조회 버튼을 눌러 SMS 이력을 불러오세요.</p></div>
        </div>

        ${masterSection}
    `;

    document.getElementById("sr-btn-load").addEventListener("click", loadAlerts);
    document.getElementById("sr-filter-days").addEventListener("change", e => { _filterDays = parseInt(e.target.value, 10); });
    document.getElementById("sr-filter-type").addEventListener("change", e => { _filterType = e.target.value; });

    document.getElementById("sr-btn-load-findings").addEventListener("click", loadFindings);
    document.getElementById("sr-finding-days").addEventListener("change", e => { _findingDays = parseInt(e.target.value, 10); });
    document.getElementById("sr-finding-severity").addEventListener("change", e => { _findingSeverity = e.target.value; });

    document.getElementById("sr-btn-load-sms").addEventListener("click", loadSmsLogs);
    loadSmsConfig();
    if (isMaster()) {
        document.getElementById("sr-btn-save-cap")?.addEventListener("click", saveSmsConfig);
    }

    document.getElementById("sr-btn-load-bot-logs").addEventListener("click", loadBotLogs);
    document.getElementById("sr-bot-log-days").addEventListener("change", e => { _botLogDays = parseInt(e.target.value, 10); });

    if (isMaster()) {
        loadAiBotConfig();
        document.getElementById("sr-btn-save-ai-key")?.addEventListener("click", saveAiApiKey);
        document.getElementById("sr-btn-remove-ai-key")?.addEventListener("click", removeAiApiKey);
        document.getElementById("sr-btn-save-ai-dryrun")?.addEventListener("click", saveAiDryRun);
        document.getElementById("sr-btn-load-rules").addEventListener("click", loadRules);
        document.getElementById("sr-btn-load-contacts").addEventListener("click", loadContacts);
        document.getElementById("sr-btn-register-contact").addEventListener("click", registerContact);
    }
}

export async function loadSecurityReport() {
    await loadAlerts();
    await loadFindings();
    await loadSmsLogs();
    await loadBotLogs();
}

async function loadAlerts() {
    const summaryEl = document.getElementById("sr-summary");
    const alertsEl = document.getElementById("sr-alerts-area");
    if (!summaryEl || !alertsEl) return;

    summaryEl.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    alertsEl.innerHTML = "";
    tlog("SecReport", `보안 알림 조회 중 (최근 ${_filterDays}일)...`);

    try {
        const result = await getSecurityAlerts({
            days: _filterDays,
            type: _filterType || null,
            pageSize: 100,
        });
        _alerts = result.data?.alerts || [];
        const byType = result.data?.byType || {};

        tok("SecReport", `${_alerts.length}건 조회 완료`);
        renderSummary(summaryEl, byType);
        renderAlerts(alertsEl);
    } catch (e) {
        terror("SecReport", "보안 알림 조회 실패: " + e.message);
        summaryEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderSummary(el, byType) {
    const total = Object.values(byType).reduce((s, v) => s + v, 0);

    if (total === 0) {
        el.innerHTML = '<p class="text-sub text-sm">해당 기간에 보안 알림이 없습니다.</p>';
        return;
    }

    const cards = Object.entries(ALERT_META).map(([type, meta]) => {
        const count = byType[type] || 0;
        return `
            <div class="stat-card" style="cursor:pointer;" onclick="window._srFilterType('${type}')">
                <div class="stat-value" style="font-size:1.4rem; color:${meta.color};">${count}</div>
                <div class="stat-label">${meta.label}</div>
            </div>
        `;
    }).join("");

    // 타입별 바 차트
    const barItems = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => {
            const meta = alertMeta(type);
            const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;
            return `
                <div class="ua-bar-row">
                    <span class="ua-bar-label" style="color:${meta.color};">${meta.label}</span>
                    <div class="ua-bar-track">
                        <div class="ua-bar-fill" style="width:${pct}%; background:${meta.color};"></div>
                    </div>
                    <span class="ua-bar-value">${count}건</span>
                </div>
            `;
        }).join("");

    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
            <span class="text-sub text-sm">총</span>
            <span style="font-size:1.5rem; font-weight:700; color:var(--accent);">${total}</span>
            <span class="text-sub text-sm">건</span>
        </div>
        <div class="stats-grid" style="margin-bottom:16px;">${cards}</div>
        <div class="ua-chart-box" style="margin-bottom:0;">
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:10px;">유형별 분포</h3>
            ${barItems}
        </div>
    `;
}

function renderAlerts(el) {
    if (_alerts.length === 0) {
        el.innerHTML = '<div class="card"><p class="text-sub text-sm">알림 없음</p></div>';
        return;
    }

    const rows = _alerts.map(a => {
        const meta = alertMeta(a.type);
        const dt = a.detectedAt ? new Date(a.detectedAt).toLocaleString("ko-KR") : "—";
        const badge = `<span class="badge" style="background:${meta.color}20; color:${meta.color}; border:1px solid ${meta.color}40;">${meta.label}</span>`;
        const source = a.source === "scheduler"
            ? '<span class="badge badge-info" style="font-size:10px;">스케줄러</span>'
            : '<span class="badge badge-info" style="font-size:10px;">실시간</span>';
        const details = renderAlertDetails(a);

        return `
            <tr>
                <td>${badge} ${source}</td>
                <td class="text-sm">${escHtml(a.userId || a.targetEmail || "—")}</td>
                <td class="text-sm">${details}</td>
                <td class="text-sub text-sm" style="white-space:nowrap;">${dt}</td>
            </tr>
        `;
    }).join("");

    el.innerHTML = `
        <div class="card">
            <h2>알림 목록 <span class="text-sub text-sm">(${_alerts.length}건)</span></h2>
            <table>
                <thead><tr>
                    <th>유형</th>
                    <th>대상</th>
                    <th>상세</th>
                    <th>탐지 시각</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderAlertDetails(a) {
    switch (a.type) {
        case "points_spike":
            return `+${(a.delta || 0).toLocaleString()}pt (${(a.pointsBefore || 0).toLocaleString()} → ${(a.pointsAfter || 0).toLocaleString()})`;
        case "repeat_points_spike":
            return `${a.spikeCount}회 반복, 최대 +${(a.maxDelta || 0).toLocaleString()}pt (24h)`;
        case "stats_decrease":
            return `${escHtml(a.field || "—")}: ${a.before} → ${a.after}`;
        case "admin_claim_set":
            return `${escHtml(a.claimType || "—")} 부여 by ${escHtml(a.grantedBy || "—")}`;
        case "brute_force":
            return `${a.authErrorCount}회 인증 실패 (1h 내)`;
        case "dormant_admin":
            return `${escHtml(a.claimType || "—")} — ${a.dormantDays != null ? `${a.dormantDays}일 미접속` : "접속 이력 없음"}`;
        default:
            return "—";
    }
}

function escHtml(str) {
    if (str == null) return "—";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
}

// 타입 필터 단축 (stat-card 클릭)
window._srFilterType = (type) => {
    const sel = document.getElementById("sr-filter-type");
    if (sel) {
        sel.value = type;
        _filterType = type;
        loadAlerts();
    }
};

// ─── 탐지 결과 (Findings) ───

const SEVERITY_COLOR = { critical: "#ff1744", high: "#ff5252", medium: "#ffc107", low: "#69f0ae" };
const SEVERITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

async function loadFindings() {
    const area = document.getElementById("sr-findings-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("Findings", `탐지 결과 조회 중 (최근 ${_findingDays}일)...`);
    try {
        const result = await getSecurityFindings({ days: _findingDays, severity: _findingSeverity || null, pageSize: 100 });
        _findings = result.data?.findings || [];
        const bySeverity = result.data?.bySeverity || {};
        tok("Findings", `${_findings.length}건 조회 완료`);
        renderFindings(area, bySeverity);
    } catch (e) {
        terror("Findings", "탐지 결과 조회 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message)}</p>`;
    }
}

function renderFindings(el, bySeverity) {
    if (_findings.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">해당 기간에 탐지 결과가 없습니다.</p>';
        return;
    }

    const summaryCards = Object.entries(SEVERITY_LABEL).map(([sev, label]) => {
        const count = bySeverity[sev] || 0;
        const color = SEVERITY_COLOR[sev];
        return `<div class="stat-card"><div class="stat-value" style="font-size:1.3rem;color:${color};">${count}</div><div class="stat-label">${label}</div></div>`;
    }).join("");

    const rows = _findings.map(f => {
        const color = SEVERITY_COLOR[f.severity] || "#888";
        const label = SEVERITY_LABEL[f.severity] || f.severity;
        const dt = f.detectedAt ? new Date(f.detectedAt).toLocaleString("ko-KR") : "—";
        const smsBadge = f.smsSent
            ? '<span class="badge" style="background:#00e5ff20;color:#00e5ff;border:1px solid #00e5ff40;">SMS발송</span>'
            : '<span class="badge" style="background:#33333360;color:#888;">미발송</span>';
        return `<tr>
            <td class="text-sm">${escHtml(f.ruleName || f.ruleId)}</td>
            <td class="text-sm">${escHtml(f.clusterKey)}</td>
            <td><span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${label}</span></td>
            <td class="text-sm" style="color:${color};font-weight:700;">${f.score}</td>
            <td class="text-sm">${f.eventCount}</td>
            <td>${smsBadge}</td>
            <td class="text-sub text-sm" style="white-space:nowrap;">${dt}</td>
        </tr>`;
    }).join("");

    el.innerHTML = `
        <div class="stats-grid" style="margin-bottom:16px;">${summaryCards}</div>
        <table>
            <thead><tr><th>규칙</th><th>대상</th><th>위험도</th><th>점수</th><th>이벤트수</th><th>SMS</th><th>탐지시각</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ─── SMS 발송 이력 ───

const SMS_STATUS_META = {
    sent:              { label: "발송완료",    color: "#69f0ae" },
    failed:            { label: "실패",        color: "#ff5252" },
    skipped_cooldown:  { label: "쿨다운 스킵", color: "#ffc107" },
    skipped_cap:       { label: "상한 스킵",   color: "#ffc107" },
    dry_run:           { label: "드라이런",    color: "#888" },
};

async function loadSmsLogs() {
    const area = document.getElementById("sr-sms-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("SmsLogs", "SMS 발송 이력 조회 중...");
    try {
        const result = await getSmsAlertLogs({ days: 7, pageSize: 50 });
        _smsLogs = result.data?.logs || [];
        tok("SmsLogs", `${_smsLogs.length}건 조회 완료`);
        renderSmsLogs(area);
    } catch (e) {
        terror("SmsLogs", "SMS 이력 조회 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message)}</p>`;
    }
}

function renderSmsLogs(el) {
    if (_smsLogs.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">최근 7일 SMS 발송 이력이 없습니다.</p>';
        return;
    }

    const rows = _smsLogs.map(log => {
        const meta = SMS_STATUS_META[log.status] || { label: log.status, color: "#888" };
        const dt = log.lastAttemptAt ? new Date(log.lastAttemptAt).toLocaleString("ko-KR") : "—";
        const recipients = (log.recipients || []).map(r => escHtml(r.maskedPhone)).join(", ") || "—";
        return `<tr>
            <td class="text-sm">${escHtml(log.ruleId)}</td>
            <td class="text-sm">${escHtml(log.clusterKey)}</td>
            <td><span class="badge" style="background:${meta.color}20;color:${meta.color};border:1px solid ${meta.color}40;">${meta.label}</span></td>
            <td class="text-sm">${log.attempts || 0}</td>
            <td class="text-sm">${recipients}</td>
            <td class="text-sub text-sm" style="white-space:nowrap;">${dt}</td>
        </tr>`;
    }).join("");

    el.innerHTML = `
        <table>
            <thead><tr><th>규칙</th><th>대상</th><th>상태</th><th>시도</th><th>수신자</th><th>최종 시각</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ─── 룰 관리 (master only) ───

async function loadRules() {
    const area = document.getElementById("sr-rules-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    try {
        const result = await getSecurityRules({});
        _rules = result.data?.rules || [];
        tok("Rules", `${_rules.length}개 룰 로드`);
        renderRules(area);
    } catch (e) {
        terror("Rules", "룰 조회 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message)}</p>`;
    }
}

function renderRules(el) {
    if (_rules.length === 0) { el.innerHTML = '<p class="text-sub text-sm">룰 없음</p>'; return; }
    const items = _rules.map(rule => {
        const color = SEVERITY_COLOR[rule.severity] || "#888";
        return `
        <div style="border:1px solid #333; border-radius:6px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600;">${escHtml(rule.name)}</span>
                <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${SEVERITY_LABEL[rule.severity] || rule.severity}</span>
            </div>
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; font-size:0.82rem;">
                <label style="display:flex;gap:4px;align-items:center;">
                    <input type="checkbox" id="rule-enabled-${rule.id}" ${rule.enabled ? "checked" : ""}>
                    활성화
                </label>
                <label>임계치: <input id="rule-threshold-${rule.id}" type="number" min="1" value="${rule.threshold}" style="width:56px;padding:2px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:3px;"></label>
                <label>쿨다운(분): <input id="rule-cooldown-${rule.id}" type="number" min="1" value="${rule.cooldownMinutes}" style="width:64px;padding:2px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:3px;"></label>
                <label>점수: <input id="rule-score-${rule.id}" type="number" min="0" max="100" value="${rule.score}" style="width:52px;padding:2px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:3px;"></label>
                <button class="btn btn-sm btn-outline" onclick="window._srSaveRule('${rule.id}')">저장</button>
            </div>
        </div>`;
    }).join("");
    el.innerHTML = items;
}

window._srSaveRule = async (ruleId) => {
    const enabled = document.getElementById(`rule-enabled-${ruleId}`)?.checked;
    const threshold = parseInt(document.getElementById(`rule-threshold-${ruleId}`)?.value, 10);
    const cooldownMinutes = parseInt(document.getElementById(`rule-cooldown-${ruleId}`)?.value, 10);
    const score = parseInt(document.getElementById(`rule-score-${ruleId}`)?.value, 10);
    try {
        await updateSecurityRule({ ruleId, enabled, threshold, cooldownMinutes, score });
        tok("Rules", `${ruleId} 룰 저장 완료`);
    } catch (e) {
        terror("Rules", `룰 저장 실패: ${e.message}`);
    }
};

// ─── 어드민 연락처 관리 (master only) ───

async function loadContacts() {
    const area = document.getElementById("sr-contacts-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    try {
        const result = await getAdminContacts({});
        _contacts = result.data?.contacts || [];
        tok("Contacts", `${_contacts.length}개 연락처 로드`);
        renderContacts(area);
    } catch (e) {
        terror("Contacts", "연락처 조회 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message)}</p>`;
    }
}

function renderContacts(el) {
    if (_contacts.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">등록된 SMS 수신 연락처가 없습니다.</p>';
        return;
    }
    const rows = _contacts.map(c => {
        const dt = c.updatedAt ? new Date(c.updatedAt).toLocaleString("ko-KR") : "—";
        const smsLabel = c.smsEnabled ? '<span class="badge" style="color:#69f0ae;">수신</span>' : '<span class="badge" style="color:#888;">미수신</span>';
        return `<tr>
            <td class="text-sm">${escHtml(c.uid)}</td>
            <td class="text-sm">${escHtml(c.maskedPhone)}</td>
            <td>${smsLabel}</td>
            <td class="text-sub text-sm">${dt}</td>
            <td><button class="btn btn-sm btn-outline" onclick="window._srRemoveContact('${c.uid}')" style="color:#ff5252;border-color:#ff5252;">삭제</button></td>
        </tr>`;
    }).join("");
    el.innerHTML = `<table><thead><tr><th>UID</th><th>전화번호</th><th>SMS</th><th>등록일</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function registerContact() {
    const input = document.getElementById("sr-contact-phone");
    const phone = (input?.value || "").replace(/\D/g, "");
    if (phone.length < 10) { twarn("Contacts", "유효한 전화번호를 입력하세요."); return; }
    try {
        const result = await registerAdminContact({ phone });
        tok("Contacts", `등록 완료 — ${result.data?.maskedPhone}`);
        if (input) input.value = "";
        await loadContacts();
    } catch (e) {
        terror("Contacts", "연락처 등록 실패: " + e.message);
    }
}

window._srRemoveContact = async (uid) => {
    if (!confirm(`연락처를 삭제하시겠습니까? uid: ${uid}`)) return;
    try {
        await removeAdminContact({ uid });
        tok("Contacts", "삭제 완료");
        await loadContacts();
    } catch (e) {
        terror("Contacts", "삭제 실패: " + e.message);
    }
};

// ─── SMS 일일 상한 설정 ───

async function loadSmsConfig() {
    const input = document.getElementById("sr-sms-daily-cap");
    const hint  = document.getElementById("sr-sms-cap-hint");
    if (!input) return;
    try {
        const result = await getSmsConfig({});
        const { smsDailyCap, envDefault } = result.data || {};
        input.value = smsDailyCap ?? envDefault ?? 200;
        if (hint) hint.textContent = `(환경변수 기본값: ${envDefault ?? 200}건)`;
    } catch (e) {
        if (hint) hint.textContent = "설정 로드 실패";
        terror("SmsConfig", "SMS 설정 조회 실패: " + e.message);
    }
}

async function saveSmsConfig() {
    const input = document.getElementById("sr-sms-daily-cap");
    const cap = parseInt(input?.value, 10);
    if (isNaN(cap) || cap < 0 || cap > 10000) {
        twarn("SmsConfig", "0–10000 사이 숫자를 입력하세요.");
        return;
    }
    try {
        await updateSmsConfig({ smsDailyCap: cap });
        tok("SmsConfig", `일일 SMS 상한이 ${cap}건으로 저장되었습니다.`);
        const hint = document.getElementById("sr-sms-cap-hint");
        if (hint) hint.textContent = `저장됨 — (환경변수 기본값과 별개로 적용)`;
    } catch (e) {
        terror("SmsConfig", "저장 실패: " + e.message);
    }
}

// ─── AI Bot 설정 ───

const AI_BOT_KEY_SOURCE = { firestore: "Firestore 저장됨", env: "환경변수(배포설정)", none: "미설정" };

async function loadAiBotConfig() {
    const statusEl = document.getElementById("sr-ai-key-status");
    const dryRunEl = document.getElementById("sr-ai-dry-run");
    if (!statusEl) return;
    try {
        const result = await getAiBotConfig({});
        const { hasKey, keySource, maskedKey, aiDryRun } = result.data || {};
        const sourceLabel = AI_BOT_KEY_SOURCE[keySource] || keySource;
        statusEl.innerHTML = hasKey
            ? `<span style="color:#69f0ae;">● API Key 설정됨</span> <span class="text-sub" style="font-size:0.78rem;">${escHtml(maskedKey || "")} (${sourceLabel})</span>`
            : `<span style="color:#ff5252;">● API Key 미설정 — dry-run 모드</span>`;
        if (dryRunEl) dryRunEl.checked = aiDryRun || false;
    } catch (e) {
        statusEl.textContent = "설정 로드 실패";
        terror("AiBot", "AI Bot 설정 조회 실패: " + e.message);
    }
}

async function saveAiApiKey() {
    const input = document.getElementById("sr-ai-api-key");
    const key = (input?.value || "").trim();
    if (!key) { twarn("AiBot", "API Key를 입력하세요."); return; }
    if (!key.startsWith("sk-ant-")) { twarn("AiBot", "Claude API Key는 sk-ant- 로 시작해야 합니다."); return; }
    try {
        await updateAiBotConfig({ claudeApiKey: key });
        tok("AiBot", "Claude API Key가 저장되었습니다.");
        if (input) input.value = "";
        await loadAiBotConfig();
    } catch (e) {
        terror("AiBot", "API Key 저장 실패: " + e.message);
    }
}

async function removeAiApiKey() {
    if (!confirm("저장된 Claude API Key를 삭제하시겠습니까? (환경변수에 설정된 키는 유지됩니다)")) return;
    try {
        await updateAiBotConfig({ claudeApiKey: "" });
        tok("AiBot", "API Key가 삭제되었습니다.");
        await loadAiBotConfig();
    } catch (e) {
        terror("AiBot", "API Key 삭제 실패: " + e.message);
    }
}

async function saveAiDryRun() {
    const checked = document.getElementById("sr-ai-dry-run")?.checked ?? false;
    try {
        await updateAiBotConfig({ aiDryRun: checked });
        tok("AiBot", `Dry-run 모드가 ${checked ? "활성화" : "비활성화"}되었습니다.`);
        await loadAiBotConfig();
    } catch (e) {
        terror("AiBot", "Dry-run 설정 저장 실패: " + e.message);
    }
}

// ─── AI 봇 액션 로그 ───

const BOT_TOOL_META = {
    disable_user_account: { label: "계정 비활성화", color: "#ff5252" },
    revoke_user_sessions: { label: "세션 만료",     color: "#ff9800" },
    revoke_admin_claim:   { label: "클레임 회수",   color: "#ff9800" },
    backup_user_data:     { label: "데이터 백업",   color: "#69f0ae" },
    flag_for_review:      { label: "검토 플래그",   color: "#00e5ff" },
};

async function loadBotLogs() {
    const area = document.getElementById("sr-bot-log-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("AiBot", `AI 봇 액션 로그 조회 중 (최근 ${_botLogDays}일)...`);
    try {
        const result = await getAiBotActionLogs({ days: _botLogDays, pageSize: 50 });
        _botLogs = result.data?.logs || [];
        tok("AiBot", `${_botLogs.length}건 조회 완료`);
        renderBotLogs(area);
    } catch (e) {
        terror("AiBot", "AI 봇 로그 조회 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${escHtml(e.message)}</p>`;
    }
}

function renderBotLogs(el) {
    if (_botLogs.length === 0) {
        el.innerHTML = '<p class="text-sub text-sm">해당 기간에 AI 봇 처리 이력이 없습니다.</p>';
        return;
    }

    const rows = _botLogs.map((log, idx) => {
        const sevColor = SEVERITY_COLOR[log.severity] || "#888";
        const sevLabel = SEVERITY_LABEL[log.severity] || log.severity;
        const dt = log.executedAt ? new Date(log.executedAt).toLocaleString("ko-KR") : "—";
        const dryBadge = log.dryRun
            ? '<span class="badge" style="background:#33333380;color:#888;font-size:10px;">DRY-RUN</span>'
            : '<span class="badge" style="background:#69f0ae20;color:#69f0ae;border:1px solid #69f0ae40;font-size:10px;">실행됨</span>';

        const actionBadges = (log.actionsExecuted || []).map(a => {
            const meta = BOT_TOOL_META[a.tool] || { label: a.tool, color: "#888" };
            const ok = a.success || a.dryRun;
            const opacity = ok ? "1" : "0.4";
            return `<span class="badge" style="background:${meta.color}20;color:${meta.color};border:1px solid ${meta.color}40;opacity:${opacity};font-size:10px;" title="${a.error || (a.dryRun ? "dry-run" : "")}">${meta.label}${ok ? "" : " ✗"}</span>`;
        }).join(" ");

        const reasonId = `bot-reason-${idx}`;
        const hasReason = !!(log.claudeReasoning && !log.dryRun);

        return `
            <tr style="cursor:${hasReason ? "pointer" : "default"};" onclick="${hasReason ? `window._srToggleBotReason('${reasonId}')` : ""}">
                <td class="text-sm" style="color:${sevColor};">${escHtml(log.ruleId)}</td>
                <td class="text-sm">${escHtml(log.clusterKey)}</td>
                <td><span class="badge" style="background:${sevColor}20;color:${sevColor};border:1px solid ${sevColor}40;">${sevLabel}</span></td>
                <td class="text-sm" style="color:${sevColor};font-weight:700;">${log.score}</td>
                <td style="max-width:240px;">${actionBadges || '<span class="text-sub text-sm">—</span>'}</td>
                <td>${dryBadge}</td>
                <td class="text-sub text-sm" style="white-space:nowrap;">${dt}</td>
            </tr>
            ${hasReason ? `
            <tr id="${reasonId}" style="display:none;">
                <td colspan="7" style="padding:8px 16px; background:#111; border-bottom:1px solid #333;">
                    <div style="font-size:0.8rem; color:#ccc; white-space:pre-wrap; line-height:1.5;">${escHtml(log.claudeReasoning)}</div>
                </td>
            </tr>` : ""}`;
    }).join("");

    el.innerHTML = `
        <p class="text-sub text-sm" style="margin-bottom:8px;">탐지 룰명을 클릭하면 Claude 분석 내용을 펼쳐볼 수 있습니다.</p>
        <table>
            <thead><tr><th>규칙</th><th>대상</th><th>위험도</th><th>점수</th><th>실행 액션</th><th>모드</th><th>처리 시각</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

window._srToggleBotReason = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === "none" ? "table-row" : "none";
};
