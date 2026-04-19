// ─── Auth Module ───
import {
    auth, functions, provider, authReady, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, getIdTokenResult, httpsCallable
} from "./firebase-init.js";

let _currentUser = null;
let _isAdmin = false;
let _isMaster = false;
let _isAdminOperator = false;
let _onAuthCallbacks = [];
let _redirectError = null;
// Persisted in sessionStorage so it survives the full-page navigation of signInWithRedirect
let _redirectAttempted = !!sessionStorage.getItem('_firebaseRedirectPending');

export function getCurrentUser() { return _currentUser; }
export function isAdmin() { return _isAdmin; }
export function isMaster() { return _isMaster; }
export function isAdminOperator() { return _isAdminOperator; }

/** Register callback for auth state changes: cb(user, isAdmin, isMaster, isAdminOperator) */
export function onAdminAuth(cb) { _onAuthCallbacks.push(cb); }

/** Check if user has admin or adminOperator custom claim */
export async function checkAdminClaim(user) {
    if (!user) return false;
    const tokenResult = await getIdTokenResult(user);
    return tokenResult.claims.admin === true || tokenResult.claims.adminOperator === true;
}

/** Check if user has master custom claim */
export async function checkMasterClaim(user) {
    if (!user) return false;
    const tokenResult = await getIdTokenResult(user);
    return tokenResult.claims.master === true;
}

/** Check if user has adminOperator custom claim */
export async function checkAdminOperatorClaim(user) {
    if (!user) return false;
    const tokenResult = await getIdTokenResult(user);
    return tokenResult.claims.adminOperator === true;
}

/** Get full token claims for diagnostic display */
export async function getTokenClaims(user) {
    if (!user) return null;
    return await getIdTokenResult(user);
}

/** Force-refresh ID token to pick up latest custom claims */
export async function ensureFreshToken() {
    const user = auth.currentUser;
    if (!user) return;
    try {
        await user.getIdToken(true);
    } catch (e) {
        console.warn("[ensureFreshToken]", e.message);
    }
}

function isMobileBrowser() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Google sign-in — 모바일에서도 popup 우선 시도, 실패 시 redirect fallback */
export async function doLogin() {
    try {
        // 모바일/PC 모두 popup 우선 시도 (redirect는 cross-origin 세션 유실 문제 있음)
        await signInWithPopup(auth, provider);
    } catch (e) {
        // 모바일에서 popup 차단 시 redirect로 fallback
        if (isMobileBrowser() && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
            console.log("[Login] 모바일 popup 차단 → redirect fallback");
            sessionStorage.setItem('_firebaseRedirectPending', '1');
            _redirectAttempted = true;
            await signInWithRedirect(auth, provider);
            return;
        }

        // Popup 채널 오류 (CSP frame-src 차단, 네트워크 등) → redirect fallback으로 우회
        // auth/internal-error: popup postMessage 채널 실패 (DOM Event customData)
        // auth/network-request-failed: popup 내부 네트워크 요청 실패
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/internal-error' || e.code === 'auth/network-request-failed') {
            console.warn("[Login] Popup 실패 → redirect fallback:", e.code, e.customData ?? '');
            window.dispatchEvent(new CustomEvent('admin-auth-diagnostic', {
                detail: { source: 'doLogin', code: e.code, message: 'Popup 채널 실패 → redirect 방식으로 재시도' }
            }));
            sessionStorage.setItem('_firebaseRedirectPending', '1');
            _redirectAttempted = true;
            await signInWithRedirect(auth, provider);
            return;
        }

        console.error("[Login]", e.code, e.message, e.customData ?? '');

        const errorMessages = {
            'auth/popup-closed-by-user': null,
            'auth/cancelled-popup-request': null,
            'auth/unauthorized-domain': `이 도메인(${location.hostname})이 Firebase 승인 도메인에 등록되지 않았습니다.`,
            'auth/network-request-failed': '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.',
        };

        const userMessage = errorMessages[e.code];
        if (userMessage === null) return; // 사용자 취소 — 무시

        e.userMessage = userMessage || `인증 오류 (${e.code}): ${e.message}`;
        // customData가 DOM Event일 경우 serverResponse만 추출 (isTrusted 등 raw event 필드 제외)
        if (e.customData?.serverResponse) e.serverDetail = JSON.stringify(e.customData.serverResponse);
        throw e;
    }
}

/** Sign out */
export async function doLogout() {
    await signOut(auth);
}

/** Sync claims from server (MASTER_EMAILS/ADMIN_EMAILS → custom claims) */
async function syncClaimsFromServer(user) {
    try {
        const syncClaims = httpsCallable(functions, "syncClaims");
        const result = await syncClaims();
        console.log("[syncClaims] Result:", JSON.stringify(result.data));
        if (result.data.updated) {
            console.log("[syncClaims] Claims updated, refreshing token...");
            await user.getIdToken(true); // Force refresh to pick up new claims
        }
    } catch (e) {
        console.warn("[syncClaims] Sync failed:", e.code || 'unknown', e.message);
        if (e.code === 'functions/unauthenticated') {
            console.error("[syncClaims] Auth token invalid. firebase-config.js의 API 키(FIREBASE_WEB_API_KEY)를 확인하세요.");
        }
    }
}

// Handle redirect result (모바일 redirect fallback 복귀 시)
getRedirectResult(auth).then(result => {
    sessionStorage.removeItem('_firebaseRedirectPending');
    _redirectAttempted = false;
    if (result && result.user) {
        console.log("[Auth redirect] 리다이렉트 로그인 성공:", result.user.email);
    }
}).catch(e => {
    sessionStorage.removeItem('_firebaseRedirectPending');
    console.error("[Auth redirect]", e.code, e.message, e.customData ?? '');
    // Always surface in log panel for developer diagnostics
    window.dispatchEvent(new CustomEvent('admin-auth-diagnostic', {
        detail: { source: 'getRedirectResult', code: e.code, message: e.message }
    }));
    // Show user-facing error only when redirect was explicitly attempted this session.
    // _redirectAttempted survives the page reload via sessionStorage (_firebaseRedirectPending).
    if (_redirectAttempted && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        _redirectError = e.message || '리다이렉트 로그인 중 오류가 발생했습니다.';
        window.dispatchEvent(new CustomEvent('admin-auth-error', { detail: _redirectError }));
    }
    _redirectAttempted = false;
});

// Wait for persistence setup, then listen for auth state changes
authReady.then(() => {
    console.log("[Auth] persistence 준비 완료, onAuthStateChanged 등록");
});

onAuthStateChanged(auth, async (user) => {
    _currentUser = user;
    _isAdmin = false;
    _isMaster = false;
    _isAdminOperator = false;
    if (user) {
        // Sync claims from server first (repairs missing master/admin claims)
        await syncClaimsFromServer(user);

        _isAdmin = await checkAdminClaim(user);
        _isMaster = await checkMasterClaim(user);
        _isAdminOperator = await checkAdminOperatorClaim(user);
    }
    _onAuthCallbacks.forEach(cb => {
        try { cb(user, _isAdmin, _isMaster, _isAdminOperator); } catch (e) { console.error("[onAdminAuth]", e); }
    });
});
