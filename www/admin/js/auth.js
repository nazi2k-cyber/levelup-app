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
            await signInWithRedirect(auth, provider);
            return;
        }

        console.error("[Login]", e.code, e.message);

        const errorMessages = {
            'auth/popup-blocked': '팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.',
            'auth/popup-closed-by-user': null,
            'auth/cancelled-popup-request': null,
            'auth/unauthorized-domain': `이 도메인(${location.hostname})이 Firebase 승인 도메인에 등록되지 않았습니다.`,
            'auth/network-request-failed': '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.',
            'auth/internal-error': 'Firebase 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        };

        const userMessage = errorMessages[e.code];
        if (userMessage === null) return; // 사용자 취소 — 무시

        e.userMessage = userMessage || e.message;
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
    if (result && result.user) {
        console.log("[Auth redirect] 리다이렉트 로그인 성공:", result.user.email);
    }
}).catch(e => {
    console.error("[Auth redirect]", e.code, e.message);
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        _redirectError = e.message || '리다이렉트 로그인 중 오류가 발생했습니다.';
        window.dispatchEvent(new CustomEvent('admin-auth-error', { detail: _redirectError }));
    }
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
