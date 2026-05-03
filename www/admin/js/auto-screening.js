// ─── Auto Screening Module (자동 스크리닝 관리) ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, twarn, terror } from "./log-panel.js";

let _container = null;
let _results = [];
let _config = null;
let _statsProfile = null;
let _statsPlanner = null;
let _currentView = "dashboard"; // dashboard | results | config

const STORAGE_BUCKET = "levelup-app-53d02.firebasestorage.app";

function getReelsPhotoUrl(uid, timestamp) {
    const path = `reels_photos/${uid}/${timestamp}.webp`;
    return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

function getReelsPhotoUrlJpg(uid, timestamp) {
    const path = `reels_photos/${uid}/${timestamp}.jpg`;
    return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

function getProfilePhotoUrl(uid) {
    const path = `profile_images/${uid}/profile.webp`;
    return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

function getPostTimestamp(postId) {
    const parts = postId.split("_");
    return parts[parts.length - 1];
}

const ping = httpsCallable(functions, "ping");

async function callAdmin(action, data = {}) {
    const result = await ping({ action, ...data });
    return result.data;
}

export function initAutoScreening(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>자동 스크리닝 시스템</h2>
            <p class="text-sub text-sm mb-8">프로필/플래너 이미지 및 캡션 자동 검열 시스템을 관리합니다.</p>
            <div class="as-view-tabs">
                <button class="as-view-tab active" data-view="dashboard">대시보드</button>
                <button class="as-view-tab" data-view="results">스크리닝 결과</button>
                <button class="as-view-tab" data-view="config">설정 관리</button>
            </div>
        </div>
        <div id="as-view-content"></div>
    `;

    _container.querySelectorAll(".as-view-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            _container.querySelectorAll(".as-view-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            _currentView = btn.dataset.view;
            renderView();
        });
    });

    renderView();
}

function renderView() {
    switch (_currentView) {
        case "dashboard": renderDashboard(); break;
        case "results": renderResults(); break;
        case "config": renderConfig(); break;
    }
}

// ─── 대시보드 뷰 ───

function renderDashboard() {
    const el = document.getElementById("as-view-content");
    el.innerHTML = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:8px; flex-wrap:wrap;">
                <h2>스케줄러 생성</h2>
                <button class="btn btn-outline btn-sm" id="btn-load-scheduler">설정 불러오기</button>
            </div>
            <p class="text-sub text-sm mb-8">자동 스크리닝 스케줄러를 주기(n분)로 실행합니다.</p>
            <div id="as-scheduler-area"></div>
        </div>
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h2>스크리닝-프로필</h2>
                <div style="display:flex; gap:8px; align-items:center;">
                    <label class="as-toggle-row" style="margin:0; font-size:0.8rem;">
                        <input type="checkbox" id="chk-profile-force">
                        <span>스킵 무효화 (전체 검색)</span>
                    </label>
                    <button class="btn btn-outline btn-sm" id="btn-refresh-stats-profile">통계 새로고침</button>
                    <button class="btn btn-primary btn-sm" id="btn-batch-screen-profile">스크리닝</button>
                </div>
            </div>
            <div id="as-stats-area-profile">
                <p class="text-sub text-sm">통계를 로드하려면 '통계 새로고침'을 클릭하세요.</p>
            </div>
        </div>
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h2>스크리닝-플래너</h2>
                <div style="display:flex; gap:8px; align-items:center;">
                    <label class="as-toggle-row" style="margin:0; font-size:0.8rem;">
                        <input type="checkbox" id="chk-planner-force">
                        <span>스킵 무효화 (전체 검색)</span>
                    </label>
                    <button class="btn btn-outline btn-sm" id="btn-refresh-stats-planner">통계 새로고침</button>
                    <button class="btn btn-primary btn-sm" id="btn-batch-screen-planner">스크리닝</button>
                </div>
            </div>
            <div id="as-stats-area-planner">
                <p class="text-sub text-sm">통계를 로드하려면 '통계 새로고침'을 클릭하세요.</p>
            </div>
        </div>
    `;

    document.getElementById("btn-load-scheduler").addEventListener("click", loadSchedulerConfig);
    document.getElementById("btn-refresh-stats-profile").addEventListener("click", () => loadStats("profile"));
    document.getElementById("btn-refresh-stats-planner").addEventListener("click", () => loadStats("planner"));
    document.getElementById("btn-batch-screen-profile").addEventListener("click", () => {
        const force = document.getElementById("chk-profile-force").checked;
        batchScreenProfile(force);
    });
    document.getElementById("btn-batch-screen-planner").addEventListener("click", () => {
        const force = document.getElementById("chk-planner-force").checked;
        batchScreen(force);
    });

    // 대시보드 진입 시 스케줄러 설정 자동 로드
    loadSchedulerConfig();
}

async function loadSchedulerConfig() {
    const area = document.getElementById("as-scheduler-area");
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    try {
        _config = await callAdmin("getScreeningConfig");
        const s = _config.settings || {};
        area.innerHTML = `
            <div style="display:grid; gap:10px;">
                <label class="as-toggle-row"><input type="checkbox" id="cfg-sch-planner-enabled" ${s.plannerSchedulerEnabled ? "checked" : ""}><span>플래너 스케줄러 활성화</span></label>
                <div><label class="text-sub text-sm">플래너 주기(분)</label><input id="cfg-sch-planner-min" type="number" min="1" max="1440" value="${Number(s.plannerSchedulerIntervalMin) || 30}" style="margin-left:8px; width:90px;"></div>
                <label class="as-toggle-row"><input type="checkbox" id="cfg-sch-profile-enabled" ${s.profileSchedulerEnabled ? "checked" : ""}><span>프로필 스케줄러 활성화</span></label>
                <div><label class="text-sub text-sm">프로필 주기(분)</label><input id="cfg-sch-profile-min" type="number" min="1" max="1440" value="${Number(s.profileSchedulerIntervalMin) || 60}" style="margin-left:8px; width:90px;"></div>
                <div><button class="btn btn-primary btn-sm" id="btn-save-scheduler">스케줄러 저장</button><span id="scheduler-save-result" style="margin-left:8px;"></span></div>
            </div>
        `;
        document.getElementById("btn-save-scheduler").addEventListener("click", saveSchedulerConfig);
        tok("AutoScreen", "스케줄러 설정 로드 완료");
    } catch (e) {
        terror("AutoScreen", "스케줄러 설정 로드 실패: " + e.message);
        area.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <p class="text-error text-sm" style="margin:0;">스케줄러 로드 실패: ${e.message}</p>
                <button class="btn btn-outline btn-sm" id="btn-retry-scheduler">다시 시도</button>
            </div>
        `;
        const retryBtn = document.getElementById("btn-retry-scheduler");
        if (retryBtn) retryBtn.addEventListener("click", loadSchedulerConfig);
    }
}

async function saveSchedulerConfig() {
    const resultEl = document.getElementById("scheduler-save-result");
    resultEl.innerHTML = '<span class="text-sub text-sm">저장 중...</span>';
    const settings = {
        plannerSchedulerEnabled: document.getElementById("cfg-sch-planner-enabled").checked,
        plannerSchedulerIntervalMin: Math.max(1, Number(document.getElementById("cfg-sch-planner-min").value) || 30),
        profileSchedulerEnabled: document.getElementById("cfg-sch-profile-enabled").checked,
        profileSchedulerIntervalMin: Math.max(1, Number(document.getElementById("cfg-sch-profile-min").value) || 60),
    };
    try {
        await callAdmin("updateScreeningConfig", { settings });
        resultEl.innerHTML = '<span class="text-success text-sm">저장 완료!</span>';
    } catch (e) {
        resultEl.innerHTML = `<span class="text-error text-sm">실패: ${e.message}</span>`;
    }
}

async function loadSchedulerConfig() {
    const area = document.getElementById("as-scheduler-area");
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    try {
        _config = await callAdmin("getScreeningConfig");
        const s = _config.settings || {};
        area.innerHTML = `
            <div style="display:grid; gap:10px;">
                <label class="as-toggle-row"><input type="checkbox" id="cfg-sch-planner-enabled" ${s.plannerSchedulerEnabled ? "checked" : ""}><span>플래너 스케줄러 활성화</span></label>
                <div><label class="text-sub text-sm">플래너 주기(분)</label><input id="cfg-sch-planner-min" type="number" min="1" max="1440" value="${Number(s.plannerSchedulerIntervalMin) || 30}" style="margin-left:8px; width:90px;"></div>
                <label class="as-toggle-row"><input type="checkbox" id="cfg-sch-profile-enabled" ${s.profileSchedulerEnabled ? "checked" : ""}><span>프로필 스케줄러 활성화</span></label>
                <div><label class="text-sub text-sm">프로필 주기(분)</label><input id="cfg-sch-profile-min" type="number" min="1" max="1440" value="${Number(s.profileSchedulerIntervalMin) || 60}" style="margin-left:8px; width:90px;"></div>
                <div><button class="btn btn-primary btn-sm" id="btn-save-scheduler">스케줄러 저장</button><span id="scheduler-save-result" style="margin-left:8px;"></span></div>
            </div>
        `;
        document.getElementById("btn-save-scheduler").addEventListener("click", saveSchedulerConfig);
    } catch (e) {
        area.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

async function saveSchedulerConfig() {
    const resultEl = document.getElementById("scheduler-save-result");
    resultEl.innerHTML = '<span class="text-sub text-sm">저장 중...</span>';
    const settings = {
        plannerSchedulerEnabled: document.getElementById("cfg-sch-planner-enabled").checked,
        plannerSchedulerIntervalMin: Math.max(1, Number(document.getElementById("cfg-sch-planner-min").value) || 30),
        profileSchedulerEnabled: document.getElementById("cfg-sch-profile-enabled").checked,
        profileSchedulerIntervalMin: Math.max(1, Number(document.getElementById("cfg-sch-profile-min").value) || 60),
    };
    try {
        await callAdmin("updateScreeningConfig", { settings });
        resultEl.innerHTML = '<span class="text-success text-sm">저장 완료!</span>';
    } catch (e) {
        resultEl.innerHTML = `<span class="text-error text-sm">실패: ${e.message}</span>`;
    }
}

async function loadStats(type) {
    const areaId = type === "profile" ? "as-stats-area-profile" : "as-stats-area-planner";
    const typeLabel = type === "profile" ? "프로필" : "플래너";
    const area = document.getElementById(areaId);
    if (!area) return;
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("AutoScreen", `${typeLabel} 스크리닝 통계 로딩...`);

    try {
        const stats = await callAdmin("getScreeningStats", { type });
        if (type === "profile") _statsProfile = stats;
        else _statsPlanner = stats;
        tok("AutoScreen", `${typeLabel} 통계 로드 완료`);

        let rateLimitAlert = "";
        if (stats.azureRateLimited) {
            const limitDt = new Date(stats.azureRateLimited).toLocaleString("ko-KR");
            rateLimitAlert += `
                <div style="background:#ff525220; border:1px solid #ff5252; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
                    <strong style="color:#ff5252;">Azure F0 한도 초과</strong>
                    <span class="text-sm" style="margin-left:8px; color:var(--text);">${limitDt} — NSFWJS fallback 운영 중</span>
                </div>`;
        }
        if (stats.azureTextRateLimited) {
            const pDt = new Date(stats.azureTextRateLimited).toLocaleString("ko-KR");
            rateLimitAlert += `
                <div style="background:#ff980020; border:1px solid #ff9800; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
                    <strong style="color:#ff9800;">Azure 텍스트 F0 한도 초과</strong>
                    <span class="text-sm" style="margin-left:8px; color:var(--text);">${pDt} — 1시간 냉각 후 자동 재시도</span>
                </div>`;
        }

        area.innerHTML = `
            ${rateLimitAlert}
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${(stats.total || 0) + (stats.clean || 0)}</div>
                    <div class="stat-label">총 스캔</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color:var(--success);">${stats.clean || 0}</div>
                    <div class="stat-label">정상 (Clean)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.total || 0}</div>
                    <div class="stat-label">총 플래그</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value as-pending">${stats.pending || 0}</div>
                    <div class="stat-label">검토 대기</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value as-approved">${stats.approved || 0}</div>
                    <div class="stat-label">승인됨</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value as-rejected">${stats.rejected || 0}</div>
                    <div class="stat-label">거부됨</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value as-auto-deleted">${stats.autoDeleted || 0}</div>
                    <div class="stat-label">자동 삭제</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value as-auto-hidden">${stats.autoHidden || 0}</div>
                    <div class="stat-label">자동 숨김</div>
                </div>
            </div>
            <div class="ua-charts-row" style="margin-top:16px;">
                <div class="ua-chart-box">
                    <h3 class="text-sm" style="color:var(--accent); margin-bottom:12px;">심각도별 분포</h3>
                    ${renderSeverityBars(stats.bySeverity || {})}
                </div>
                ${type === "planner" ? `
                <div class="ua-chart-box">
                    <h3 class="text-sm" style="color:var(--accent); margin-bottom:12px;">카테고리별 분포</h3>
                    ${renderCategoryBars(stats.byCategory || {})}
                </div>` : ""}
            </div>
        `;
    } catch (e) {
        terror("AutoScreen", `${typeLabel} 통계 로드 실패: ` + e.message);
        if (area) area.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderSeverityBars(data) {
    const total = (data.low || 0) + (data.medium || 0) + (data.high || 0);
    if (total === 0) return '<p class="text-sub text-sm">데이터 없음</p>';

    const items = [
        { label: "Low", count: data.low || 0, color: "#ffc107" },
        { label: "Medium", count: data.medium || 0, color: "#ff9800" },
        { label: "High", count: data.high || 0, color: "#ff5252" },
    ];

    return items.map(i => `
        <div class="ua-bar-row">
            <span class="ua-bar-label">${i.label}</span>
            <div class="ua-bar-track">
                <div class="ua-bar-fill" style="width:${total ? (i.count / total * 100) : 0}%; background:${i.color};"></div>
            </div>
            <span class="ua-bar-value">${i.count}건</span>
        </div>
    `).join("");
}

function renderCategoryBars(data) {
    const entries = Object.entries(data);
    if (entries.length === 0) return '<p class="text-sub text-sm">데이터 없음</p>';

    const total = entries.reduce((s, [, v]) => s + v, 0);
    const catLabels = {
        profanity: "욕설/비속어",
        hate: "혐오표현",
        spam: "스팸/홍보",
        nsfw: "음란물",
        illegal: "불법정보",
        azure_hate: "AI:혐오표현",
        azure_violence: "AI:폭력",
        azure_sexual: "AI:성적콘텐츠",
        azure_selfharm: "AI:자해",
    };

    return entries.map(([cat, count]) => `
        <div class="ua-bar-row">
            <span class="ua-bar-label">${catLabels[cat] || cat}</span>
            <div class="ua-bar-track">
                <div class="ua-bar-fill" style="width:${total ? (count / total * 100) : 0}%; background:var(--accent);"></div>
            </div>
            <span class="ua-bar-value">${count}건</span>
        </div>
    `).join("");
}

async function batchScreenProfile(forceRescan = false) {
    const modeLabel = forceRescan ? "프로필 전체 스크리닝" : "프로필 스크리닝";
    const confirmMsg = forceRescan
        ? "모든 유저의 프로필 이미지를 처음부터 다시 스크리닝합니다.\n\n기존 프로필 스크리닝 결과를 삭제하고 전수조사합니다."
        : "프로필 이미지에 대해 스크리닝을 실행합니다.\n\n이미 스크리닝된 프로필은 건너뜁니다.";

    if (!confirm(confirmMsg)) return;

    tlog("AutoScreen", `${modeLabel} 실행 중...`);
    const btn = document.getElementById("btn-batch-screen-profile");
    btn.disabled = true;
    btn.textContent = "스크리닝 중...";

    try {
        const result = await callAdmin("batchScreenProfiles", { forceRescan });
        const d = result.detail || {};

        tok("AutoScreen", `${modeLabel} 완료: ${result.screenedCount}건 스캔, ${result.flaggedCount}건 플래그`);
        if (result.skippedCount > 0) {
            tlog("AutoScreen", `기 스크리닝 스킵: ${result.skippedCount}건 (이미 검사됨)`);
        }

        // 엔진 구동 상태 로그
        if (d.imageEnabled) {
            if (d.nsfwjsModelReady) tok("NSFWJS", "NSFWJS 엔진 구동 성공 (MobileNetV2)");
            else terror("NSFWJS", `NSFWJS 엔진 구동 실패: ${d.nsfwjsModelError || "알 수 없는 오류"}`);
            if (d.azureEnabled) {
                if (d.azureClientReady) tok("Azure", "Azure Content Safety 엔진 구동 성공");
                else terror("Azure", `Azure 엔진 구동 실패: ${d.azureClientError || "알 수 없는 오류"}`);
            }
        }

        // 이미지 스크리닝 상세
        if (d.imageEnabled && d.imageScreenedCount > 0) {
            const imgMsg = `이미지 스크리닝: ${d.imageScreenedCount}건 검사 → ${d.imageFlaggedCount}건 플래그`;
            d.imageFlaggedCount > 0 ? twarn("Image", imgMsg) : tok("Image", imgMsg);

            if (d.nsfwjsCount > 0) {
                const parts = [];
                if (d.nsfwjsSafeCount) parts.push(`안전 ${d.nsfwjsSafeCount}`);
                if (d.nsfwjsAmbiguousCount) parts.push(`애매 ${d.nsfwjsAmbiguousCount}`);
                if (d.nsfwjsFlaggedCount) parts.push(`플래그 ${d.nsfwjsFlaggedCount}`);
                if (d.nsfwjsErrorCount) parts.push(`오류 ${d.nsfwjsErrorCount}`);
                const detail = parts.length ? ` (${parts.join(", ")})` : "";
                tok("NSFWJS", `NSFWJS 1차: ${d.nsfwjsCount}건 분석${detail}`);
            }

            if (d.azureEnabled && d.azureCount > 0) {
                const azMsg = `Azure 2차: ${d.azureCount}건 정밀검사 → ${d.azureFlaggedCount}건 플래그`;
                d.azureFlaggedCount > 0 ? twarn("Azure", azMsg) : tok("Azure", azMsg);
            }
        }

        if (result.autoDeletedCount > 0) twarn("AutoScreen", `프로필 자동 삭제: ${result.autoDeletedCount}건`);
        if (result.autoHiddenCount > 0) twarn("AutoScreen", `프로필 자동 숨김: ${result.autoHiddenCount}건`);

        let alertMsg = `${modeLabel} 완료!\n\n` +
            `스캔: ${result.screenedCount}건 | 플래그: ${result.flaggedCount}건\n` +
            `자동 삭제: ${result.autoDeletedCount}건 | 자동 숨김: ${result.autoHiddenCount}건`;
        if (result.skippedCount > 0) alertMsg += `\n스킵: ${result.skippedCount}건 (이미 검사됨)`;
        alert(alertMsg);

        loadStats("profile");
    } catch (e) {
        terror("AutoScreen", `${modeLabel} 실패: ` + e.message);
        alert(`${modeLabel} 실패: ` + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "스크리닝";
    }
}

async function batchScreen(forceRescan = false) {
    const modeLabel = forceRescan ? "플래너 전체 스크리닝 (전수조사)" : "플래너 스크리닝";
    const confirmMsg = forceRescan
        ? "전체 활성 포스트를 처음부터 다시 스크리닝합니다.\n\n기존 스크리닝 결과를 삭제하고 전수조사합니다."
        : "활성 포스트에 대해 스크리닝을 실행합니다.\n\n이미 스크리닝된 포스트는 건너뜁니다.";

    if (!confirm(confirmMsg)) return;

    tlog("AutoScreen", `${modeLabel} 실행 중...`);
    const btn = document.getElementById("btn-batch-screen-planner");
    btn.disabled = true;
    btn.textContent = "스크리닝 중...";

    try {
        const result = await callAdmin("batchScreenPosts", { forceRescan });
        const d = result.detail || {};

        // 요약 로그
        tok("AutoScreen", `${modeLabel} 완료: ${result.screenedCount}건 스캔, ${result.flaggedCount}건 플래그`);

        // 스킵 정보
        if (result.skippedCount > 0) {
            tlog("AutoScreen", `기 스크리닝 스킵: ${result.skippedCount}건 (이미 검사됨)`);
        }

        // 엔진 구동 상태 로그
        if (d.imageEnabled) {
            if (d.nsfwjsModelReady) {
                tok("NSFWJS", "NSFWJS 엔진 구동 성공 (MobileNetV2)");
            } else {
                terror("NSFWJS", `NSFWJS 엔진 구동 실패: ${d.nsfwjsModelError || "알 수 없는 오류"}`);
            }
            if (d.azureEnabled) {
                if (d.azureClientReady) {
                    tok("Azure", "Azure Content Safety 엔진 구동 성공");
                } else {
                    terror("Azure", `Azure 엔진 구동 실패: ${d.azureClientError || "알 수 없는 오류"}`);
                }
            }
        }

        // 텍스트 스크리닝 상세
        if (d.textEnabled) {
            if (d.textScreenedCount > 0) {
                const textMsg = `텍스트 스크리닝: ${d.textScreenedCount}건 검사 → ${d.textFlaggedCount}건 플래그`;
                d.textFlaggedCount > 0 ? twarn("Text", textMsg) : tok("Text", textMsg);
            } else {
                tlog("Text", "텍스트 스크리닝: 대상 없음 (0건)");
            }
        } else {
            tlog("Text", "텍스트 스크리닝: 비활성화 상태");
        }

        // Azure 텍스트 분석 상세
        if (d.azureTextEnabled) {
            if (!d.azureTextClientReady) {
                twarn("Azure텍스트", "Azure 클라이언트 초기화 실패 — AZURE_CS_KEY / AZURE_CS_ENDPOINT 확인 필요");
            } else if (d.azureTextCount > 0) {
                const tMsg = `Azure 텍스트 AI: ${d.azureTextCount}건 분석 → ${d.azureTextFlaggedCount}건 플래그${d.azureTextErrorCount ? ` (오류 ${d.azureTextErrorCount})` : ""}`;
                d.azureTextFlaggedCount > 0 ? twarn("Azure텍스트", tMsg) : tok("Azure텍스트", tMsg);
            } else {
                tok("Azure텍스트", "Azure 텍스트 AI: 호출 없음 (텍스트 콘텐츠 없음)");
            }
        } else {
            tlog("Azure텍스트", "Azure 텍스트 분석: 비활성화 상태");
        }

        // 이미지 스크리닝 상세
        if (d.imageEnabled) {
            if (d.imageScreenedCount > 0) {
                const imgMsg = `이미지 스크리닝: ${d.imageScreenedCount}건 검사 → ${d.imageFlaggedCount}건 플래그`;
                d.imageFlaggedCount > 0 ? twarn("Image", imgMsg) : tok("Image", imgMsg);

                // NSFWJS 판정별 상세
                if (d.nsfwjsCount > 0) {
                    const parts = [];
                    if (d.nsfwjsSafeCount) parts.push(`안전 ${d.nsfwjsSafeCount}`);
                    if (d.nsfwjsAmbiguousCount) parts.push(`애매 ${d.nsfwjsAmbiguousCount}`);
                    if (d.nsfwjsFlaggedCount) parts.push(`플래그 ${d.nsfwjsFlaggedCount}`);
                    if (d.nsfwjsErrorCount) parts.push(`오류 ${d.nsfwjsErrorCount}`);
                    const detail = parts.length ? ` (${parts.join(", ")})` : "";
                    const nsfwMsg = `NSFWJS 1차: ${d.nsfwjsCount}건 분석${detail}`;
                    (d.nsfwjsFlaggedCount > 0 || d.nsfwjsErrorCount > 0) ? twarn("NSFWJS", nsfwMsg) : tok("NSFWJS", nsfwMsg);
                } else {
                    twarn("NSFWJS", `NSFWJS 1차: 전체 실패 (${d.imageScreenedCount}건 중 0건 분석 성공)`);
                }

                // NSFWJS 오류 경고
                if (d.nsfwjsErrorCount > 0) {
                    twarn("NSFWJS", `NSFWJS 오류: ${d.nsfwjsErrorCount}건 이미지 분석 실패 → Azure fallback 시도`);
                }

                // Azure 상세 (실제 호출 기반)
                if (d.azureEnabled) {
                    if (d.azureCount > 0) {
                        const azExtra = d.azureErrorCount > 0 ? ` (오류 ${d.azureErrorCount}건)` : "";
                        const azMsg = `Azure 2차: ${d.azureCount}건 정밀검사 → ${d.azureFlaggedCount}건 플래그${azExtra}`;
                        (d.azureFlaggedCount > 0 || d.azureErrorCount > 0) ? twarn("Azure", azMsg) : tok("Azure", azMsg);
                    } else {
                        tok("Azure", "Azure 2차: 호출 불필요 (NSFWJS 1차에서 모두 판정 완료)");
                    }
                } else {
                    tlog("Azure", "Azure 2차 정밀검사: 비활성화 상태");
                }
            } else {
                tlog("Image", "이미지 스크리닝: 대상 없음 (0건)");
            }
        } else {
            tlog("Image", "이미지 스크리닝: 비활성화 상태");
        }

        // 자동 조치 로그
        if (result.autoDeletedCount > 0) {
            twarn("AutoScreen", `자동 삭제: ${result.autoDeletedCount}건`);
        }
        if (result.autoHiddenCount > 0) {
            twarn("AutoScreen", `자동 숨김: ${result.autoHiddenCount}건`);
        }

        // alert에도 상세 정보 포함
        let alertMsg = `${modeLabel} 완료!\n\n` +
            `스캔: ${result.screenedCount}건 | 플래그: ${result.flaggedCount}건\n` +
            `자동 삭제: ${result.autoDeletedCount}건 | 자동 숨김: ${result.autoHiddenCount}건`;
        if (result.skippedCount > 0) alertMsg += `\n스킵: ${result.skippedCount}건 (이미 검사됨)`;
        alertMsg += `\n\n── 엔진 상태 ──`;
        if (d.imageEnabled) {
            alertMsg += `\nNSFWJS: ${d.nsfwjsModelReady ? "구동 OK" : "구동 실패 — " + (d.nsfwjsModelError || "?")}`;
            if (d.azureEnabled) alertMsg += `\nAzure: ${d.azureClientReady ? "구동 OK" : "구동 실패 — " + (d.azureClientError || "?")}`;
        }
        alertMsg += `\n\n── 상세 ──`;
        if (d.textEnabled) alertMsg += `\n텍스트: ${d.textScreenedCount}건 검사 → ${d.textFlaggedCount}건 플래그`;
        if (d.azureTextEnabled) {
            if (!d.azureTextClientReady) alertMsg += `\nAzure 텍스트: 클라이언트 초기화 실패`;
            else alertMsg += `\nAzure 텍스트 AI: ${d.azureTextCount}건 → ${d.azureTextFlaggedCount}건 플래그${d.azureTextErrorCount ? ` (오류 ${d.azureTextErrorCount})` : ""}`;
        }
        if (d.imageEnabled && d.imageScreenedCount > 0) {
            alertMsg += `\nNSFWJS: ${d.nsfwjsCount}건 (안전:${d.nsfwjsSafeCount||0} 애매:${d.nsfwjsAmbiguousCount||0} 플래그:${d.nsfwjsFlaggedCount||0} 오류:${d.nsfwjsErrorCount||0})`;
            if (d.azureEnabled) alertMsg += `\nAzure: ${d.azureCount}건 정밀검사 → ${d.azureFlaggedCount}건 플래그${d.azureErrorCount ? ` (오류 ${d.azureErrorCount})` : ""}`;
        }
        alert(alertMsg);
        // 현재 뷰에 따라 적절한 데이터 새로고침
        loadStats("planner");
        if (_currentView === "results") {
            loadResults();
        }
    } catch (e) {
        terror("AutoScreen", `${modeLabel} 실패: ` + e.message);
        alert(`${modeLabel} 실패: ` + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "스크리닝";
    }
}

// ─── 결과 뷰 ───

function renderResults() {
    const el = document.getElementById("as-view-content");
    el.innerHTML = `
        <div class="card">
            <h2>스크리닝 결과</h2>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
                <button class="btn btn-outline btn-sm" id="btn-load-results">결과 조회</button>
                <select id="as-filter-type" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                    <option value="">전체 유형</option>
                    <option value="profile">프로필</option>
                    <option value="planner">플래너</option>
                </select>
                <select id="as-filter-status" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                    <option value="">전체 상태</option>
                    <option value="clean">정상 (Clean)</option>
                    <option value="pending">검토 대기</option>
                    <option value="approved">승인됨</option>
                    <option value="rejected">거부됨</option>
                    <option value="auto_deleted">자동 삭제</option>
                    <option value="auto_hidden">자동 숨김</option>
                </select>
                <select id="as-filter-severity" style="width:auto; padding:6px 10px; font-size:0.8rem;">
                    <option value="">전체 심각도</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                </select>
                <span class="text-sub text-sm" id="as-result-count"></span>
            </div>
            <div id="as-result-list"></div>
        </div>
        <div id="as-detail-panel" class="hidden">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 id="as-detail-title">스크리닝 상세</h2>
                    <button class="btn btn-outline btn-sm" id="btn-close-as-detail">닫기</button>
                </div>
                <div id="as-detail-content"></div>
                <div id="as-detail-actions" style="border-top:1px solid var(--border); padding-top:16px; margin-top:16px;"></div>
            </div>
        </div>
    `;

    document.getElementById("btn-load-results").addEventListener("click", loadResults);
    document.getElementById("btn-close-as-detail").addEventListener("click", () => {
        document.getElementById("as-detail-panel").classList.add("hidden");
    });
}

async function loadResults() {
    const listEl = document.getElementById("as-result-list");
    const countEl = document.getElementById("as-result-count");
    listEl.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("AutoScreen", "스크리닝 결과 로딩...");

    const type = document.getElementById("as-filter-type").value || undefined;
    const status = document.getElementById("as-filter-status").value || undefined;
    const severity = document.getElementById("as-filter-severity").value || undefined;

    try {
        const data = await callAdmin("getScreeningResults", { type, status, severity });
        _results = data.results || [];
        tok("AutoScreen", `${_results.length}건 조회 완료`);
        countEl.textContent = `${_results.length}건`;

        if (_results.length === 0) {
            listEl.innerHTML = '<p class="text-sub text-sm">스크리닝 결과가 없습니다.</p>';
            return;
        }

        listEl.innerHTML = renderResultTable(_results);
        bindResultClicks();
    } catch (e) {
        terror("AutoScreen", "결과 로드 실패: " + e.message);
        listEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderResultTable(results) {
    let html = `<table>
        <thead><tr>
            <th>유형</th>
            <th>작성자</th>
            <th>캡션</th>
            <th>텍스트 플래그</th>
            <th>썸네일</th>
            <th>이미지 플래그</th>
            <th>심각도</th>
            <th>상태</th>
            <th>스크리닝 시간</th>
        </tr></thead>
        <tbody>`;

    for (const r of results) {
        const captionPreview = escHtml((r.caption || "").substring(0, 40)) + (r.caption && r.caption.length > 40 ? "..." : "");
        const dt = r.screenedAt ? new Date(r.screenedAt).toLocaleString("ko-KR") : "—";
        const sevBadge = getSeverityBadge(r.overallSeverity);
        const statusBadge = getStatusBadge(r.status);

        // 텍스트 플래그 요약
        const textFlagsSummary = renderTextFlagsSummary(r);

        // 썸네일 (photo 필드 없으면 Storage 경로에서 직접 구성)
        let thumbSrc, thumbFallback;
        if (r.type === "profile") {
            thumbSrc = r.photo || getProfilePhotoUrl(r.ownerUid);
            thumbFallback = null;
        } else {
            const thumbTs = getPostTimestamp(r.postId);
            thumbSrc = r.photo || getReelsPhotoUrl(r.ownerUid, thumbTs);
            thumbFallback = getReelsPhotoUrlJpg(r.ownerUid, thumbTs);
        }
        const thumbnailHtml = thumbFallback
            ? `<img src="${escHtml(thumbSrc)}" alt="thumb" style="width:48px; height:48px; object-fit:cover; border-radius:${r.type === "profile" ? "50%" : "4px"}; border:1px solid var(--border);" onerror="if(this.src.includes('.webp')){this.src='${escHtml(thumbFallback)}'}else{this.style.display='none'}">`
            : `<img src="${escHtml(thumbSrc)}" alt="thumb" style="width:48px; height:48px; object-fit:cover; border-radius:${r.type === "profile" ? "50%" : "4px"}; border:1px solid var(--border);" onerror="this.style.display='none'">`;

        // 이미지 플래그 요약
        const imageFlagsSummary = renderImageFlagsSummary(r);

        const typeBadge = r.type === "profile"
            ? '<span class="badge badge-info">프로필</span>'
            : '<span class="badge badge-info">플래너</span>';

        html += `<tr class="as-row as-sev-${r.overallSeverity}" data-postid="${escHtml(r.postId)}" style="cursor:pointer;">
            <td>${typeBadge}</td>
            <td>${escHtml(r.ownerName || "—")}</td>
            <td class="text-sm">${captionPreview || '<span class="text-sub">—</span>'}</td>
            <td class="text-sm">${textFlagsSummary}</td>
            <td style="text-align:center;">${thumbnailHtml}</td>
            <td class="text-sm">${imageFlagsSummary}</td>
            <td>${sevBadge}</td>
            <td>${statusBadge}</td>
            <td class="text-sub text-sm">${dt}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function renderTextFlagsSummary(r) {
    const catLabels = {
        profanity: "욕설", hate: "혐오", spam: "스팸", nsfw: "음란", illegal: "불법",
        perspective_toxicity: "AI:독성", perspective_severe_toxicity: "AI:극심한독성",
        perspective_identity_attack: "AI:혐오", perspective_insult: "AI:모욕",
        perspective_profanity: "AI:비속어", perspective_threat: "AI:위협",
    };
    if (!r.textFlags || r.textFlags.length === 0) {
        return '<span class="text-sub">없음</span>';
    }
    return r.textFlags.map(f =>
        `<span class="as-keyword-tag as-tag-${f.severity}" style="font-size:11px; padding:1px 6px; margin:1px;">${escHtml(f.keyword)} <span class="text-sub">(${catLabels[f.category] || f.category})</span></span>`
    ).join("");
}

function renderImageFlagsSummary(r) {
    if (r.imageFlags) {
        const imgLabels = { adult: "성인", violence: "폭력", racy: "선정", hate: "혐오", selfHarm: "자해" };
        const source = r.imageFlags._source === "azure" ? "Azure" : "NSFWJS";
        const flags = Object.entries(r.imageFlags)
            .filter(([key]) => !key.startsWith("_"))
            .filter(([, val]) => val === "POSSIBLE" || val === "LIKELY" || val === "VERY_LIKELY")
            .map(([key, val]) =>
                `<span class="as-keyword-tag as-tag-${getImageFlagSeverity(val)}" style="font-size:11px; padding:1px 6px; margin:1px;">${imgLabels[key] || key}: ${val}</span>`
            ).join("");
        if (flags) {
            return `<span class="text-sub" style="font-size:10px;">[${source}]</span> ${flags}`;
        }
        return `<span class="text-sub" style="font-size:10px;">[${source}]</span> <span class="text-sub">정상</span>`;
    }
    // engineData가 있으면 분석은 했지만 플래그가 없는 경우
    if (r.engineData && r.engineData.nsfwjsVerdict) {
        const verdict = r.engineData.nsfwjsVerdict;
        if (verdict === "safe") return '<span class="text-sub">정상</span>';
        if (verdict === "error") return '<span class="text-sub" style="color:var(--error);">오류</span>';
        return '<span class="text-sub">검토 필요</span>';
    }
    return '<span class="text-sub">미분석</span>';
}

function getSeverityBadge(severity) {
    const map = {
        low: '<span class="badge as-badge-low">LOW</span>',
        medium: '<span class="badge as-badge-medium">MEDIUM</span>',
        high: '<span class="badge as-badge-high">HIGH</span>'
    };
    return map[severity] || '<span class="badge badge-info">—</span>';
}

function getStatusBadge(status) {
    const map = {
        clean: '<span class="badge badge-ok">정상</span>',
        pending: '<span class="badge badge-warn">검토 대기</span>',
        approved: '<span class="badge badge-ok">승인</span>',
        rejected: '<span class="badge badge-fail">거부</span>',
        auto_deleted: '<span class="badge badge-fail">자동삭제</span>',
        auto_hidden: '<span class="badge as-badge-medium">자동숨김</span>'
    };
    return map[status] || '<span class="badge badge-info">—</span>';
}

function bindResultClicks() {
    document.querySelectorAll(".as-row").forEach(row => {
        row.addEventListener("click", () => selectResult(row.dataset.postid));
    });
}

function selectResult(postId) {
    const r = _results.find(x => x.postId === postId);
    if (!r) return;

    const panel = document.getElementById("as-detail-panel");
    panel.classList.remove("hidden");

    const isProfile = r.type === "profile";
    document.getElementById("as-detail-title").textContent = isProfile
        ? `${r.ownerName || r.ownerUid}의 프로필 이미지 스크리닝`
        : `${r.ownerName || "—"}의 포스트 스크리닝`;

    const dt = r.screenedAt ? new Date(r.screenedAt).toLocaleString("ko-KR") : "—";
    const reviewDt = r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("ko-KR") : "—";

    let photoHtml;
    if (isProfile) {
        const detailPhotoSrc = r.photo || getProfilePhotoUrl(r.ownerUid);
        photoHtml = `<div style="margin-top:12px;">
            <img src="${escHtml(detailPhotoSrc)}" alt="profile photo"
                 style="max-width:200px; max-height:200px; border-radius:50%; border:2px solid var(--border);"
                 onerror="this.style.display='none'">
        </div>`;
    } else {
        const detailTs = getPostTimestamp(r.postId);
        const detailPhotoSrc = r.photo || getReelsPhotoUrl(r.ownerUid, detailTs);
        const detailPhotoFallback = getReelsPhotoUrlJpg(r.ownerUid, detailTs);
        photoHtml = `<div style="margin-top:12px;">
            <img src="${escHtml(detailPhotoSrc)}" alt="post photo"
                 style="max-width:100%; max-height:300px; border-radius:8px; border:1px solid var(--border);"
                 onerror="if(this.src.includes('.webp')){this.src='${escHtml(detailPhotoFallback)}'}else{this.style.display='none'}">
        </div>`;
    }

    // 텍스트 플래그 표시
    const catLabels = {
        profanity: "욕설/비속어",
        hate: "혐오표현",
        spam: "스팸/홍보",
        nsfw: "음란물",
        illegal: "불법정보",
        azure_hate: "AI:혐오표현",
        azure_violence: "AI:폭력",
        azure_sexual: "AI:성적콘텐츠",
        azure_selfharm: "AI:자해",
    };

    let textFlagsHtml = '<p class="text-sub text-sm">텍스트 플래그 없음</p>';
    if (r.textFlags && r.textFlags.length > 0) {
        textFlagsHtml = '<div class="as-keyword-tags">' +
            r.textFlags.map(f =>
                `<span class="as-keyword-tag as-tag-${f.severity}">${escHtml(f.keyword)} <span class="text-sub">(${catLabels[f.category] || f.category})</span></span>`
            ).join("") + '</div>';
    }

    // 이미지 플래그 표시 (하이브리드: NSFWJS + Azure)
    let imageFlagsHtml = '<p class="text-sub text-sm">이미지 분석 없음</p>';
    if (r.imageFlags) {
        const imgLabels = { adult: "성인", violence: "폭력", racy: "선정", hate: "혐오", selfHarm: "자해" };
        const source = r.imageFlags._source === "azure" ? "Azure Content Safety" : "NSFWJS (로컬)";
        const sourceBadge = `<span class="badge badge-info" style="margin-bottom:6px;">${source}</span>`;

        const mainFlags = Object.entries(r.imageFlags)
            .filter(([key]) => !key.startsWith("_"))
            .map(([key, val]) =>
                `<span class="as-keyword-tag as-tag-${getImageFlagSeverity(val)}">${imgLabels[key] || key}: ${val}</span>`
            ).join("");

        let nsfwScoresHtml = "";
        if (r.imageFlags._nsfwScores) {
            const ns = r.imageFlags._nsfwScores;
            nsfwScoresHtml = `<div style="margin-top:6px;" class="text-sub text-sm">NSFWJS: Porn=${(ns.porn||0).toFixed(2)} Sexy=${(ns.sexy||0).toFixed(2)} Hentai=${(ns.hentai||0).toFixed(2)} Neutral=${(ns.neutral||0).toFixed(2)}</div>`;
        }

        imageFlagsHtml = sourceBadge + '<div class="as-keyword-tags">' + mainFlags + '</div>' + nsfwScoresHtml;
    }

    // Azure 텍스트 분석 엔진 데이터 표시
    let perspectiveHtml = "";
    if (r.engineData && r.engineData.azureTextVerdict) {
        const tv = r.engineData.azureTextVerdict;
        const ts = r.engineData.azureTextScores;
        const tvBadge = tv === "flagged"
            ? '<span class="badge badge-fail">플래그</span>'
            : tv === "clean" ? '<span class="badge badge-ok">정상</span>'
            : tv === "error" ? '<span class="badge badge-warn">오류</span>' : "";
        let scoresHtml = "";
        if (ts) {
            const catLabels = { Hate: "혐오표현", Violence: "폭력", Sexual: "성적콘텐츠", SelfHarm: "자해" };
            const sevLabels = { 0: "Safe", 2: "Low", 4: "Medium", 6: "High" };
            const sevColors = { 0: "var(--text-sub)", 2: "#ffc107", 4: "#ff9800", 6: "var(--error)" };
            scoresHtml = Object.entries(ts)
                .sort(([, a], [, b]) => b - a)
                .map(([k, v]) =>
                    `<span style="color:${sevColors[v] || "var(--text-sub)"}; font-size:11px; margin-right:8px;">${catLabels[k] || k}: ${sevLabels[v] ?? v}</span>`
                ).join("");
            scoresHtml = `<div style="margin-top:4px;">${scoresHtml}</div>`;
        }
        perspectiveHtml = `<div style="margin-top:12px;">
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:6px;">Azure 텍스트 AI 분석 ${tvBadge}</h3>
            ${scoresHtml || '<p class="text-sub text-sm">점수 없음</p>'}
        </div>`;
    }

    document.getElementById("as-detail-content").innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(r.ownerName || r.ownerUid || "—")}</div><div class="stat-label">${isProfile ? "유저" : "작성자"}</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${getSeverityBadge(r.overallSeverity)}</div><div class="stat-label">심각도</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${getStatusBadge(r.status)}</div><div class="stat-label">상태</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${dt}</div><div class="stat-label">스크리닝 시간</div></div>
        </div>
        <p class="text-sub text-sm">UID: ${r.ownerUid} | ${isProfile ? "유형: 프로필" : `PostID: ${r.postId}`}</p>
        ${r.reviewedBy ? `<p class="text-sub text-sm">검토: ${escHtml(r.reviewedBy)} (${reviewDt})</p>` : ""}
        ${!isProfile ? `<div style="margin-top:12px; padding:12px; background:var(--bg-input); border-radius:8px;">
            <p class="text-sm" style="white-space:pre-wrap;">${escHtml(r.caption || "(캡션 없음)")}</p>
        </div>` : ""}
        ${photoHtml}
        ${!isProfile ? `<div style="margin-top:16px;">
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:8px;">텍스트 플래그</h3>
            ${textFlagsHtml}
        </div>` : ""}
        ${!isProfile ? perspectiveHtml : ""}
        <div style="margin-top:12px;">
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:8px;">이미지 플래그</h3>
            ${imageFlagsHtml}
        </div>
    `;

    // 액션 버튼 (pending 또는 auto_hidden 상태만)
    const actionsEl = document.getElementById("as-detail-actions");
    if (r.status === "pending" || r.status === "auto_hidden") {
        actionsEl.innerHTML = `
            <div style="display:flex; gap:8px;">
                <button class="btn btn-sm" style="background:var(--success); color:#fff;" id="btn-approve-post">승인 (문제 없음)</button>
                <button class="btn btn-danger btn-sm" id="btn-reject-post">거부 (포스트 삭제)</button>
            </div>
            <div id="as-review-result" style="margin-top:8px;"></div>
        `;
        document.getElementById("btn-approve-post").addEventListener("click", () => reviewPost(r.postId, "approved"));
        document.getElementById("btn-reject-post").addEventListener("click", () => reviewPost(r.postId, "rejected"));
    } else {
        actionsEl.innerHTML = `<p class="text-sub text-sm">이미 처리된 항목입니다 (${getStatusBadge(r.status)})</p>`;
    }

    panel.scrollIntoView({ behavior: "smooth" });
}

function getImageFlagSeverity(likelihood) {
    const map = { VERY_LIKELY: "high", LIKELY: "high", POSSIBLE: "medium", UNLIKELY: "low", VERY_UNLIKELY: "low" };
    return map[likelihood] || "low";
}

async function reviewPost(postId, action) {
    const resultEl = document.getElementById("as-review-result");
    const actionLabel = action === "approved" ? "승인" : "거부";

    if (action === "rejected" && !confirm("이 포스트를 거부하고 삭제하시겠습니까?\n\n이 작업은 복구할 수 없습니다.")) return;

    resultEl.innerHTML = `<p class="text-sub text-sm">${actionLabel} 처리 중...</p>`;
    tlog("AutoScreen", `포스트 ${actionLabel} 처리 중: ${postId}`);

    try {
        await callAdmin("reviewScreenedPost", { postId, reviewAction: action });
        tok("AutoScreen", `포스트 ${actionLabel} 완료: ${postId}`);
        resultEl.innerHTML = `<p class="text-success text-sm">${actionLabel} 완료!</p>`;

        // 로컬 데이터 업데이트
        const idx = _results.findIndex(x => x.postId === postId);
        if (idx >= 0) {
            _results[idx].status = action;
        }

        setTimeout(() => {
            document.getElementById("as-detail-panel").classList.add("hidden");
            const listEl = document.getElementById("as-result-list");
            if (listEl && _results.length > 0) {
                listEl.innerHTML = renderResultTable(_results);
                bindResultClicks();
            }
        }, 1000);
    } catch (e) {
        terror("AutoScreen", `포스트 ${actionLabel} 실패: ${e.message}`);
        resultEl.innerHTML = `<p class="text-error text-sm">${actionLabel} 실패: ${e.message}</p>`;
    }
}

// ─── 설정 뷰 ───

function renderConfig() {
    const el = document.getElementById("as-view-content");
    el.innerHTML = `
        <div class="card">
            <h2>스크리닝 설정</h2>
            <button class="btn btn-outline btn-sm" id="btn-load-config" style="margin-bottom:16px;">설정 로드</button>
            <div id="as-config-area">
                <p class="text-sub text-sm">설정을 로드하려면 위 버튼을 클릭하세요.</p>
            </div>
        </div>
    `;

    document.getElementById("btn-load-config").addEventListener("click", loadConfig);
}

async function loadConfig() {
    const area = document.getElementById("as-config-area");
    area.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("AutoScreen", "스크리닝 설정 로딩...");

    try {
        _config = await callAdmin("getScreeningConfig");
        tok("AutoScreen", "설정 로드 완료");
        renderConfigForm();
    } catch (e) {
        terror("AutoScreen", "설정 로드 실패: " + e.message);
        area.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderConfigForm() {
    const area = document.getElementById("as-config-area");
    const s = _config.settings || {};
    const k = _config.keywords || {};
    const categories = k.categories || {};

    const catLabels = {
        profanity: "욕설/비속어",
        hate: "혐오표현",
        spam: "스팸/홍보",
        nsfw: "음란물",
        illegal: "불법정보"
    };

    // Azure F0 한도 초과 알림 표시
    let rateLimitBanner = "";
    if (s._azureRateLimitedAt) {
        const limitDt = new Date(s._azureRateLimitedAt).toLocaleString("ko-KR");
        rateLimitBanner = `
            <div style="background:#ff525220; border:1px solid #ff5252; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
                <strong style="color:#ff5252;">Azure F0 한도 초과</strong>
                <p class="text-sm" style="margin-top:4px; color:var(--text);">
                    ${limitDt}에 Azure Content Safety F0 월간 한도(5,000건)가 초과되었습니다.<br>
                    현재 NSFWJS fallback으로 자동 전환되어 운영 중입니다.<br>
                    <span class="text-sub">다음 달 1일에 한도가 리셋되거나, S0 유료 tier로 업그레이드하세요.</span>
                </p>
            </div>`;
    }

    area.innerHTML = `
        ${rateLimitBanner}
        <!-- 일반 설정 -->
        <div style="margin-bottom:24px;">
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:12px;">일반 설정</h3>
            <div class="as-settings-grid">
                <label class="as-toggle-row">
                    <input type="checkbox" id="cfg-text-enabled" ${s.textScreeningEnabled !== false ? "checked" : ""}>
                    <span>텍스트 스크리닝 활성화</span>
                </label>
                <label class="as-toggle-row">
                    <input type="checkbox" id="cfg-image-enabled" ${s.imageScreeningEnabled ? "checked" : ""}>
                    <span>이미지 스크리닝 활성화 <span class="text-sub">(NSFWJS 1차 무료)</span></span>
                </label>
                <label class="as-toggle-row">
                    <input type="checkbox" id="cfg-azure-enabled" ${s.azureEnabled ? "checked" : ""}>
                    <span>Azure 2차 정밀검사 <span class="text-sub">(F0: 5,000건/월 무료, 애매한 결과만 호출)</span></span>
                </label>
                <label class="as-toggle-row">
                    <input type="checkbox" id="cfg-azure-text-enabled" ${s.azureTextEnabled ? "checked" : ""}>
                    <span>Azure 텍스트 독성 분석 <span class="text-sub">(ML 기반, F0: 5,000건/월 무료 — 기존 AZURE_CS_KEY 재사용)</span></span>
                </label>
                <label class="as-toggle-row">
                    <input type="checkbox" id="cfg-notify" ${s.notifyOnFlag !== false ? "checked" : ""}>
                    <span>플래그 시 알림</span>
                </label>
            </div>
            <div style="margin-top:12px; display:flex; gap:12px; flex-wrap:wrap;">
                <div>
                    <label class="text-sub text-sm">자동 숨김 임계값</label>
                    <select id="cfg-hide-threshold" style="width:auto; padding:6px 10px; font-size:0.8rem; margin-left:8px;">
                        <option value="low" ${s.autoHideThreshold === "low" ? "selected" : ""}>Low</option>
                        <option value="medium" ${s.autoHideThreshold === "medium" || !s.autoHideThreshold ? "selected" : ""}>Medium</option>
                        <option value="high" ${s.autoHideThreshold === "high" ? "selected" : ""}>High</option>
                    </select>
                </div>
                <div>
                    <label class="text-sub text-sm">자동 삭제 임계값</label>
                    <select id="cfg-delete-threshold" style="width:auto; padding:6px 10px; font-size:0.8rem; margin-left:8px;">
                        <option value="low" ${s.autoDeleteThreshold === "low" ? "selected" : ""}>Low</option>
                        <option value="medium" ${s.autoDeleteThreshold === "medium" ? "selected" : ""}>Medium</option>
                        <option value="high" ${s.autoDeleteThreshold === "high" || !s.autoDeleteThreshold ? "selected" : ""}>High</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-save-settings" style="margin-top:16px;">설정 저장</button>
            <span id="cfg-save-result" style="margin-left:8px;"></span>
        </div>

        <!-- 금칙어 관리 -->
        <div>
            <h3 class="text-sm" style="color:var(--accent); margin-bottom:12px;">금칙어 관리</h3>
            <div id="as-keywords-area">
                ${Object.entries(catLabels).map(([catKey, catLabel]) => {
                    const cat = categories[catKey] || { keywords: [], severity: "medium", enabled: true };
                    return renderCategorySection(catKey, catLabel, cat);
                }).join("")}
            </div>
            <button class="btn btn-primary btn-sm" id="btn-save-keywords" style="margin-top:16px;">금칙어 저장</button>
            <span id="kw-save-result" style="margin-left:8px;"></span>
        </div>
    `;

    document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
    document.getElementById("btn-save-keywords").addEventListener("click", saveKeywords);

    // 금칙어 추가 버튼 이벤트
    document.querySelectorAll(".as-add-keyword-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const cat = btn.dataset.cat;
            const input = document.getElementById(`kw-input-${cat}`);
            const val = (input.value || "").trim();
            if (!val) return;

            const container = document.getElementById(`kw-tags-${cat}`);
            container.insertAdjacentHTML("beforeend", renderKeywordTag(val, cat));
            input.value = "";
            bindTagRemoveButtons();
        });
    });

    // Enter 키로 추가
    document.querySelectorAll(".as-kw-input").forEach(input => {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const cat = input.dataset.cat;
                document.querySelector(`.as-add-keyword-btn[data-cat="${cat}"]`).click();
            }
        });
    });

    bindTagRemoveButtons();
}

function renderCategorySection(catKey, catLabel, cat) {
    const severityOptions = ["low", "medium", "high"].map(s =>
        `<option value="${s}" ${cat.severity === s ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join("");

    const tags = (cat.keywords || []).map(kw => renderKeywordTag(kw, catKey)).join("");

    return `
        <div class="as-category-section" data-cat="${catKey}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label class="as-toggle-row" style="margin:0;">
                    <input type="checkbox" class="as-cat-enabled" data-cat="${catKey}" ${cat.enabled !== false ? "checked" : ""}>
                    <strong>${catLabel}</strong>
                </label>
                <select class="as-cat-severity" data-cat="${catKey}" style="width:auto; padding:4px 8px; font-size:0.75rem;">
                    ${severityOptions}
                </select>
            </div>
            <div class="as-keyword-tags" id="kw-tags-${catKey}">${tags}</div>
            <div style="display:flex; gap:6px; margin-top:8px;">
                <input type="text" class="as-kw-input" data-cat="${catKey}" id="kw-input-${catKey}" placeholder="새 금칙어 추가..." style="flex:1; padding:6px 10px; font-size:0.8rem;">
                <button class="btn btn-outline btn-sm as-add-keyword-btn" data-cat="${catKey}">추가</button>
            </div>
        </div>
    `;
}

function renderKeywordTag(keyword, cat) {
    return `<span class="as-keyword-tag as-tag-removable" data-cat="${cat}" data-keyword="${escHtml(keyword)}">${escHtml(keyword)} <span class="as-tag-remove">&times;</span></span>`;
}

function bindTagRemoveButtons() {
    document.querySelectorAll(".as-tag-remove").forEach(btn => {
        btn.onclick = () => btn.parentElement.remove();
    });
}

async function saveSettings() {
    const resultEl = document.getElementById("cfg-save-result");
    resultEl.innerHTML = '<span class="text-sub text-sm">저장 중...</span>';

    const settings = {
        textScreeningEnabled: document.getElementById("cfg-text-enabled").checked,
        imageScreeningEnabled: document.getElementById("cfg-image-enabled").checked,
        azureEnabled: document.getElementById("cfg-azure-enabled").checked,
        azureTextEnabled: document.getElementById("cfg-azure-text-enabled").checked,
        notifyOnFlag: document.getElementById("cfg-notify").checked,
        autoHideThreshold: document.getElementById("cfg-hide-threshold").value,
        autoDeleteThreshold: document.getElementById("cfg-delete-threshold").value,
    };

    try {
        await callAdmin("updateScreeningConfig", { settings });
        tok("AutoScreen", "설정 저장 완료");
        resultEl.innerHTML = '<span class="text-success text-sm">저장 완료!</span>';
        setTimeout(() => { resultEl.innerHTML = ""; }, 3000);
    } catch (e) {
        terror("AutoScreen", "설정 저장 실패: " + e.message);
        resultEl.innerHTML = `<span class="text-error text-sm">실패: ${e.message}</span>`;
    }
}

async function saveKeywords() {
    const resultEl = document.getElementById("kw-save-result");
    resultEl.innerHTML = '<span class="text-sub text-sm">저장 중...</span>';

    const categories = {};
    const catKeys = ["profanity", "hate", "spam", "nsfw", "illegal"];

    for (const catKey of catKeys) {
        const enabledEl = document.querySelector(`.as-cat-enabled[data-cat="${catKey}"]`);
        const severityEl = document.querySelector(`.as-cat-severity[data-cat="${catKey}"]`);
        const tagEls = document.querySelectorAll(`#kw-tags-${catKey} .as-keyword-tag`);

        categories[catKey] = {
            enabled: enabledEl ? enabledEl.checked : true,
            severity: severityEl ? severityEl.value : "medium",
            keywords: Array.from(tagEls).map(el => el.dataset.keyword)
        };
    }

    try {
        await callAdmin("updateScreeningConfig", { keywords: { categories } });
        tok("AutoScreen", "금칙어 저장 완료");
        resultEl.innerHTML = '<span class="text-success text-sm">저장 완료!</span>';
        setTimeout(() => { resultEl.innerHTML = ""; }, 3000);
    } catch (e) {
        terror("AutoScreen", "금칙어 저장 실패: " + e.message);
        resultEl.innerHTML = `<span class="text-error text-sm">실패: ${e.message}</span>`;
    }
}

// ─── 유틸리티 ───

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
