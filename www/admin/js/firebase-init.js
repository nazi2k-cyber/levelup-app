// ─── Firebase Init (shared across admin modules) ───
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getIdTokenResult }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
    query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

if (!self.__FIREBASE_CONFIG) {
    throw new Error('firebase-config.js 누락: npm run generate-config 실행 또는 firebase-config.example.js를 참고하여 firebase-config.js를 생성하세요.');
}
const firebaseConfig = self.__FIREBASE_CONFIG;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast3");
const provider = new GoogleAuthProvider();

export {
    app, auth, db, functions, provider, firebaseConfig,
    // Re-export commonly used Firebase utilities
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getIdTokenResult,
    collection, doc, getDoc, getDocs, addDoc, setDoc, query, where, orderBy, limit, Timestamp,
    httpsCallable
};
