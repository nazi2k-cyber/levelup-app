// ─── User Management Module ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;
let _users = [];
let _selectedUid = null;

const ping = httpsCallable(functions, "ping");

async function callAdmin(action, data = {}) {
    const result = await ping({ action, ...data });
    return result.data;
}

export function initUserManagement(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>유저 관리</h2>
            <p class="text-sub text-sm mb-8">유저 데이터 초기화, 롤백, 계정 관리</p>
            <button class="btn btn-outline btn-sm" id="btn-load-users">유저 목록 불러오기</button>
            <div id="um-user-list" style="margin-top:16px;"></div>
        </div>

        <!-- 선택된 유저 상세 패널 -->
        <div id="um-detail-panel" class="hidden">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 id="um-detail-title">유저 상세</h2>
                    <button class="btn btn-outline btn-sm" id="btn-close-detail">닫기</button>
                </div>
                <div id="um-detail-info" class="mb-16"></div>

                <!-- 데이터 관리 -->
                <div style="border-top:1px solid var(--border); padding-top:16px; margin-bottom:16px;">
                    <h2 style="margin-bottom:12px;">데이터 관리</h2>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" id="btn-backup">백업 생성</button>
                        <button class="btn btn-outline btn-sm" id="btn-view-backups">백업 목록</button>
                        <button class="btn btn-danger btn-sm" id="btn-reset-user">데이터 초기화</button>
                    </div>
                    <div id="um-backups-panel" class="hidden" style="margin-top:12px;"></div>
                </div>

                <!-- 계정 관리 -->
                <div style="border-top:1px solid var(--border); padding-top:16px;">
                    <h2 style="margin-bottom:12px;">계정 관리</h2>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" id="btn-reset-pw">비밀번호 재설정</button>
                        <button class="btn btn-outline btn-sm" id="btn-toggle-disable">계정 사용 중지</button>
                        <button class="btn btn-danger btn-sm" id="btn-delete-account">계정 삭제</button>
                    </div>
                    <div id="um-account-result" style="margin-top:8px;"></div>
                </div>
            </div>
        </div>

        <!-- 데이터 일괄 백업 -->
        <div class="card">
            <h2>데이터 일괄 백업</h2>
            <p class="text-sub text-sm mb-8">전체 유저 데이터를 즉시 백업하거나, 자동 백업 주기를 설정합니다.</p>

            <div style="border-bottom:1px solid var(--border); padding-bottom:16px; margin-bottom:16px;">
                <h3 class="text-sm" style="margin-bottom:8px; font-weight:600;">수동 일괄 백업</h3>
                <button class="btn btn-outline btn-sm" id="btn-batch-backup">전체 유저 즉시 백업</button>
                <div id="batch-backup-result" style="margin-top:8px;"></div>
            </div>

            <div style="border-bottom:1px solid var(--border); padding-bottom:16px; margin-bottom:16px;">
                <h3 class="text-sm" style="margin-bottom:8px; font-weight:600;">자동 백업 스케쥴러</h3>
                <div id="backup-scheduler-panel">
                    <p class="text-sub text-sm">스케쥴러 상태를 불러오려면 아래 버튼을 누르세요.</p>
                </div>
                <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" id="btn-load-scheduler">스케쥴러 상태 조회</button>
                    <button class="btn btn-outline btn-sm" id="btn-save-scheduler" style="display:none;">설정 저장</button>
                </div>
            </div>

            <div>
                <h3 class="text-sm" style="margin-bottom:8px; font-weight:600;">백업 세션 목록 / 일괄 롤백</h3>
                <p class="text-sub text-sm mb-8">일괄 백업 시점을 선택해 전체 유저를 해당 시점으로 되돌립니다.</p>
                <div id="batch-sessions-panel">
                    <p class="text-sub text-sm">세션 목록을 불러오려면 아래 버튼을 누르세요.</p>
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-outline btn-sm" id="btn-load-sessions">세션 목록 조회</button>
                </div>
            </div>
        </div>

        <!-- 전체 초기화 -->
        <div class="card">
            <h2>전체 유저 데이터 초기화</h2>
            <p class="text-sub text-sm mb-8">모든 유저의 게임 데이터를 초기 상태로 리셋합니다. (자동 백업 후 진행)</p>
            <button class="btn btn-danger btn-sm" id="btn-reset-all">전체 초기화</button>
        </div>
    `;

    // Event listeners
    document.getElementById("btn-load-users").addEventListener("click", loadUsers);
    document.getElementById("btn-close-detail").addEventListener("click", closeDetail);
    document.getElementById("btn-backup").addEventListener("click", backupUser);
    document.getElementById("btn-view-backups").addEventListener("click", viewBackups);
    document.getElementById("btn-reset-user").addEventListener("click", resetUser);
    document.getElementById("btn-reset-pw").addEventListener("click", resetPassword);
    document.getElementById("btn-toggle-disable").addEventListener("click", toggleDisable);
    document.getElementById("btn-delete-account").addEventListener("click", deleteAccount);
    document.getElementById("btn-reset-all").addEventListener("click", resetAllUsers);
    document.getElementById("btn-batch-backup").addEventListener("click", batchBackupAllUsers);
    document.getElementById("btn-load-scheduler").addEventListener("click", loadSchedulerConfig);
    document.getElementById("btn-save-scheduler").addEventListener("click", saveSchedulerConfig);
    document.getElementById("btn-load-sessions").addEventListener("click", loadBatchSessions);
}

async function loadUsers() {
    const listEl = document.getElementById("um-user-list");
    listEl.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("UserMgmt", "유저 목록 로딩...");

    try {
        const result = await callAdmin("adminListUsers");
        _users = result.users || [];
        tok("UserMgmt", `${_users.length}명 로드 완료`);

        if (_users.length === 0) {
            listEl.innerHTML = '<p class="text-sub text-sm">등록된 유저가 없습니다.</p>';
            return;
        }

        // Search filter + report filter
        let html = `<input type="text" id="um-search" placeholder="이름, 이메일, UID로 검색..." style="margin-bottom:8px;">`;
        html += `<div style="margin-bottom:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <label class="text-sm" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" id="um-filter-reported"> <span style="color:#ff5252;">신고 유저만 보기</span>
            </label>
            <label class="text-sm" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" id="um-filter-total-reported"> <span style="color:#ff5252;">삭제 누적 3회 이상</span>
            </label>
            <label class="text-sm" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" id="um-filter-suspension-count"> <span style="color:#ff8a80;">정지 누적 3회 이상</span>
            </label>
            <select id="um-sort" style="padding:4px 8px; font-size:0.8rem;">
                <option value="name">이름순</option>
                <option value="level-desc">레벨 내림차순</option>
                <option value="report-desc">신고 내림차순</option>
                <option value="total-report-desc">삭제 누적 내림차순</option>
            </select>
        </div>`;
        html += '<div id="um-table-wrap">';
        html += renderUserTable(_users);
        html += '</div>';
        listEl.innerHTML = html;

        function applyUserFilters() {
            const q = (document.getElementById("um-search").value || "").toLowerCase();
            const reportedOnly = document.getElementById("um-filter-reported").checked;
            const totalReportedOnly = document.getElementById("um-filter-total-reported").checked;
            const suspensionCountOnly = document.getElementById("um-filter-suspension-count").checked;
            const sortBy = document.getElementById("um-sort").value;
            let filtered = _users;
            if (q) {
                filtered = filtered.filter(u =>
                    u.displayName.toLowerCase().includes(q) ||
                    (u.email || "").toLowerCase().includes(q) ||
                    u.uid.toLowerCase().includes(q)
                );
            }
            if (reportedOnly) {
                filtered = filtered.filter(u => (u.reportCount || 0) > 0);
            }
            if (totalReportedOnly) {
                filtered = filtered.filter(u => (u.adminDeleteCount || 0) >= 3);
            }
            if (suspensionCountOnly) {
                filtered = filtered.filter(u => (u.suspensionCount || 0) >= 3);
            }
            // 정렬
            filtered = [...filtered];
            if (sortBy === "level-desc") {
                filtered.sort((a, b) => (b.level || 0) - (a.level || 0));
            } else if (sortBy === "report-desc") {
                filtered.sort((a, b) => (b.reportCount || 0) - (a.reportCount || 0));
            } else if (sortBy === "total-report-desc") {
                filtered.sort((a, b) => (b.adminDeleteCount || 0) - (a.adminDeleteCount || 0));
            } else {
                filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
            }
            document.getElementById("um-table-wrap").innerHTML = renderUserTable(filtered);
            bindRowClicks();
        }

        document.getElementById("um-search").addEventListener("input", applyUserFilters);
        document.getElementById("um-filter-reported").addEventListener("change", applyUserFilters);
        document.getElementById("um-filter-total-reported").addEventListener("change", applyUserFilters);
        document.getElementById("um-filter-suspension-count").addEventListener("change", applyUserFilters);
        document.getElementById("um-sort").addEventListener("change", applyUserFilters);

        bindRowClicks();
    } catch (e) {
        terror("UserMgmt", "유저 목록 로드 실패: " + e.message);
        listEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderUserTable(users) {
    let html = `<table>
        <thead><tr><th>이름</th><th>이메일</th><th>레벨</th><th>신고</th><th>삭제 누적</th><th>정지</th><th>정지 누적</th><th>상태</th><th>UID</th></tr></thead>
        <tbody>`;
    for (const u of users) {
        const statusBadge = u.disabled
            ? '<span class="badge badge-fail">중지됨</span>'
            : '<span class="badge badge-ok">활성</span>';
        const rc = u.reportCount || 0;
        const reportBadge = rc > 0
            ? (rc >= 3 ? `<span class="badge badge-fail">${rc}건</span>` : `<span class="badge badge-warn">${rc}건</span>`)
            : '<span class="text-sub">—</span>';
        const adc = u.adminDeleteCount || 0;
        const totalBadge = adc >= 4
            ? `<span class="badge badge-fail">${adc}회</span>`
            : adc >= 3
                ? `<span class="badge badge-warn">${adc}회</span>`
                : adc > 0
                    ? `<span class="badge badge-info">${adc}회</span>`
                    : '<span class="text-sub">—</span>';
        const suspBadge = buildSuspensionBadge(u);
        const sc = u.suspensionCount || 0;
        const suspCountBadge = sc >= 4
            ? `<span class="badge badge-fail">${sc}회</span>`
            : sc >= 3
                ? `<span class="badge badge-warn">${sc}회</span>`
                : sc > 0
                    ? `<span class="badge badge-info">${sc}회</span>`
                    : '<span class="text-sub">—</span>';
        html += `<tr class="um-row${rc > 0 || adc > 0 ? ' ps-reported' : ''}" data-uid="${u.uid}" style="cursor:pointer;">
            <td>${escHtml(u.displayName)}</td>
            <td class="text-sub">${escHtml(u.email || "—")}</td>
            <td>Lv.${u.level}</td>
            <td>${reportBadge}</td>
            <td>${totalBadge}</td>
            <td>${suspBadge}</td>
            <td>${suspCountBadge}</td>
            <td>${statusBadge}</td>
            <td class="text-sub text-sm">${u.uid.substring(0, 12)}...</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function buildSuspensionBadge(u) {
    if (!u.suspendedUntil) return '<span class="text-sub">—</span>';
    const remaining = Math.ceil((u.suspendedUntil - Date.now()) / (1000 * 60 * 60 * 24));
    if (remaining <= 0) return '<span class="badge badge-ok">해제</span>';
    return `<span class="badge badge-warn">D-${remaining}</span>`;
}

function bindRowClicks() {
    document.querySelectorAll(".um-row").forEach(row => {
        row.addEventListener("click", () => selectUser(row.dataset.uid));
    });
}

function selectUser(uid) {
    _selectedUid = uid;
    const user = _users.find(u => u.uid === uid);
    if (!user) return;

    document.getElementById("um-detail-panel").classList.remove("hidden");
    document.getElementById("um-detail-title").textContent = `${user.displayName} 상세`;
    const rc = user.reportCount || 0;
    const rcColor = rc >= 3 ? 'text-error' : rc > 0 ? 'text-warning' : 'text-success';
    const trc = user.totalReportCount || 0;
    const trcColor = trc >= 3 ? 'text-error' : trc > 0 ? 'text-warning' : 'text-sub';
    const sc = user.suspensionCount || 0;
    const scColor = sc >= 4 ? 'text-error' : sc >= 3 ? 'text-warning' : sc > 0 ? 'text-warning' : 'text-sub';
    const adc = user.adminDeleteCount || 0;
    const adcColor = adc >= 3 ? 'text-error' : adc >= 2 ? 'text-warning' : 'text-sub';
    let suspStatus = user.disabled ? '<span class="text-error">정지 중</span>' : '<span class="text-success">활성</span>';
    if (user.suspendedUntil) {
        const remaining = Math.ceil((user.suspendedUntil - Date.now()) / (1000 * 60 * 60 * 24));
        const endDate = new Date(user.suspendedUntil).toLocaleDateString('ko-KR');
        suspStatus = remaining > 0
            ? `<span class="text-error">정지 중 (D-${remaining}, ${endDate})</span>`
            : `<span class="text-warning">정지 만료됨</span>`;
    }
    document.getElementById("um-detail-info").innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(user.displayName)}</div><div class="stat-label">이름</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(user.email || "—")}</div><div class="stat-label">이메일</div></div>
            <div class="stat-card"><div class="stat-value">Lv.${user.level}</div><div class="stat-label">레벨</div></div>
            <div class="stat-card"><div class="stat-value text-sm ${rcColor}">${rc}건</div><div class="stat-label">현재 신고</div></div>
            <div class="stat-card"><div class="stat-value text-sm ${trcColor}">${trc}건</div><div class="stat-label">신고 누적 (전체)</div></div>
            <div class="stat-card"><div class="stat-value text-sm ${adcColor}">${adc}회</div><div class="stat-label">삭제 누적 (현재)</div></div>
            <div class="stat-card"><div class="stat-value text-sm ${scColor}">${sc}회</div><div class="stat-label">정지 누적</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${suspStatus}</div><div class="stat-label">정지 상태</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${user.disabled ? '<span class="text-error">중지됨</span>' : '<span class="text-success">활성</span>'}</div><div class="stat-label">계정 상태</div></div>
        </div>
        <p class="text-sub text-sm">UID: ${uid}</p>
    `;

    // Update disable button text
    document.getElementById("btn-toggle-disable").textContent = user.disabled ? "계정 활성화" : "계정 사용 중지";

    // Hide backups panel
    document.getElementById("um-backups-panel").classList.add("hidden");
    document.getElementById("um-account-result").innerHTML = "";

    // Scroll to detail
    document.getElementById("um-detail-panel").scrollIntoView({ behavior: "smooth" });
}

function closeDetail() {
    document.getElementById("um-detail-panel").classList.add("hidden");
    _selectedUid = null;
}

async function backupUser() {
    if (!_selectedUid) return;
    const memo = prompt("백업 메모 (선택사항):", "수동 백업");
    if (memo === null) return;

    tlog("UserMgmt", `${_selectedUid} 백업 생성 중...`);
    try {
        await callAdmin("backupUserData", { uid: _selectedUid, memo });
        tok("UserMgmt", "백업 생성 완료");
        alert("백업이 생성되었습니다.");
    } catch (e) {
        terror("UserMgmt", "백업 실패: " + e.message);
        alert("백업 실패: " + e.message);
    }
}

async function viewBackups() {
    if (!_selectedUid) return;
    const panel = document.getElementById("um-backups-panel");
    panel.classList.remove("hidden");
    panel.innerHTML = '<p class="text-sub text-sm">백업 로딩 중...</p>';

    try {
        const result = await callAdmin("listBackups", { uid: _selectedUid });
        const backups = result.backups || [];

        if (backups.length === 0) {
            panel.innerHTML = '<p class="text-sub text-sm">백업이 없습니다.</p>';
            return;
        }

        let html = `<table>
            <thead><tr><th>시점</th><th>메모</th><th>생성자</th><th>작업</th></tr></thead>
            <tbody>`;
        for (const b of backups) {
            const dt = b.createdAt ? new Date(b.createdAt).toLocaleString("ko-KR") : "—";
            html += `<tr>
                <td class="text-sm">${dt}</td>
                <td class="text-sm">${escHtml(b.memo)}</td>
                <td class="text-sub text-sm">${escHtml(b.createdBy)}</td>
                <td><button class="btn btn-outline btn-sm um-rollback-btn" data-backup-id="${b.id}">롤백</button></td>
            </tr>`;
        }
        html += '</tbody></table>';
        panel.innerHTML = html;

        // Bind rollback buttons
        panel.querySelectorAll(".um-rollback-btn").forEach(btn => {
            btn.addEventListener("click", () => rollbackToBackup(btn.dataset.backupId));
        });
    } catch (e) {
        terror("UserMgmt", "백업 목록 실패: " + e.message);
        panel.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

async function rollbackToBackup(backupId) {
    if (!_selectedUid) return;
    if (!confirm("이 시점으로 롤백하시겠습니까?\n현재 데이터는 자동으로 백업됩니다.")) return;

    tlog("UserMgmt", `${_selectedUid} → ${backupId} 롤백 중...`);
    try {
        await callAdmin("rollbackUserData", { uid: _selectedUid, backupId });
        tok("UserMgmt", "롤백 완료");
        alert("롤백이 완료되었습니다.");
        viewBackups(); // Refresh list
    } catch (e) {
        terror("UserMgmt", "롤백 실패: " + e.message);
        alert("롤백 실패: " + e.message);
    }
}

async function resetUser() {
    if (!_selectedUid) return;
    const user = _users.find(u => u.uid === _selectedUid);
    if (!confirm(`${user?.displayName || _selectedUid}의 게임 데이터를 초기화하시겠습니까?\n(자동 백업 후 진행됩니다)`)) return;

    tlog("UserMgmt", `${_selectedUid} 데이터 초기화 중...`);
    try {
        await callAdmin("resetUserData", { uid: _selectedUid });
        tok("UserMgmt", "데이터 초기화 완료");
        alert("데이터가 초기화되었습니다.");
        loadUsers(); // Refresh
    } catch (e) {
        terror("UserMgmt", "초기화 실패: " + e.message);
        alert("초기화 실패: " + e.message);
    }
}

async function resetAllUsers() {
    if (!confirm("⚠️ 전체 유저의 게임 데이터를 초기화합니다.\n이 작업은 되돌릴 수 있지만 시간이 걸릴 수 있습니다.\n\n계속하시겠습니까?")) return;
    if (!confirm("정말로 전체 초기화를 진행하시겠습니까?\n(마지막 확인)")) return;

    tlog("UserMgmt", "전체 유저 데이터 초기화 중...");
    try {
        const result = await callAdmin("resetUserData", { resetAll: true });
        tok("UserMgmt", `전체 초기화 완료: ${result.resetCount}명`);
        alert(`${result.resetCount}명의 데이터가 초기화되었습니다.`);
        loadUsers();
    } catch (e) {
        terror("UserMgmt", "전체 초기화 실패: " + e.message);
        alert("전체 초기화 실패: " + e.message);
    }
}

async function resetPassword() {
    if (!_selectedUid) return;
    const resultEl = document.getElementById("um-account-result");

    tlog("UserMgmt", `${_selectedUid} 비밀번호 재설정 링크 생성 중...`);
    try {
        const result = await callAdmin("resetPassword", { uid: _selectedUid });
        tok("UserMgmt", "비밀번호 재설정 링크 생성 완료");
        resultEl.innerHTML = `
            <div class="card" style="margin-top:8px; padding:12px;">
                <p class="text-sm"><strong>비밀번호 재설정 링크</strong> (${escHtml(result.email)})</p>
                <input type="text" value="${escHtml(result.link)}" readonly style="margin-top:8px; font-size:0.75rem;" onclick="this.select()">
                <p class="text-sub text-sm" style="margin-top:4px;">이 링크를 유저에게 전달하세요.</p>
            </div>
        `;
    } catch (e) {
        terror("UserMgmt", "비밀번호 재설정 실패: " + e.message);
        resultEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

async function toggleDisable() {
    if (!_selectedUid) return;
    const user = _users.find(u => u.uid === _selectedUid);
    const newState = !(user?.disabled);
    const actionText = newState ? "사용 중지" : "활성화";

    if (!confirm(`${user?.displayName || _selectedUid} 계정을 ${actionText}하시겠습니까?`)) return;

    tlog("UserMgmt", `${_selectedUid} 계정 ${actionText} 중...`);
    try {
        await callAdmin("disableAccount", { uid: _selectedUid, disabled: newState });
        tok("UserMgmt", `계정 ${actionText} 완료`);
        alert(`계정이 ${actionText}되었습니다.`);
        // Update local state
        if (user) user.disabled = newState;
        selectUser(_selectedUid);
        loadUsers();
    } catch (e) {
        terror("UserMgmt", `계정 ${actionText} 실패: ` + e.message);
        alert(`${actionText} 실패: ` + e.message);
    }
}

async function deleteAccount() {
    if (!_selectedUid) return;
    const user = _users.find(u => u.uid === _selectedUid);

    if (!confirm(`⚠️ ${user?.displayName || _selectedUid} 계정을 영구 삭제합니다.\n\nFirestore 데이터 + Auth 계정이 모두 삭제됩니다.\n(삭제 전 자동 백업이 생성됩니다)\n\n계속하시겠습니까?`)) return;
    if (!confirm("정말로 삭제하시겠습니까? (마지막 확인)")) return;

    tlog("UserMgmt", `${_selectedUid} 계정 삭제 중...`);
    try {
        await callAdmin("deleteAccount", { uid: _selectedUid });
        tok("UserMgmt", "계정 삭제 완료");
        alert("계정이 삭제되었습니다.");
        closeDetail();
        loadUsers();
    } catch (e) {
        terror("UserMgmt", "계정 삭제 실패: " + e.message);
        alert("계정 삭제 실패: " + e.message);
    }
}

async function loadBatchSessions() {
    const panel = document.getElementById("batch-sessions-panel");
    panel.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("UserMgmt", "백업 세션 목록 로딩...");
    try {
        const result = await callAdmin("listBatchSessions");
        const sessions = result.sessions || [];
        if (sessions.length === 0) {
            panel.innerHTML = '<p class="text-sub text-sm">생성된 일괄 백업 세션이 없습니다.</p>';
            tok("UserMgmt", "백업 세션 없음");
            return;
        }
        const typeLabel = {
            manual: "수동",
            scheduled: "자동",
            auto_before_rollback: "롤백 전 자동"
        };
        let html = `<table>
            <thead><tr><th>일시</th><th>유형</th><th>메모</th><th>유저 수</th><th>생성자</th><th>작업</th></tr></thead>
            <tbody>`;
        for (const s of sessions) {
            const dt = s.createdAt ? new Date(s.createdAt).toLocaleString("ko-KR") : "—";
            const type = typeLabel[s.type] || s.type;
            const isRollbackable = s.type === "manual" || s.type === "scheduled";
            html += `<tr>
                <td class="text-sm">${escHtml(dt)}</td>
                <td class="text-sm">${escHtml(type)}${s.period ? ` (${escHtml(s.period)})` : ""}</td>
                <td class="text-sm">${escHtml(s.memo)}</td>
                <td class="text-sm">${s.userCount}명</td>
                <td class="text-sub text-sm">${escHtml(s.createdBy)}</td>
                <td>${isRollbackable
                    ? `<button class="btn btn-danger btn-sm session-rollback-btn" data-session-id="${escHtml(s.sessionId)}" data-memo="${escHtml(s.memo)}" data-dt="${escHtml(dt)}">전체 롤백</button>`
                    : '<span class="text-sub text-sm">—</span>'
                }</td>
            </tr>`;
        }
        html += '</tbody></table>';
        panel.innerHTML = html;
        panel.querySelectorAll(".session-rollback-btn").forEach(btn => {
            btn.addEventListener("click", () => batchRollback(btn.dataset.sessionId, btn.dataset.memo, btn.dataset.dt));
        });
        tok("UserMgmt", `${sessions.length}개 세션 로드 완료`);
    } catch (e) {
        terror("UserMgmt", "세션 목록 로드 실패: " + e.message);
        panel.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

async function batchRollback(sessionId, memo, dt) {
    if (!confirm(`⚠️ 전체 유저를 아래 시점으로 롤백합니다.\n\n시점: ${dt}\n메모: ${memo}\n\n현재 데이터는 자동으로 백업됩니다.\n계속하시겠습니까?`)) return;
    if (!confirm("정말로 전체 유저를 롤백하시겠습니까? (마지막 확인)")) return;

    tlog("UserMgmt", `전체 유저 일괄 롤백 중... sessionId=${sessionId}`);
    const panel = document.getElementById("batch-sessions-panel");
    panel.insertAdjacentHTML("beforeend", '<p class="text-sub text-sm" id="rollback-progress">롤백 진행 중... (잠시 기다려주세요)</p>');
    try {
        const result = await callAdmin("batchRollbackAllUsers", { sessionId });
        document.getElementById("rollback-progress")?.remove();
        tok("UserMgmt", `일괄 롤백 완료: ${result.restoredCount}명`);
        alert(`✓ ${result.restoredCount}명 롤백 완료`);
        loadBatchSessions();
    } catch (e) {
        document.getElementById("rollback-progress")?.remove();
        terror("UserMgmt", "일괄 롤백 실패: " + e.message);
        alert("롤백 실패: " + e.message);
    }
}

async function batchBackupAllUsers() {
    const memo = prompt("백업 메모 (선택사항):", "수동 일괄 백업");
    if (memo === null) return;
    const resultEl = document.getElementById("batch-backup-result");
    resultEl.innerHTML = '<p class="text-sub text-sm">백업 진행 중...</p>';
    tlog("UserMgmt", "전체 유저 일괄 백업 시작...");
    try {
        const result = await callAdmin("batchBackupAllUsers", { memo });
        tok("UserMgmt", `일괄 백업 완료: ${result.count}명`);
        resultEl.innerHTML = `<p class="text-success text-sm">✓ ${result.count}명 백업 완료</p>`;
    } catch (e) {
        terror("UserMgmt", "일괄 백업 실패: " + e.message);
        resultEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

const SCHEDULER_PERIOD_LABELS = {
    daily:     "일별 (매일 02:00 KST)",
    weekly:    "주별 (매주 일요일 04:00 KST)",
    monthly:   "월별 (매월 1일 03:00 KST)",
    quarterly: "분기별 (분기 시작일 03:00 KST)",
    yearly:    "연도별 (1월 1일 03:00 KST)"
};

async function loadSchedulerConfig() {
    const panel = document.getElementById("backup-scheduler-panel");
    panel.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    tlog("UserMgmt", "스케쥴러 설정 로딩...");
    try {
        const result = await callAdmin("getBackupSchedulerConfig");
        const cfg = result.config;
        let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
        for (const [period, label] of Object.entries(SCHEDULER_PERIOD_LABELS)) {
            const info = cfg[period] || { enabled: false, lastRun: null, lastCount: 0 };
            const lastRunStr = info.lastRun ? new Date(info.lastRun).toLocaleString("ko-KR") : "없음";
            const lastCountStr = info.lastCount ? `, ${info.lastCount}명` : "";
            html += `<label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex-wrap:wrap;">
                <input type="checkbox" class="scheduler-toggle" data-period="${period}" ${info.enabled ? "checked" : ""}>
                <span class="text-sm">${label}</span>
                <span class="text-sub text-sm">(최근 실행: ${escHtml(lastRunStr)}${lastCountStr})</span>
            </label>`;
        }
        html += '</div>';
        panel.innerHTML = html;
        document.getElementById("btn-save-scheduler").style.display = "";
        tok("UserMgmt", "스케쥴러 설정 로드 완료");
    } catch (e) {
        terror("UserMgmt", "스케쥴러 설정 로드 실패: " + e.message);
        panel.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

async function saveSchedulerConfig() {
    const toggles = document.querySelectorAll(".scheduler-toggle");
    if (toggles.length === 0) {
        alert("먼저 스케쥴러 상태를 조회해주세요.");
        return;
    }
    const config = {};
    toggles.forEach(t => { config[t.dataset.period] = { enabled: t.checked }; });
    tlog("UserMgmt", "스케쥴러 설정 저장 중...");
    try {
        await callAdmin("updateBackupSchedulerConfig", { config });
        tok("UserMgmt", "스케쥴러 설정 저장 완료");
        alert("스케쥴러 설정이 저장되었습니다.");
        loadSchedulerConfig();
    } catch (e) {
        terror("UserMgmt", "스케쥴러 설정 저장 실패: " + e.message);
        alert("저장 실패: " + e.message);
    }
}

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
