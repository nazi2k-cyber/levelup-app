// ─── Firebase Init (shared across admin modules) ───
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getIdTokenResult }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
    query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyDxNjHzj7ybZNLhG-EcbA5HKp9Sg4QhAno",
    authDomain: "levelup-app-53d02.firebaseapp.com",
    projectId: "levelup-app-53d02",
    storageBucket: "levelup-app-53d02.firebasestorage.app",
    messagingSenderId: "233040099152",
    appId: "1:233040099152:web:82310514d26c8c6d52de55"
};

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
