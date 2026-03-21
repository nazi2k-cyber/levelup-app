// ─── Auth Module ───
import {
    auth, functions, provider, signInWithPopup, signOut, onAuthStateChanged, getIdTokenResult, httpsCallable
} from "./firebase-init.js";

let _currentUser = null;
let _isAdmin = false;
let _isMaster = false;
let _isAdminOperator = false;
let _onAuthCallbacks = [];

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

/** Google sign-in */
export async function doLogin() {
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error("[Login]", e.message);
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
        if (result.data.updated) {
            console.log("[syncClaims] Claims updated, refreshing token...");
            await user.getIdToken(true); // Force refresh to pick up new claims
        }
    } catch (e) {
        console.warn("[syncClaims] Sync failed:", e.message);
    }
}

// Listen for auth state changes
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
