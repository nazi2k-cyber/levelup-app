// --- Firebase SDK 초기화 ---
// app.js에서 분리된 Firebase 인프라 모듈

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, sendEmailVerification, sendPasswordResetEmail, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, updateDoc, arrayUnion, arrayRemove, enableNetwork, disableNetwork } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getStorage, ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getRemoteConfig, fetchAndActivate, getValue, getString } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-remote-config.js";
import { getAnalytics, logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

if (!self.__FIREBASE_CONFIG) {
    console.error('[App] firebase-config.js가 로드되지 않았습니다. npm run generate-config를 실행하세요.');
}
const firebaseConfig = self.__FIREBASE_CONFIG;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const isNativePlatform = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
const db = initializeFirestore(app, {
    ...(isNativePlatform
        ? { experimentalForceLongPolling: true }
        : { experimentalAutoDetectLongPolling: true }),
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const functions = getFunctions(app, "asia-northeast3");

// --- Firebase Analytics ---
let analytics = null;
try {
    analytics = getAnalytics(app);
} catch (e) {
    console.warn('[Analytics] 초기화 스킵:', e.message);
}

// Firebase Cloud Messaging 초기화 (웹 환경에서만)
let messaging = null;
try {
    if (!isNativePlatform) {
        messaging = getMessaging(app);
    }
} catch (e) {
    console.warn('[FCM] Messaging 초기화 스킵:', e.message);
}

export {
    app, auth, db, storage, functions, analytics, messaging, firebaseConfig, isNativePlatform,
    // Firebase Auth
    createUserWithEmailAndPassword, signInWithEmailAndPassword, fbSignOut, onAuthStateChanged,
    GoogleAuthProvider, signInWithPopup, signInWithCredential, sendEmailVerification,
    sendPasswordResetEmail, getIdTokenResult,
    // Firebase Firestore
    doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, updateDoc,
    arrayUnion, arrayRemove, enableNetwork, disableNetwork,
    // Firebase Messaging
    getToken, onMessage,
    // Firebase Storage
    ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject,
    // Firebase Remote Config
    getRemoteConfig, fetchAndActivate, getValue, getString,
    // Firebase Analytics
    fbLogEvent,
    // Firebase Functions
    httpsCallable
};
