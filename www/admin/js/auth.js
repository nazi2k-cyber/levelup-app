// ─── Auth Module ───
import {
    auth, provider, signInWithPopup, signOut, onAuthStateChanged, getIdTokenResult
} from "./firebase-init.js";

let _currentUser = null;
let _isAdmin = false;
let _onAuthCallbacks = [];

export function getCurrentUser() { return _currentUser; }
export function isAdmin() { return _isAdmin; }

/** Register callback for auth state changes: cb(user, isAdmin) */
export function onAdminAuth(cb) { _onAuthCallbacks.push(cb); }

/** Check if user has admin custom claim */
export async function checkAdminClaim(user) {
    if (!user) return false;
    const tokenResult = await getIdTokenResult(user);
    return tokenResult.claims.admin === true;
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

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
    _currentUser = user;
    _isAdmin = false;
    if (user) {
        _isAdmin = await checkAdminClaim(user);
    }
    _onAuthCallbacks.forEach(cb => {
        try { cb(user, _isAdmin); } catch (e) { console.error("[onAdminAuth]", e); }
    });
});
