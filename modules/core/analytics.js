// --- 전환율 계측 & Remote Config ---
// app.js에서 분리된 ConversionTracker + A/B 테스트 인프라

import { analytics, auth, db, fbLogEvent, getString, getRemoteConfig, fetchAndActivate } from './firebase-init.js';
import { doc, setDoc } from './firebase-init.js';

// --- Firebase Remote Config (A/B 테스트 인프라) ---
let remoteConfig = null;
try {
    const { app } = await import('./firebase-init.js');
    remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = 3600000; // 1시간
    remoteConfig.defaultConfig = {
        onboarding_variant: 'compact',    // 'legacy' (5단계) | 'compact' (3단계)
        login_layout: 'social_first',     // 'social_first' | 'email_first'
    };
} catch (e) {
    console.warn('[RemoteConfig] 초기화 스킵:', e.message);
}

// --- 전환율 계측 (Conversion Funnel Tracking) ---
export const ConversionTracker = (() => {
    const STORAGE_KEY = 'levelup_funnel';

    function _getSession() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }
    function _setSession(data) {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
    }

    // 퍼널 이벤트 기록
    function track(eventName, params = {}) {
        const session = _getSession();
        if (session[eventName]) return; // 중복 방지
        session[eventName] = Date.now();
        _setSession(session);

        const payload = {
            ...params,
            onboarding_variant: _getVariant('onboarding_variant'),
            login_layout: _getVariant('login_layout'),
            timestamp: new Date().toISOString(),
        };

        // Firebase Analytics 로깅
        if (analytics) {
            try { fbLogEvent(analytics, eventName, payload); } catch {}
        }

        // Firestore 퍼널 로그 (선택적)
        if (window._funnelLogEnabled && auth.currentUser) {
            const logRef = doc(db, 'funnel_events', `${auth.currentUser.uid}_${eventName}_${Date.now()}`);
            setDoc(logRef, { uid: auth.currentUser.uid, event: eventName, ...payload }).catch(() => {});
        }

        if (window.AppLogger) AppLogger.info(`[Funnel] ${eventName} ` + JSON.stringify(payload));
    }

    function _getVariant(key) {
        try {
            return remoteConfig ? getString(remoteConfig, key) : (remoteConfig?.defaultConfig?.[key] || 'unknown');
        } catch { return 'unknown'; }
    }

    // 퍼널 단계 정의
    return {
        track,
        // Phase 2 핵심 퍼널 이벤트
        screenView:       ()    => track('funnel_screen_view'),
        loginStart:       (method) => track('funnel_login_start', { method }),
        loginComplete:    (method) => track('funnel_login_complete', { method }),
        signupStart:      (method) => track('funnel_signup_start', { method }),
        signupComplete:   (method) => track('funnel_signup_complete', { method }),
        emailVerified:    ()    => track('funnel_email_verified'),
        onboardingStart:  ()    => track('funnel_onboarding_start'),
        onboardingStep:   (step) => track(`funnel_onboarding_step_${step}`, { step }),
        onboardingDone:   ()    => track('funnel_onboarding_done'),
        firstSession:     ()    => track('funnel_first_session'),
        d1Return:         ()    => track('funnel_d1_return'),
    };
})();

// Remote Config 가져오기 (비동기)
export async function initRemoteConfig() {
    if (!remoteConfig) return;
    try {
        await fetchAndActivate(remoteConfig);
        if (window.AppLogger) AppLogger.info('[RemoteConfig] fetch & activate 완료');
    } catch (e) {
        console.warn('[RemoteConfig] fetch 실패 (기본값 사용):', e.message);
    }
}

// A/B 테스트 변형 값 가져오기
export function getExperimentVariant(key) {
    if (!remoteConfig) {
        // Remote Config 사용 불가 시 기본값 반환
        const defaults = { onboarding_variant: 'compact', login_layout: 'social_first' };
        return defaults[key] || '';
    }
    try { return getString(remoteConfig, key); } catch { return ''; }
}

export { remoteConfig };
