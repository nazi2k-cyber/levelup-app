// ─── Admin Claim Management ───
import { auth, functions, httpsCallable, getIdTokenResult } from "./firebase-init.js";
import { ensureFreshToken, checkAdminClaim } from "./auth.js";
import { tlog, tok, twarn, terror } from "./log-panel.js";
import { esc, fmtDate } from "./utils.js";

const KNOWN_ADMIN_EMAILS = ["nazi2k@gmail.com"];

let _container = null;

export function initAdminClaims(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>현재 사용자 Claim 상태</h2>
            <div id="claim-status">로그인 후 확인 가능합니다.</div>
            <button class="btn btn-outline btn-sm mt-8" onclick="window._refreshClaimView()">상태 새로고침</button>
        </div>

        <div class="card">
            <h2>Admin Claim 부여</h2>
            <p class="text-sub text-sm mb-8">대상 사용자의 UID를 입력하여 admin 권한을 부여합니다. (관리자만 가능)</p>
            <div class="flex-center">
                <input type="text" id="claim-uid-input" placeholder="대상 사용자 UID" style="flex:1">
                <button class="btn btn-primary btn-sm" onclick="window._grantAdmin()">부여</button>
            </div>
            <div id="claim-grant-result" class="mt-8"></div>
        </div>

        <div class="card">
            <h2>토큰 강제 갱신</h2>
            <p class="text-sub text-sm mb-8">ID 토큰을 강제로 갱신하여 최신 claim을 반영합니다.</p>
            <button class="btn btn-outline btn-sm" onclick="window._forceRefresh()">토큰 갱신</button>
            <div id="token-refresh-result" class="mt-8"></div>
        </div>

        <div class="card">
            <h2>관리자 이메일 목록 (서버)</h2>
            <p class="text-sub text-sm mb-8">Cloud Functions에 등록된 관리자 이메일:</p>
            <ul style="margin-left: 16px; font-size: 0.85rem;">
                ${KNOWN_ADMIN_EMAILS.map(e => `<li><code>${esc(e)}</code></li>`).join("")}
            </ul>
            <p class="text-sub text-sm mt-8">
                이 목록은 <code>functions/index.js</code>의 <code>ADMIN_EMAILS</code>와 동기화 필요
            </p>
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
    const issued = new Date(tokenResult.issuedAtTime);
    const expires = new Date(tokenResult.expirationTime);

    el.innerHTML = `
        <table>
            <tr><th style="width:120px">UID</th><td><code>${esc(user.uid)}</code></td></tr>
            <tr><th>Email</th><td><code>${esc(user.email || "없음")}</code></td></tr>
            <tr><th>Admin Claim</th><td>
                <span class="badge ${isAdmin ? "badge-ok" : "badge-fail"}">${isAdmin ? "✓ true" : "✗ false"}</span>
            </td></tr>
            <tr><th>토큰 발급</th><td>${fmtDate(issued)}</td></tr>
            <tr><th>토큰 만료</th><td>${fmtDate(expires)}</td></tr>
            <tr><th>서버 목록</th><td>
                ${KNOWN_ADMIN_EMAILS.includes(user.email) ?
                    '<span class="badge badge-ok">포함됨</span>' :
                    '<span class="badge badge-warn">미포함</span>'}
            </td></tr>
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
};
