import { logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

let _analytics = null;

function init(analytics) {
    _analytics = analytics;
    _observeFCP();
    _observeLCP();
    _observeCLS();
    _observeINP();
    _observeTTFB();
}

// Google "Good" / "Poor" 경계값 (Core Web Vitals 기준)
const _THRESHOLDS = {
    LCP:  [2500, 4000],
    CLS:  [0.1,  0.25],
    INP:  [200,  500],
    FCP:  [1800, 3000],
    TTFB: [800,  1800],
};

function _rate(name, value) {
    const [good, poor] = _THRESHOLDS[name] || [0, Infinity];
    return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

function _report(name, value) {
    const rating = _rate(name, value);
    if (_analytics) {
        try {
            fbLogEvent(_analytics, 'web_vital', {
                metric_name: name,
                metric_value: Math.round(value),
                metric_rating: rating,
            });
        } catch (e) {}
    }
    if (window.AppLogger) {
        AppLogger.info(`[Perf] ${name}: ${Math.round(value)} (${rating})`);
    }
}

function _observeLCP() {
    try {
        let lcpValue = 0;
        const po = new PerformanceObserver(list => {
            const entries = list.getEntries();
            lcpValue = entries[entries.length - 1].startTime;
        });
        po.observe({ type: 'largest-contentful-paint', buffered: true });
        // 페이지가 백그라운드로 전환될 때 최종 LCP 확정
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && lcpValue > 0) {
                _report('LCP', lcpValue);
                po.disconnect();
            }
        }, { once: true });
    } catch (e) {}
}

function _observeCLS() {
    try {
        let clsValue = 0;
        const po = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) clsValue += entry.value;
            }
        });
        po.observe({ type: 'layout-shift', buffered: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                _report('CLS', clsValue);
                po.disconnect();
            }
        }, { once: true });
    } catch (e) {}
}

function _observeINP() {
    try {
        let inpValue = 0;
        const po = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.duration > inpValue) inpValue = entry.duration;
            }
        });
        po.observe({ type: 'event', durationThreshold: 40, buffered: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && inpValue > 0) {
                _report('INP', inpValue);
                po.disconnect();
            }
        }, { once: true });
    } catch (e) {}
}

function _observeFCP() {
    try {
        const po = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'first-contentful-paint') {
                    _report('FCP', entry.startTime);
                    po.disconnect();
                }
            }
        });
        po.observe({ type: 'paint', buffered: true });
    } catch (e) {}
}

function _observeTTFB() {
    try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) _report('TTFB', nav.responseStart);
    } catch (e) {}
}

export const PerformanceMonitor = { init };
