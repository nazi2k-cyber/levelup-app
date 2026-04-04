// ─── Permission Diagnostic Tool ───
import {
    auth, db, functions,
    collection, doc, getDoc, getDocs, query, where, limit, httpsCallable, getIdTokenResult
} from "./firebase-init.js";
import { getCurrentUser, checkAdminClaim, ensureFreshToken } from "./auth.js";
import { tlog, tok, twarn, terror, timed } from "./log-panel.js";
import { esc } from "./utils.js";

const CHECKS = [
    { id: "env",        title: "환경 정보 확인" },
    { id: "auth",       title: "인증 상태 확인" },
    { id: "admin",      title: "Admin Claim 확인" },
    { id: "token",      title: "토큰 신선도 확인" },
    { id: "functions",  title: "Cloud Functions 연결" },
    { id: "read_users", title: "Firestore 읽기: users" },
    { id: "read_admin", title: "Firestore 읽기: push_logs (관리자)" },
    { id: "read_config",title: "Firestore 읽기: app_config" },
    { id: "repair",     title: "Admin Claim 자동 복구" }
];

let _container = null;

export function initDiagPermissions(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>권한 진단 도구</h2>
            <p class="text-sub text-sm mb-16">
                "Missing or insufficient permissions" 오류의 원인을 자동으로 진단합니다.
            </p>
            <ul class="diag-checklist" id="diag-list">
                ${CHECKS.map(c => `
                    <li class="diag-item" id="diag-${c.id}">
                        <div class="diag-icon pending" id="icon-${c.id}">—</div>
                        <div class="diag-body">
                            <div class="diag-title">${c.title}</div>
                            <div class="diag-detail" id="detail-${c.id}">대기 중...</div>
                        </div>
                    </li>
                `).join("")}
            </ul>
            <div class="diag-actions">
                <button class="btn btn-primary" id="btn-run-diag" onclick="window._runAllDiag()">전체 진단 실행</button>
                <button class="btn btn-outline btn-sm" id="btn-repair-claim" onclick="window._repairClaim()" style="display:none">
                    Claim 복구
                </button>
            </div>
        </div>
    `;
}

function setStatus(checkId, status, detail) {
    const icon = document.getElementById("icon-" + checkId);
    const detailEl = document.getElementById("detail-" + checkId);
    if (icon) {
        icon.className = "diag-icon " + status;
        icon.textContent = status === "pass" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "!" : "…";
    }
    if (detailEl) detailEl.innerHTML = detail;
}

async function checkEnvironment() {
    const hostname = location.hostname;
    const url = location.href;
    const ua = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const isFirebaseHosting = hostname.includes("web.app") || hostname.includes("firebaseapp.com");
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";

    // Check Firebase config
    const configOk = !!self.__FIREBASE_CONFIG;
    const projectId = configOk ? self.__FIREBASE_CONFIG.projectId : "N/A";
    const authDomain = configOk ? self.__FIREBASE_CONFIG.authDomain : "N/A";

    let envStatus = "pass";
    let details = [];

    details.push(`호스트: <code>${esc(hostname)}</code>`);
    details.push(`URL: <code>${esc(url)}</code>`);
    details.push(`플랫폼: ${isMobile ? "모바일" : "데스크탑"}`);
    details.push(`Firebase 호스팅: ${isFirebaseHosting ? "✓" : isLocalhost ? "로컬" : "✗ (외부 도메인)"}`);
    details.push(`Firebase Config: ${configOk ? "✓ 로드됨" : "✗ 미로드"}`);
    details.push(`프로젝트: <code>${esc(projectId)}</code>`);
    details.push(`Auth Domain: <code>${esc(authDomain)}</code>`);

    if (!configOk) {
        envStatus = "fail";
        terror("Diag", "Firebase config가 로드되지 않았습니다", { hostname, url });
    } else if (!isFirebaseHosting && !isLocalhost) {
        envStatus = "warn";
        twarn("Diag", `외부 도메인에서 실행 중: ${hostname} — Firebase 승인 도메인 확인 필요`, { hostname, authDomain });
    } else {
        tok("Diag", `환경 확인 완료: ${hostname} (${isMobile ? "모바일" : "데스크탑"})`, { projectId, authDomain });
    }

    setStatus("env", envStatus, details.join("<br>"));
    return configOk;
}

async function checkAuth() {
    const user = auth.currentUser;
    if (!user) {
        setStatus("auth", "fail", "로그인되지 않았습니다. Google 로그인이 필요합니다.");
        terror("Diag", "Auth check failed: not logged in");
        return false;
    }
    const provider = user.providerData[0]?.providerId || "unknown";
    const created = user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleString("ko-KR") : "N/A";
    const lastLogin = user.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString("ko-KR") : "N/A";
    setStatus("auth", "pass",
        `UID: <code>${esc(user.uid)}</code><br>Email: <code>${esc(user.email || "없음")}</code><br>Provider: ${provider}<br>가입일: ${created}<br>마지막 로그인: ${lastLogin}`
    );
    tok("Diag", `Auth check passed: ${user.email}`, { uid: user.uid, provider });
    return true;
}

async function checkAdminClaimStatus() {
    const user = auth.currentUser;
    if (!user) { setStatus("admin", "fail", "로그인 필요"); return false; }

    const tokenResult = await getIdTokenResult(user);
    const isAdmin = tokenResult.claims.admin === true;
    const issuedAt = new Date(tokenResult.issuedAtTime);
    const tokenAge = Math.round((Date.now() - issuedAt.getTime()) / 60000);

    if (isAdmin) {
        setStatus("admin", "pass",
            `admin: <code>true</code><br>토큰 발급: ${issuedAt.toLocaleString("ko-KR")} (${tokenAge}분 전)`
        );
        tok("Diag", "Admin claim present");
        return true;
    } else {
        setStatus("admin", "fail",
            `admin claim이 없습니다.<br>토큰 발급: ${issuedAt.toLocaleString("ko-KR")} (${tokenAge}분 전)<br>
             <strong>해결:</strong> 아래 "Claim 복구" 버튼을 사용하거나, Cloud Functions에서 setAdminClaim을 호출하세요.`
        );
        terror("Diag", "Admin claim missing for " + user.email);
        document.getElementById("btn-repair-claim").style.display = "";
        return false;
    }
}

async function checkTokenFreshness() {
    const user = auth.currentUser;
    if (!user) { setStatus("token", "fail", "로그인 필요"); return false; }

    const beforeToken = await getIdTokenResult(user);
    const beforeAdmin = beforeToken.claims.admin === true;

    setStatus("token", "pending", "토큰 갱신 중...");
    await ensureFreshToken();

    const afterToken = await getIdTokenResult(user);
    const afterAdmin = afterToken.claims.admin === true;

    if (beforeAdmin !== afterAdmin) {
        setStatus("token", "warn",
            `토큰 갱신 후 admin claim이 변경됨: <code>${beforeAdmin}</code> → <code>${afterAdmin}</code><br>
             <strong>원인:</strong> 이전 토큰이 stale 상태였습니다. 갱신으로 해결되었습니다.`
        );
        twarn("Diag", "Token was stale, admin claim changed after refresh");
        return afterAdmin;
    }

    setStatus("token", "pass",
        `토큰 갱신 완료. admin claim 변동 없음 (<code>${afterAdmin}</code>)`
    );
    tok("Diag", "Token fresh, no claim change");
    return true;
}

async function checkCloudFunctions() {
    const user = auth.currentUser;
    if (!user) { setStatus("functions", "fail", "로그인 필요"); return false; }

    setStatus("functions", "pending", "Cloud Functions 호출 중...");
    try {
        const ping = httpsCallable(functions, "ping");
        const result = await ping({ action: "getTestUsers" });
        const data = result.data;
        setStatus("functions", "pass",
            `연결 성공. 응답 데이터 수신됨 (users: ${data?.users?.length ?? "N/A"})`
        );
        tok("Diag", "Cloud Functions reachable");
        return true;
    } catch (e) {
        const code = e.code || "unknown";
        const msg = e.message || "";
        if (code === "permission-denied" || code === "functions/permission-denied") {
            setStatus("functions", "fail",
                `권한 거부: <code>${esc(code)}</code><br>${esc(msg)}<br>
                 <strong>원인:</strong> Admin claim이 없거나 토큰이 만료됨. 위 진단 항목을 확인하세요.`
            );
        } else {
            setStatus("functions", "fail",
                `오류: <code>${esc(code)}</code><br>${esc(msg)}`
            );
        }
        terror("Diag", "Cloud Functions error: " + code + " " + msg, { code, region: "asia-northeast3" });
        return false;
    }
}

async function checkFirestoreRead(collectionName, checkId, requireAdmin) {
    const user = auth.currentUser;
    if (!user) { setStatus(checkId, "fail", "로그인 필요"); return false; }

    setStatus(checkId, "pending", `${collectionName} 컬렉션 읽기 시도 중...`);
    try {
        const q = query(collection(db, collectionName), limit(1));
        const snap = await getDocs(q);
        setStatus(checkId, "pass",
            `읽기 성공 (문서 수: ${snap.size})${requireAdmin ? " — 관리자 권한 확인됨" : ""}`
        );
        tok("Diag", `Firestore read ${collectionName}: OK`);
        return true;
    } catch (e) {
        const msg = e.message || "";
        const isPermError = msg.includes("permission") || msg.includes("Permission");
        if (isPermError && requireAdmin) {
            setStatus(checkId, "fail",
                `권한 오류: <code>${esc(msg)}</code><br>
                 <strong>원인:</strong> 이 컬렉션은 <code>admin == true</code> claim이 필요합니다.`
            );
        } else {
            setStatus(checkId, "fail", `오류: <code>${esc(msg)}</code>`);
        }
        terror("Diag", `Firestore read ${collectionName}: ${msg}`, { collection: collectionName, requireAdmin, isPermError });
        return false;
    }
}

async function checkRepairStatus() {
    const user = auth.currentUser;
    if (!user) { setStatus("repair", "fail", "로그인 필요"); return; }

    const isAdmin = await checkAdminClaim(user);
    if (isAdmin) {
        setStatus("repair", "pass", "Admin claim이 이미 설정되어 있습니다. 복구 불필요.");
        tok("Diag", "Admin claim already set, no repair needed");
    } else {
        setStatus("repair", "warn",
            `Admin claim이 없습니다. "Claim 복구" 버튼으로 복구를 시도하세요.<br>
             <strong>조건:</strong> 이메일이 서버 관리자 목록에 포함되어야 합니다.`
        );
        twarn("Diag", "Admin claim missing, repair available");
        document.getElementById("btn-repair-claim").style.display = "";
    }
}

// ─── Public Actions ───

window._runAllDiag = async function() {
    const btn = document.getElementById("btn-run-diag");
    btn.disabled = true;
    btn.textContent = "진단 중...";
    const diagStart = performance.now();
    tlog("Diag", "=== 전체 진단 시작 ===");

    // Reset all to pending
    CHECKS.forEach(c => setStatus(c.id, "pending", "대기 중..."));

    // 1. Environment check
    await timed("Diag", "환경 정보 확인", checkEnvironment);

    // 2. Auth check
    const authOk = await timed("Diag", "인증 상태 확인", checkAuth);
    if (!authOk) {
        CHECKS.slice(2).forEach(c => setStatus(c.id, "fail", "로그인이 필요합니다."));
        btn.disabled = false;
        btn.textContent = "전체 진단 실행";
        return;
    }

    // 3~8. Remaining checks with timing
    await timed("Diag", "Admin Claim 확인", checkAdminClaimStatus);
    await timed("Diag", "토큰 신선도 확인", checkTokenFreshness);
    await timed("Diag", "Cloud Functions 연결", checkCloudFunctions);
    await timed("Diag", "Firestore 읽기: users", () => checkFirestoreRead("users", "read_users", false));
    await timed("Diag", "Firestore 읽기: push_logs", () => checkFirestoreRead("push_logs", "read_admin", true));
    await timed("Diag", "Firestore 읽기: app_config", () => checkFirestoreRead("app_config", "read_config", false));
    await checkRepairStatus();

    const totalMs = (performance.now() - diagStart).toFixed(0);
    tlog("Diag", `=== 전체 진단 완료 (총 ${totalMs}ms) ===`);
    btn.disabled = false;
    btn.textContent = "전체 진단 실행";
};

window._repairClaim = async function() {
    const user = auth.currentUser;
    if (!user) { alert("로그인이 필요합니다."); return; }

    tlog("Diag", "Admin claim 복구 시도...");
    try {
        // Call any admin-gated function — assertAdmin auto-repairs if email matches
        const ping = httpsCallable(functions, "ping");
        await ping({ action: "getTestUsers" });
        // Force token refresh to pick up newly set claim
        await ensureFreshToken();
        const isAdmin = await checkAdminClaim(user);
        if (isAdmin) {
            setStatus("repair", "pass", "Admin claim 복구 완료! 토큰이 갱신되었습니다.");
            tok("Diag", "Admin claim repaired successfully");
            // Re-run admin check
            setStatus("admin", "pass", `admin: <code>true</code> (복구됨)`);
            document.getElementById("btn-repair-claim").style.display = "none";
        } else {
            setStatus("repair", "fail",
                "복구 실패. 이메일이 서버 관리자 목록에 없을 수 있습니다."
            );
            terror("Diag", "Claim repair failed");
        }
    } catch (e) {
        setStatus("repair", "fail", `복구 오류: <code>${esc(e.message)}</code>`);
        terror("Diag", "Claim repair error: " + e.message);
    }
};
