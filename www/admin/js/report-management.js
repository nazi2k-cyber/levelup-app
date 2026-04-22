// ─── Report Management Module (신고 관리) ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;
let _reports = [];
let _processedPostIds = new Set();
let _applyFilters = null;

const ping = httpsCallable(functions, "ping");

async function callAdmin(action, data = {}) {
    const result = await ping({ action, ...data });
    return result.data;
}

export function initReportManagement(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>신고 관리</h2>
            <p class="text-sub text-sm mb-8">사용자가 신고한 Day1 포스트를 조회하고 처리합니다.</p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <button class="btn btn-outline btn-sm" id="btn-load-reports">신고 목록 조회</button>
                <span class="text-sub text-sm" id="rpt-count"></span>
            </div>
            <div id="rpt-filter-wrap" class="hidden" style="margin-top:12px;">
                <input type="text" id="rpt-search" placeholder="작성자 이름으로 검색...">
                <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select id="rpt-reason-filter" style="padding:4px 8px; font-size:0.8rem; min-width:180px;">
                        <option value="">전체 신고 사유</option>
                        <option value="혐오/차별적/생명경시/욕설 표현입니다.">혐오/차별/욕설</option>
                        <option value="스팸홍보/도배입니다.">스팸/도배</option>
                        <option value="청소년에게 유해한 내용입니다.">청소년 유해</option>
                        <option value="불법정보를 포함하고 있습니다.">불법정보</option>
                        <option value="음란물입니다.">음란물</option>
                        <option value="불쾌한 표현이 있습니다.">불쾌한 표현</option>
                    </select>
                    <input type="text" id="rpt-text-screen" placeholder="텍스트 스크리닝 (캡션 내 특정 단어 필터)..." style="flex:1; min-width:200px;">
                </div>
                <div style="margin-top:8px;">
                    <select id="rpt-processed-filter" style="padding:4px 8px; font-size:0.8rem; min-width:180px;">
                        <option value="">전체 처리 상태</option>
                        <option value="pending">미처리</option>
                        <option value="done">처리 완료</option>
                    </select>
                </div>
            </div>
            <div id="rpt-list" style="margin-top:16px;"></div>
        </div>

        <!-- 신고 상세 모달 -->
        <div id="rpt-detail-panel" class="hidden">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 id="rpt-detail-title">신고 상세</h2>
                    <button class="btn btn-outline btn-sm" id="btn-close-rpt-detail">닫기</button>
                </div>
                <div id="rpt-detail-content"></div>
                <div style="border-top:1px solid var(--border); padding-top:16px; margin-top:16px; display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn btn-danger btn-sm" id="btn-rpt-delete-post">포스트 강제 삭제</button>
                    <button class="btn btn-outline btn-sm" id="btn-rpt-dismiss">신고 기각</button>
                </div>
                <div id="rpt-action-result" style="margin-top:8px;"></div>
            </div>
        </div>
    `;

    document.getElementById("btn-load-reports").addEventListener("click", loadReports);
    document.getElementById("btn-close-rpt-detail").addEventListener("click", closeDetail);
    document.getElementById("btn-rpt-delete-post").addEventListener("click", () => deleteReportedPost(true));
    document.getElementById("btn-rpt-dismiss").addEventListener("click", dismissReport);
}

let _selectedReport = null;

async function loadReports() {
    const listEl = document.getElementById("rpt-list");
    const countEl = document.getElementById("rpt-count");
    listEl.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    countEl.textContent = "";
    tlog("Reports", "신고 목록 로딩...");

    try {
        const result = await callAdmin("screeningListReports");
        _reports = result.reports || [];
        _processedPostIds = new Set(_reports.filter(r => r.processed).map(r => r.postId));
        tok("Reports", `${_reports.length}개 신고 조회 완료`);
        countEl.textContent = `총 ${_reports.length}개`;

        if (_reports.length === 0) {
            listEl.innerHTML = '<p class="text-sub text-sm">신고된 포스트가 없습니다.</p>';
            document.getElementById("rpt-filter-wrap").classList.add("hidden");
            return;
        }

        document.getElementById("rpt-filter-wrap").classList.remove("hidden");
        listEl.innerHTML = renderReportTable(_reports);
        bindReportClicks();

        function applyFilters() {
            const q = (document.getElementById("rpt-search").value || "").toLowerCase();
            const reasonFilter = document.getElementById("rpt-reason-filter").value;
            const textScreen = (document.getElementById("rpt-text-screen").value || "").toLowerCase();
            const processedFilter = document.getElementById("rpt-processed-filter").value;
            let filtered = _reports;
            if (q) {
                filtered = filtered.filter(r =>
                    (r.ownerName || "").toLowerCase().includes(q)
                );
            }
            if (reasonFilter) {
                filtered = filtered.filter(r =>
                    (r.reporters || []).some(rep => (rep.reason || "") === reasonFilter)
                );
            }
            if (textScreen) {
                const keywords = textScreen.split(/[,\s]+/).filter(Boolean);
                filtered = filtered.filter(r =>
                    keywords.some(kw => (r.caption || "").toLowerCase().includes(kw))
                );
            }
            if (processedFilter === "pending") {
                filtered = filtered.filter(r => !_processedPostIds.has(r.postId));
            } else if (processedFilter === "done") {
                filtered = filtered.filter(r => _processedPostIds.has(r.postId));
            }
            listEl.innerHTML = renderReportTable(filtered);
            countEl.textContent = `총 ${_reports.length}개 / 필터: ${filtered.length}개`;
            bindReportClicks();
        }

        _applyFilters = applyFilters;

        document.getElementById("rpt-search").addEventListener("input", applyFilters);
        document.getElementById("rpt-reason-filter").addEventListener("change", applyFilters);
        document.getElementById("rpt-text-screen").addEventListener("input", applyFilters);
        document.getElementById("rpt-processed-filter").addEventListener("change", applyFilters);
    } catch (e) {
        terror("Reports", "신고 목록 로드 실패: " + e.message);
        listEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderReportTable(reports) {
    let html = `<table>
        <thead><tr>
            <th>사진</th>
            <th>작성자</th>
            <th>작성자 이메일</th>
            <th>캡션</th>
            <th>신고 사유</th>
            <th>신고 횟수</th>
            <th>최근 신고</th>
        </tr></thead>
        <tbody>`;
    for (const r of reports) {
        const lastReported = r.lastReportedAt ? new Date(r.lastReportedAt).toLocaleString("ko-KR") : "—";
        const captionPreview = escHtml((r.caption || "").substring(0, 30)) + (r.caption && r.caption.length > 30 ? "..." : "");
        const countBadge = r.reportCount >= 3
            ? `<span class="badge badge-fail">${r.reportCount}건</span>`
            : `<span class="badge badge-warn">${r.reportCount}건</span>`;
        const thumbHtml = r.photo
            ? `<img src="${escHtml(r.photo)}" class="ps-thumb" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
              + `<span class="text-sub" style="display:none">—</span>`
            : '<span class="text-sub">—</span>';

        // 가장 최근 신고 사유 표시
        const latestReason = (r.reporters || []).length > 0
            ? escHtml((r.reporters[r.reporters.length - 1].reason || "—").substring(0, 15))
              + ((r.reporters[r.reporters.length - 1].reason || "").length > 15 ? "..." : "")
            : '—';

        const isProcessed = _processedPostIds.has(r.postId);
        const processedStyle = isProcessed ? ' opacity:0.5;' : '';
        const processedBadge = isProcessed ? '<span class="badge badge-ok" style="margin-left:4px;font-size:0.7rem;">처리완료</span>' : '';

        html += `<tr class="rpt-row" data-post-id="${escHtml(r.postId)}" style="cursor:pointer;${processedStyle}">
            <td>${thumbHtml}</td>
            <td>${escHtml(r.ownerName || "—")}${processedBadge}</td>
            <td class="text-sub text-sm">${escHtml(r.ownerEmail || "—")}</td>
            <td class="text-sm">${captionPreview || '<span class="text-sub">—</span>'}</td>
            <td class="text-sm">${latestReason}</td>
            <td>${countBadge}</td>
            <td class="text-sub text-sm">${lastReported}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function bindReportClicks() {
    document.querySelectorAll(".rpt-row").forEach(row => {
        row.addEventListener("click", () => {
            selectReport(row.dataset.postId);
        });
    });
}

function selectReport(postId) {
    _selectedReport = _reports.find(r => r.postId === postId);
    if (!_selectedReport) return;

    const panel = document.getElementById("rpt-detail-panel");
    panel.classList.remove("hidden");

    document.getElementById("rpt-detail-title").textContent = `신고 상세: ${_selectedReport.ownerName || "—"}`;
    document.getElementById("rpt-action-result").innerHTML = "";

    const reportersHtml = (_selectedReport.reporters || []).map(rep => {
        const dt = rep.timestamp ? new Date(rep.timestamp).toLocaleString("ko-KR") : "—";
        return `<div style="padding:6px 0; border-bottom:1px solid var(--border);">
            <span class="text-sm" style="font-weight:600;">${escHtml(rep.name)}</span>
            ${rep.email ? `<span class="text-sub text-sm" style="margin-left:6px;">${escHtml(rep.email)}</span>` : ''}
            <span class="text-sub text-sm" style="margin-left:8px;">${dt}</span>
            ${rep.reason ? `<div class="text-sm" style="margin-top:4px; color:var(--warning);"><span style="background:rgba(255,193,7,0.12); padding:2px 8px; border-radius:4px;">📋 ${escHtml(rep.reason)}</span></div>` : ''}
        </div>`;
    }).join('');

    document.getElementById("rpt-detail-content").innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value text-sm">${_selectedReport.reportCount || 0}</div><div class="stat-label">신고 횟수</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(_selectedReport.ownerName || "—")}</div><div class="stat-label">작성자</div></div>
            ${_selectedReport.ownerEmail ? `<div class="stat-card"><div class="stat-value text-sm" style="font-size:0.75rem;">${escHtml(_selectedReport.ownerEmail)}</div><div class="stat-label">작성자 이메일</div></div>` : ''}
        </div>
        <p class="text-sub text-sm">Post ID: ${escHtml(_selectedReport.postId)}</p>
        ${_selectedReport.photo ? `<div style="margin-top:12px;">
            <img src="${escHtml(_selectedReport.photo)}" alt="post photo"
                 style="max-width:100%; max-height:300px; border-radius:8px; border:1px solid var(--border);"
                 onerror="this.style.display='none'">
        </div>` : ''}
        ${_selectedReport.caption ? `<div style="margin-top:12px; padding:12px; background:var(--bg-input); border-radius:8px;">
            <p class="text-sm" style="white-space:pre-wrap;">${escHtml(_selectedReport.caption)}</p>
        </div>` : ''}
        <div style="margin-top:16px;">
            <h3 style="font-size:0.85rem; color:var(--accent); margin-bottom:8px;">신고자 목록</h3>
            ${reportersHtml || '<p class="text-sub text-sm">신고자 정보 없음</p>'}
        </div>
    `;

    const isProcessed = _processedPostIds.has(_selectedReport.postId);
    const deleteBtn = document.getElementById("btn-rpt-delete-post");
    const dismissBtn = document.getElementById("btn-rpt-dismiss");
    deleteBtn.disabled = isProcessed;
    dismissBtn.disabled = isProcessed;
    deleteBtn.style.opacity = isProcessed ? "0.45" : "";
    dismissBtn.style.opacity = isProcessed ? "0.45" : "";

    panel.scrollIntoView({ behavior: "smooth" });
}

function closeDetail() {
    document.getElementById("rpt-detail-panel").classList.add("hidden");
    _selectedReport = null;
}

async function deleteReportedPost(sendNotification = false) {
    if (!_selectedReport) return;
    const resultEl = document.getElementById("rpt-action-result");

    const parts = _selectedReport.postId.split("_");
    const ownerUid = parts.slice(0, -1).join("_");
    const timestamp = parseInt(parts[parts.length - 1], 10);

    if (!confirm(`${_selectedReport.ownerName || "—"}의 포스트를 강제 삭제하고\n삭제 안내 메시지를 해당 유저에게 발송하시겠습니까?\n\n이 작업은 복구할 수 없습니다.`)) return;

    tlog("Reports", `신고 포스트 삭제 중: ${_selectedReport.postId}`);
    resultEl.innerHTML = '<p class="text-sub text-sm">삭제 중...</p>';

    try {
        await callAdmin("screeningDeletePost", { ownerUid, timestamp, sendNotification });

        tok("Reports", `포스트 삭제 완료: ${_selectedReport.postId}`);
        resultEl.innerHTML = `<p class="text-success text-sm">포스트 삭제 완료! (삭제 안내 발송 완료)</p>`;

        _processedPostIds.add(_selectedReport.postId);
        if (_applyFilters) _applyFilters();
        else { document.getElementById("rpt-list").innerHTML = renderReportTable(_reports); bindReportClicks(); }

        setTimeout(closeDetail, 1500);
    } catch (e) {
        terror("Reports", "포스트 삭제 실패: " + e.message);
        resultEl.innerHTML = `<p class="text-error text-sm">삭제 실패: ${e.message}</p>`;
    }
}

async function dismissReport() {
    if (!_selectedReport) return;
    const resultEl = document.getElementById("rpt-action-result");

    if (!confirm(`이 신고를 기각하시겠습니까?\n\n신고 데이터가 삭제됩니다.`)) return;

    tlog("Reports", `신고 기각 중: ${_selectedReport.postId}`);
    resultEl.innerHTML = '<p class="text-sub text-sm">처리 중...</p>';

    try {
        await callAdmin("screeningDismissReport", { postId: _selectedReport.postId });
        tok("Reports", `신고 기각 완료: ${_selectedReport.postId}`);
        resultEl.innerHTML = '<p class="text-success text-sm">신고 기각 완료!</p>';

        _processedPostIds.add(_selectedReport.postId);
        if (_applyFilters) _applyFilters();
        else { document.getElementById("rpt-list").innerHTML = renderReportTable(_reports); bindReportClicks(); }

        setTimeout(closeDetail, 1500);
    } catch (e) {
        terror("Reports", "신고 기각 실패: " + e.message);
        resultEl.innerHTML = `<p class="text-error text-sm">처리 실패: ${e.message}</p>`;
    }
}

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
