// --- 네트워크 연결 품질 모니터 (제1원칙: 연결은 이분법이 아닌 스펙트럼) ---
let _apiKey = '';
let _quality = 'good'; // 'good' | 'weak' | 'offline'
let _listeners = [];
let _lastCheck = 0;

function init(apiKey) {
    _apiKey = apiKey;
}

function getQuality() { return _quality; }
function isUsable() { return _quality !== 'offline'; }

async function checkNow() {
    if (!navigator.onLine) { _setQuality('offline'); return 'offline'; }
    const now = Date.now();
    if (now - _lastCheck < 5000) return _quality; // 5초 내 중복 방지
    _lastCheck = now;
    try {
        const start = performance.now();
        // Firebase Auth 엔드포인트에 HEAD 요청 — 실제 연결 품질 측정
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        await fetch('https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=' + _apiKey, {
            method: 'HEAD', mode: 'no-cors', signal: controller.signal
        });
        clearTimeout(timeoutId);
        const latency = performance.now() - start;
        _setQuality(latency > 3000 ? 'weak' : 'good');
    } catch (e) {
        _setQuality(navigator.onLine ? 'weak' : 'offline');
    }
    return _quality;
}

function _setQuality(q) {
    if (_quality !== q) {
        const prev = _quality;
        _quality = q;
        if (window.AppLogger) AppLogger.info(`[Network] 품질 변경: ${prev} → ${q}`);
        _listeners.forEach(fn => { try { fn(q, prev); } catch(e) {} });
    }
}

function onQualityChange(fn) { _listeners.push(fn); }

// navigator.connection API 활용 (지원 브라우저)
if (navigator.connection) {
    navigator.connection.addEventListener('change', () => {
        const conn = navigator.connection;
        if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') {
            _setQuality('weak');
        } else if (!navigator.onLine) {
            _setQuality('offline');
        } else {
            _setQuality('good');
        }
    });
}

export const NetworkMonitor = { init, getQuality, isUsable, checkNow, onQualityChange };
