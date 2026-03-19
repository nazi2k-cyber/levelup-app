// ─── Log Panel ───
import { esc } from "./utils.js";

const _logs = [];
let _errorCount = 0;

function _addLog(level, tag, msg) {
    const now = new Date();
    const ts = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    const entry = { ts, level, tag, msg: typeof msg === "object" ? JSON.stringify(msg, null, 2) : String(msg) };
    _logs.push(entry);

    const container = document.getElementById("log-entries");
    if (container) {
        const cls = level === "ERROR" ? "log-error" : level === "WARN" ? "log-warn" : level === "OK" ? "log-ok" : "log-info";
        const div = document.createElement("div");
        div.className = "log-entry " + cls;
        div.innerHTML = `<span class="log-time">${entry.ts}</span><span class="log-level">[${level}]</span><span class="log-msg">[${entry.tag}] ${esc(entry.msg)}</span>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    if (level === "ERROR") {
        _errorCount++;
        const badge = document.getElementById("log-count");
        if (badge) { badge.textContent = _errorCount; badge.style.display = "inline"; }
    }
}

export function tlog(tag, msg) { _addLog("INFO", tag, msg); }
export function tok(tag, msg) { _addLog("OK", tag, msg); }
export function twarn(tag, msg) { _addLog("WARN", tag, msg); }
export function terror(tag, msg) { _addLog("ERROR", tag, msg); }

export function initLogPanel() {
    window.toggleLogPanel = () => {
        document.getElementById("log-panel").classList.toggle("collapsed");
    };
    window.clearLogs = () => {
        _logs.length = 0;
        _errorCount = 0;
        document.getElementById("log-entries").innerHTML = "";
        const badge = document.getElementById("log-count");
        badge.textContent = "0";
        badge.style.display = "none";
    };
    window.copyLogs = () => {
        const text = _logs.map(l => `[${l.ts}] [${l.level}] [${l.tag}] ${l.msg}`).join("\n");
        navigator.clipboard.writeText(text).then(() => tlog("Log", "클립보드에 복사됨"));
    };
    window.downloadLogs = () => {
        const text = "=== Admin Diagnostic Log ===\nGenerated: " + new Date().toLocaleString("ko-KR") + "\n\n" +
            _logs.map(l => `[${l.ts}] [${l.level}] [${l.tag}] ${l.msg}`).join("\n");
        const blob = new Blob([text], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "admin-diag-log-" + new Date().toISOString().slice(0, 10) + ".txt";
        a.click();
        URL.revokeObjectURL(a.href);
    };
}
