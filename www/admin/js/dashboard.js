// ─── Dashboard ───
import { db, functions, httpsCallable, collection, getDocs, query, where } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;

export function initDashboard(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>대시보드</h2>
            <div class="stats-grid" id="dash-stats">
                <div class="stat-card"><div class="stat-value" id="stat-total">—</div><div class="stat-label">전체 사용자</div></div>
                <div class="stat-card"><div class="stat-value" id="stat-push">—</div><div class="stat-label">푸시 활성</div></div>
                <div class="stat-card"><div class="stat-value" id="stat-active">—</div><div class="stat-label">활성 토큰</div></div>
                <div class="stat-card"><div class="stat-value" id="stat-streak">—</div><div class="stat-label">스트릭 위험</div></div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="window._loadDashboard()">새로고침</button>
        </div>
    `;
}

export async function loadDashboard() {
    tlog("Dash", "대시보드 로딩...");
    try {
        const ping = httpsCallable(functions, "ping");
        const result = await ping({ action: "getTestUsers" });
        const users = result.data?.users || [];

        const total = users.length;
        const pushEnabled = users.filter(u => u.pushEnabled).length;
        const hasToken = users.filter(u => u.fcmToken).length;

        // Streak risk: users who haven't been active in 2+ days
        const now = Date.now();
        const twoDays = 2 * 24 * 60 * 60 * 1000;
        const streakRisk = users.filter(u => {
            if (!u.streak?.lastActiveDate) return false;
            const last = new Date(u.streak.lastActiveDate).getTime();
            return (now - last) > twoDays && (u.streak?.currentStreak || 0) > 0;
        }).length;

        document.getElementById("stat-total").textContent = total;
        document.getElementById("stat-push").textContent = pushEnabled;
        document.getElementById("stat-active").textContent = hasToken;
        document.getElementById("stat-streak").textContent = streakRisk;

        tok("Dash", `대시보드 로드 완료: ${total}명`);
    } catch (e) {
        terror("Dash", "대시보드 로드 실패: " + e.message);
        document.getElementById("stat-total").textContent = "!";
    }
}

window._loadDashboard = loadDashboard;
