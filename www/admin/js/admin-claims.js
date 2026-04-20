// ─── Admin Claim Management ───
import { auth, functions, httpsCallable, getIdTokenResult } from "./firebase-init.js";
import { ensureFreshToken, checkAdminClaim, isMaster } from "./auth.js";
import { tlog, tok, twarn, terror } from "./log-panel.js";
import { esc, fmtDate } from "./utils.js";

let _container = null;

export function initAdminClaims(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    const masterMode = isMaster();

    _container.innerHTML = `
        <div class="card">
            <h2>현재 사용자 Claim 상태</h2>
            <div id="claim-status">로그인 후 확인 가능합니다.</div>
            <button class="btn btn-outline btn-sm mt-8" onclick="window._refreshClaimView()">상태 새로고침</button>
        </div>

        ${masterMode ? `
        <div class="card">
            <h2>Admin Claim 부여</h2>
            <p class="text-sub text-sm mb-8">대상 사용자의 UID를 입력하여 admin 권한을 부여합니다. <span class="badge badge-ok">마스터 전용</span></p>
            <div class="flex-center">
                <input type="text" id="claim-uid-input" placeholder="대상 사용자 UID" style="flex:1">
                <button class="btn btn-primary btn-sm" onclick="window._grantAdmin()">부여</button>
            </div>
            <div id="claim-grant-result" class="mt-8"></div>
        </div>

        <div class="card">
            <h2>Admin / Master 권한 회수</h2>
            <p class="text-sub text-sm mb-8">사용자의 admin·master 권한을 모두 회수합니다. 자신의 권한은 회수할 수 없습니다. <span class="badge badge-ok">마스터 전용</span></p>
            <div class="flex-center">
                <input type="text" id="revoke-admin-uid-input" placeholder="대상 사용자 UID" style="flex:1">
                <button class="btn btn-outline btn-sm" onclick="window._revokeAdmin()" style="color:#ff5252;border-color:#ff5252">권한 회수</button>
            </div>
            <div id="revoke-admin-result" class="mt-8"></div>
        </div>

        <div class="card">
            <h2>관리자 페이지 운영 권한 관리</h2>
            <p class="text-sub text-sm mb-8">관리자가 아닌 사용자에게 관리자 페이지 운영 권한을 부여/회수합니다. <span class="badge badge-ok">마스터 전용</span></p>
            <div class="flex-center mb-8">
                <input type="text" id="operator-uid-input" placeholder="대상 사용자 UID" style="flex:1">
                <button class="btn btn-primary btn-sm" onclick="window._grantOperator()" style="margin-right:4px">권한 부여</button>
                <button class="btn btn-outline btn-sm" onclick="window._revokeOperator()" style="color:#ff5252;border-color:#ff5252">권한 회수</button>
            </div>
            <div id="operator-grant-result" class="mt-8"></div>
            <hr style="border-color:#2a2a3e;margin:16px 0">
            <h3 style="font-size:0.95rem;margin-bottom:8px">권한 보유자 목록</h3>
            <button class="btn btn-outline btn-sm mb-8" onclick="window._loadOperators()">목록 새로고침</button>
            <div id="operator-list">목록을 로드하려면 새로고침 버튼을 누르세요.</div>
        </div>
        ` : `
        <div class="card">
            <h2>권한 관리</h2>
            <p class="text-sub text-sm">Admin Claim 부여 및 운영 권한 관리는 마스터 계정만 사용할 수 있습니다.</p>
        </div>
        `}

        <div class="card">
            <h2>토큰 강제 갱신</h2>
            <p class="text-sub text-sm mb-8">ID 토큰을 강제로 갱신하여 최신 claim을 반영합니다.</p>
            <button class="btn btn-outline btn-sm" onclick="window._forceRefresh()">토큰 갱신</button>
            <div id="token-refresh-result" class="mt-8"></div>
        </div>

        <div class="card">
            <h2>관리자 인증 방식</h2>
            <p class="text-sub text-sm mb-8">관리자 권한은 Firebase Custom Claims로 관리됩니다.</p>
            <ul class="text-sub text-sm" style="padding-left:18px;line-height:1.8">
                <li><code>master: true</code> — 마스터 계정 (모든 권한 + 권한 관리)</li>
                <li><code>admin: true</code> — 관리자 (관리자 페이지 전체 접근)</li>
                <li><code>adminOperator: true</code> — 운영자 (관리자 페이지 운영 권한, 마스터가 부여)</li>
            </ul>
        </div>
    `;
    // Auto-load claim status
    window._refreshClaimView();
}

window._refreshClaimView = async function() {
    const el = document.getElementById("claim-status");
    const user = auth.currentUser;
    if (!user) {
        el.innerHTML = '<span class="text-error">로그인되지 않았습니다.</span>';
        return;
    }

    const tokenResult = await getIdTokenResult(user);
    const isAdmin = tokenResult.claims.admin === true;
    const isMasterClaim = tokenResult.claims.master === true;
    const isOperator = tokenResult.claims.adminOperator === true;
    const issued = new Date(tokenResult.issuedAtTime);
    const expires = new Date(tokenResult.expirationTime);

    let roleBadge = '';
    if (isMasterClaim) roleBadge = '<span class="badge badge-ok">MASTER</span>';
    else if (isAdmin) roleBadge = '<span class="badge badge-ok">ADMIN</span>';
    else if (isOperator) roleBadge = '<span class="badge badge-info">OPERATOR</span>';
    else roleBadge = '<span class="badge badge-fail">권한 없음</span>';

    el.innerHTML = `
        <table>
            <tr><th style="width:140px">UID</th><td><code>${esc(user.uid)}</code></td></tr>
            <tr><th>Email</th><td><code>${esc(user.email || "없음")}</code></td></tr>
            <tr><th>역할</th><td>${roleBadge}</td></tr>
            <tr><th>Master Claim</th><td>
                <span class="badge ${isMasterClaim ? "badge-ok" : "badge-fail"}">${isMasterClaim ? "✓ true" : "✗ false"}</span>
            </td></tr>
            <tr><th>Admin Claim</th><td>
                <span class="badge ${isAdmin ? "badge-ok" : "badge-fail"}">${isAdmin ? "✓ true" : "✗ false"}</span>
            </td></tr>
            <tr><th>Operator Claim</th><td>
                <span class="badge ${isOperator ? "badge-ok" : "badge-fail"}">${isOperator ? "✓ true" : "✗ false"}</span>
            </td></tr>
            <tr><th>토큰 발급</th><td>${fmtDate(issued)}</td></tr>
            <tr><th>토큰 만료</th><td>${fmtDate(expires)}</td></tr>
        </table>
    `;
};

window._grantAdmin = async function() {
    const uid = document.getElementById("claim-uid-input").value.trim();
    const el = document.getElementById("claim-grant-result");
    if (!uid) { el.innerHTML = '<span class="text-error">UID를 입력하세요.</span>'; return; }

    tlog("Claims", "setAdminClaim 호출: " + uid);
    try {
        const setAdminClaim = httpsCallable(functions, "setAdminClaim");
        await setAdminClaim({ uid });
        el.innerHTML = `<span class="text-success">✓ Admin claim이 부여되었습니다: <code>${esc(uid)}</code></span>`;
        tok("Claims", "Admin claim granted to " + uid);
    } catch (e) {
        el.innerHTML = `<span class="text-error">오류: ${esc(e.message)}</span>`;
        terror("Claims", "setAdminClaim error: " + e.message);
    }
};

window._grantOperator = async function() {
    const uid = document.getElementById("operator-uid-input").value.trim();
    const el = document.getElementById("operator-grant-result");
    if (!uid) { el.innerHTML = '<span class="text-error">UID를 입력하세요.</span>'; return; }

    tlog("Claims", "setAdminOperator 호출: " + uid);
    try {
        const setAdminOperator = httpsCallable(functions, "setAdminOperator");
        await setAdminOperator({ uid });
        el.innerHTML = `<span class="text-success">✓ 운영 권한이 부여되었습니다: <code>${esc(uid)}</code></span>`;
        tok("Claims", "AdminOperator claim granted to " + uid);
    } catch (e) {
        el.innerHTML = `<span class="text-error">오류: ${esc(e.message)}</span>`;
        terror("Claims", "setAdminOperator error: " + e.message);
    }
};

window._revokeOperator = async function() {
    const uid = document.getElementById("operator-uid-input").value.trim();
    const el = document.getElementById("operator-grant-result");
    if (!uid) { el.innerHTML = '<span class="text-error">UID를 입력하세요.</span>'; return; }

    tlog("Claims", "removeAdminOperator 호출: " + uid);
    try {
        const removeAdminOperator = httpsCallable(functions, "removeAdminOperator");
        await removeAdminOperator({ uid });
        el.innerHTML = `<span class="text-success">✓ 운영 권한이 회수되었습니다: <code>${esc(uid)}</code></span>`;
        tok("Claims", "AdminOperator claim removed from " + uid);
    } catch (e) {
        el.innerHTML = `<span class="text-error">오류: ${esc(e.message)}</span>`;
        terror("Claims", "removeAdminOperator error: " + e.message);
    }
};

window._revokeAdmin = async function() {
    const uid = document.getElementById("revoke-admin-uid-input").value.trim();
    const el = document.getElementById("revoke-admin-result");
    if (!uid) { el.innerHTML = '<span class="text-error">UID를 입력하세요.</span>'; return; }

    tlog("Claims", "removeAdminClaim 호출: " + uid);
    try {
        const removeAdminClaim = httpsCallable(functions, "removeAdminClaim");
        await removeAdminClaim({ uid });
        el.innerHTML = `<span class="text-success">✓ Admin/Master 권한이 회수되었습니다: <code>${esc(uid)}</code></span>`;
        tok("Claims", "Admin+master claims removed from " + uid);
    } catch (e) {
        el.innerHTML = `<span class="text-error">오류: ${esc(e.message)}</span>`;
        terror("Claims", "removeAdminClaim error: " + e.message);
    }
};

window._loadOperators = async function() {
    const el = document.getElementById("operator-list");
    el.innerHTML = '<span class="text-sub">로딩 중...</span>';

    try {
        const ping = httpsCallable(functions, "ping");
        const result = await ping({ action: "listAdminOperators" });
        const ops = result.data.operators || [];

        if (ops.length === 0) {
            el.innerHTML = '<span class="text-sub">권한 보유자가 없습니다.</span>';
            return;
        }

        let html = '<table style="width:100%;font-size:0.85rem"><thead><tr><th>UID</th><th>Email</th><th>역할</th><th>상태</th></tr></thead><tbody>';
        for (const op of ops) {
            const roles = [];
            if (op.master) roles.push('<span class="badge badge-ok">MASTER</span>');
            if (op.admin) roles.push('<span class="badge badge-info">ADMIN</span>');
            if (op.adminOperator) roles.push('<span class="badge badge-info">OPERATOR</span>');
            html += `<tr>
                <td><code style="font-size:0.75rem">${esc(op.uid.substring(0, 12))}...</code></td>
                <td>${esc(op.email || "—")}</td>
                <td>${roles.join(" ")}</td>
                <td>${op.disabled ? '<span class="text-error">비활성</span>' : '<span class="text-success">활성</span>'}</td>
            </tr>`;
        }
        html += '</tbody></table>';
        el.innerHTML = html;
        tok("Claims", `${ops.length}명의 권한 보유자 조회 완료`);
    } catch (e) {
        el.innerHTML = `<span class="text-error">오류: ${esc(e.message)}</span>`;
        terror("Claims", "listAdminOperators error: " + e.message);
    }
};

window._forceRefresh = async function() {
    const el = document.getElementById("token-refresh-result");
    el.innerHTML = '<span class="text-sub">갱신 중...</span>';

    const beforeToken = await getIdTokenResult(auth.currentUser);
    const beforeAdmin = beforeToken.claims.admin === true;

    await ensureFreshToken();

    const afterToken = await getIdTokenResult(auth.currentUser);
    const afterAdmin = afterToken.claims.admin === true;

    if (beforeAdmin !== afterAdmin) {
        el.innerHTML = `<span class="text-warning">Claim 변경됨: <code>${beforeAdmin}</code> → <code>${afterAdmin}</code></span>`;
        twarn("Claims", "Token refresh revealed claim change");
    } else {
        el.innerHTML = `<span class="text-success">✓ 토큰 갱신 완료. admin: <code>${afterAdmin}</code></span>`;
        tok("Claims", "Token refreshed, admin=" + afterAdmin);
    }

    // Update the claim status view
    window._refreshClaimView();

    // Re-render to update master-only UI
    render();
};
