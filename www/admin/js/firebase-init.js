// ─── Firebase Init (shared across admin modules) ───
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, getIdTokenResult, setPersistence, browserLocalPersistence }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
    query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js";

if (!self.__FIREBASE_CONFIG) {
    const msg = 'firebase-config.js가 로드되지 않았습니다. 배포 설정(FIREBASE_WEB_API_KEY)을 확인하세요.';
    console.error('[App]', msg);
    document.body.innerHTML = '<div style="color:#ff5252;padding:40px;text-align:center;font-family:sans-serif;">' + msg + '</div>';
    throw new Error(msg);
}
const firebaseConfig = self.__FIREBASE_CONFIG;

// Validate that apiKey is present and non-empty
if (!firebaseConfig.apiKey || typeof firebaseConfig.apiKey !== 'string' || firebaseConfig.apiKey.trim() === '') {
    const msg = 'Firebase API 키가 비어있거나 유효하지 않습니다. GitHub Secret(FIREBASE_WEB_API_KEY)을 확인하세요.';
    console.error('[App]', msg, '현재 apiKey:', JSON.stringify(firebaseConfig.apiKey));
    document.body.innerHTML = '<div style="color:#ff5252;padding:40px;text-align:center;font-family:sans-serif;">' + msg + '</div>';
    throw new Error(msg);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
console.log('[App] Firebase initialized. Project:', firebaseConfig.projectId, '| apiKey length:', firebaseConfig.apiKey.length);

// App Check — admin 페이지는 항상 웹이므로 네이티브 체크 불필요
if (firebaseConfig.appCheckDebugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = firebaseConfig.appCheckDebugToken;
}
if (firebaseConfig.appCheckSiteKey) {
    try {
        initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(firebaseConfig.appCheckSiteKey),
            isTokenAutoRefreshEnabled: true,
        });
        console.log('[AppCheck] Admin App Check 초기화 완료');
    } catch (e) {
        console.warn('[AppCheck] Admin 초기화 스킵:', e.message);
    }
}

// Explicitly set persistence to survive page reloads — export promise so auth.js can await it
const authReady = setPersistence(auth, browserLocalPersistence)
    .then(() => console.log('[App] Auth persistence: browserLocalPersistence 설정 완료'))
    .catch(e => console.warn('[App] Auth persistence 설정 실패:', e.message));
const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast3");
const provider = new GoogleAuthProvider();

export {
    app, auth, db, functions, provider, firebaseConfig, authReady,
    // Re-export commonly used Firebase utilities
    GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, getIdTokenResult,
    collection, doc, getDoc, getDocs, addDoc, setDoc, query, where, orderBy, limit, Timestamp,
    httpsCallable
};
