// ─── Log Panel (Enhanced v2) ───
import { esc } from "./utils.js";

const _logs = [];
let _errorCount = 0;
let _warnCount = 0;
let _sessionStart = Date.now();
let _activeFilter = "ALL"; // ALL, ERROR, WARN, OK, INFO

function _getEnvInfo() {
    const ua = navigator.userAgent;
    let browser = "Unknown";
    if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
    else if (ua.includes("Edg")) browser = "Edge";
    else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Firefox")) browser = "Firefox";

    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return {
        url: location.href,
        hostname: location.hostname,
        browser,
        platform: isMobile ? "Mobile" : "Desktop",
        ua: ua.substring(0, 120),
        timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        sessionId: Math.random().toString(36).substring(2, 10)
    };
}

function _addLog(level, tag, msg, extra) {
    const now = new Date();
    const ts = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    const elapsed = ((Date.now() - _sessionStart) / 1000).toFixed(1);
    const entry = {
        ts,
        elapsed: elapsed + "s",
        level,
        tag,
        msg: typeof msg === "object" ? JSON.stringify(msg, null, 2) : String(msg),
        extra: extra || null
    };
    _logs.push(entry);

    const container = document.getElementById("log-entries");
    if (container) {
        const cls = level === "ERROR" ? "log-error" : level === "WARN" ? "log-warn" : level === "OK" ? "log-ok" : "log-info";
        const shouldShow = _activeFilter === "ALL" || _activeFilter === level;
        const div = document.createElement("div");
        div.className = "log-entry " + cls;
        div.dataset.level = level;
        if (!shouldShow) div.style.display = "none";
        let html = `<span class="log-time">${entry.ts}</span><span class="log-elapsed">${entry.elapsed}</span><span class="log-level">[${level}]</span><span class="log-msg">[${entry.tag}] ${esc(entry.msg)}</span>`;
        if (extra) {
            html += `<span class="log-extra">${esc(typeof extra === "object" ? JSON.stringify(extra) : String(extra))}</span>`;
        }
        div.innerHTML = html;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    if (level === "ERROR") {
        _errorCount++;
        _updateBadge();
    } else if (level === "WARN") {
        _warnCount++;
        _updateBadge();
    }
}

function _updateBadge() {
    const badge = document.getElementById("log-count");
    if (!badge) return;
    const total = _errorCount + _warnCount;
    if (total > 0) {
        badge.textContent = _errorCount > 0 ? _errorCount : _warnCount;
        badge.className = _errorCount > 0 ? "log-badge log-badge-error" : "log-badge log-badge-warn";
        badge.style.display = "inline";
    } else {
        badge.textContent = "0";
        badge.style.display = "none";
    }
}

export function tlog(tag, msg, extra) { _addLog("INFO", tag, msg, extra); }
export function tok(tag, msg, extra) { _addLog("OK", tag, msg, extra); }
export function twarn(tag, msg, extra) { _addLog("WARN", tag, msg, extra); }
export function terror(tag, msg, extra) { _addLog("ERROR", tag, msg, extra); }

/** Measure async operation and log duration */
export async function timed(tag, label, fn) {
    const start = performance.now();
    tlog(tag, `${label} 시작...`);
    try {
        const result = await fn();
        const dur = (performance.now() - start).toFixed(0);
        tok(tag, `${label} 완료 (${dur}ms)`);
        return result;
    } catch (e) {
        const dur = (performance.now() - start).toFixed(0);
        terror(tag, `${label} 실패 (${dur}ms): ${e.message}`);
        throw e;
    }
}

/** Get log counts by level */
export function getLogStats() {
    return {
        total: _logs.length,
        errors: _errorCount,
        warns: _warnCount,
        info: _logs.filter(l => l.level === "INFO").length,
        ok: _logs.filter(l => l.level === "OK").length
    };
}

function _applyFilter(level) {
    _activeFilter = level;
    const entries = document.querySelectorAll("#log-entries .log-entry");
    entries.forEach(el => {
        el.style.display = (level === "ALL" || el.dataset.level === level) ? "" : "none";
    });
    // Update active button style
    document.querySelectorAll(".log-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === level);
    });
}

export function initLogPanel() {
    _sessionStart = Date.now();

    window.toggleLogPanel = () => {
        document.getElementById("log-panel").classList.toggle("collapsed");
    };
    window.clearLogs = () => {
        _logs.length = 0;
        _errorCount = 0;
        _warnCount = 0;
        document.getElementById("log-entries").innerHTML = "";
        _updateBadge();
    };
    window.copyLogs = () => {
        const text = _buildExportText();
        navigator.clipboard.writeText(text).then(() => tlog("Log", "클립보드에 복사됨"));
    };
    window.downloadLogs = () => {
        const text = _buildExportText();
        const blob = new Blob([text], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "admin-diag-log-" + new Date().toISOString().slice(0, 10) + ".txt";
        a.click();
        URL.revokeObjectURL(a.href);
    };
    window.filterLogs = (level) => _applyFilter(level);

    // Log environment info at session start
    const env = _getEnvInfo();
    tlog("Env", `세션 시작 — ${env.hostname} | ${env.browser} | ${env.platform}`, {
        url: env.url,
        ua: env.ua,
        sessionId: env.sessionId
    });
}

function _buildExportText() {
    const env = _getEnvInfo();
    const stats = getLogStats();
    const header = [
        "=== Admin Diagnostic Log ===",
        `생성 시각: ${new Date().toLocaleString("ko-KR")}`,
        `세션 시작: ${new Date(_sessionStart).toLocaleString("ko-KR")}`,
        `세션 지속: ${((Date.now() - _sessionStart) / 1000).toFixed(0)}초`,
        "",
        "─── 환경 정보 ───",
        `URL: ${env.url}`,
        `호스트: ${env.hostname}`,
        `브라우저: ${env.browser} (${env.platform})`,
        `UA: ${env.ua}`,
        "",
        "─── 요약 ───",
        `전체: ${stats.total}건 | ERROR: ${stats.errors} | WARN: ${stats.warns} | OK: ${stats.ok} | INFO: ${stats.info}`,
        "",
        "─── 로그 ───"
    ].join("\n");

    const logs = _logs.map(l => {
        let line = `[${l.ts}] [+${l.elapsed}] [${l.level}] [${l.tag}] ${l.msg}`;
        if (l.extra) line += ` | ${typeof l.extra === "object" ? JSON.stringify(l.extra) : l.extra}`;
        return line;
    }).join("\n");

    return header + "\n" + logs;
}
