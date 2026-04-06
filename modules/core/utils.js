// --- 유틸리티 함수 모음 ---
// app.js에서 분리된 sanitize, date/time 헬퍼

// === XSS 방지 ===

/** XSS 방지용 텍스트 새니타이즈 */
export function sanitizeText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** XSS 방지용 HTML 속성값 새니타이즈 */
export function sanitizeAttr(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 인스타그램 ID 검증 (영문, 숫자, 밑줄, 마침표만 허용) */
export function sanitizeInstaId(id) {
    if (typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9._]/g, '');
}

/** URL 새니타이즈 (javascript: 프로토콜 차단) */
export function sanitizeURL(url) {
    if (typeof url !== 'string' || !url) return '';
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:text/html')) return '';
    return sanitizeAttr(url);
}

// === 날짜/시간 헬퍼 ===

/** 오늘 날짜 YYYY-MM-DD (로컬 시간) */
export function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** KST(UTC+9) 기준 Date 객체 생성 */
export function getKSTDate(now) {
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
    return kst;
}

/** KST 기준 날짜 문자열 YYYY-MM-DD */
export function getKSTDateStr(now) {
    const kst = getKSTDate(now);
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

/** KST 기준 오늘 날짜 문자열 */
export function getTodayKST() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

/** 남은 시간을 HH:MM:SS 포맷으로 변환 */
export function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/** KST 자정까지 남은 시간(ms) 계산 */
export function getMsUntilNextKSTMidnight() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset + now.getTimezoneOffset() * 60 * 1000);
    const kstTomorrow = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate() + 1, 0, 0, 0, 0);
    return kstTomorrow.getTime() - kstNow.getTime();
}
