// ─── Shared Utilities ───

/** Escape HTML entities */
export function esc(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

/** Format date to Korean locale string */
export function fmtDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

/** Format relative time (e.g., "3분 전") */
export function relTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "방금 전";
    if (diff < 3600000) return Math.floor(diff / 60000) + "분 전";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "시간 전";
    return Math.floor(diff / 86400000) + "일 전";
}
