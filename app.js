// --- Firebase SDK 및 초기화 (이전 Config 유지) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// [사용자님의 firebaseConfig를 여기에 유지하세요]
const firebaseConfig = {
    apiKey: "AIzaSyDxNjHzj7ybZNLhG-EcbA5HKp9Sg4QhAno",
    authDomain: "levelup-app-53d02.firebaseapp.com",
    projectId: "levelup-app-53d02",
    storageBucket: "levelup-app-53d02.firebasestorage.app",
    messagingSenderId: "233040099152",
    appId: "1:233040099152:web:82310514d26c8c6d52de55",
    measurementId: "G-4DBGG03CCJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const AppState = {
    // ... (기존 AppState 구조 유지)
    user: {
        // ... (기존 구조)
        photoURL: null,
        friends: [] // 친구 UID 저장용
    }
};

// --- [해결 1] 프로필 사진 저장 오류 수정 ---
async function loadProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 용량 제한을 위해 Base64 압축 저장 (서버 스토리지 비용 절감)
    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        document.getElementById('profilePreview').src = base64Image;
        AppState.user.photoURL = base64Image;
        
        // 즉시 서버에 이미지 저장
        if(auth.currentUser) {
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
                photoURL: base64Image
            });
        }
        localStorage.setItem('profileImage', base64Image);
    };
    reader.readAsDataURL(file);
}

// --- [해결 2] 소셜 기능 및 친구 탭 활성화 ---
async function fetchSocialData() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        let players = [];
        
        // 내 정보 최신화 (친구 목록 포함)
        const myDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        const myData = myDoc.data();
        const myFriends = myData.friends || [];

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const isMe = auth.currentUser.uid === uid;
            
            players.push({
                id: uid,
                name: data.name || "Unknown",
                title: data.titleHistory ? data.titleHistory[data.titleHistory.length - 1].title : "각성자",
                str: data.stats?.str || 0,
                int: data.stats?.int || 0,
                cha: data.stats?.cha || 0,
                vit: data.stats?.vit || 0,
                wlth: data.stats?.wlth || 0,
                agi: data.stats?.agi || 0,
                photoURL: data.photoURL || null,
                isMe: isMe,
                isFriend: myFriends.includes(uid) // 친구 여부 판단
            });
        });
        
        AppState.social.users = players;
        renderUsers(AppState.social.sortCriteria);
    } catch(e) {
        console.error("소셜 로드 실패:", e);
    }
}

// --- [해결 2-1] 친구 추가/삭제 기능 실제 서버 연동 ---
async function toggleFriend(targetUid) {
    if(!auth.currentUser) return;
    const myRef = doc(db, "users", auth.currentUser.uid);
    const targetUser = AppState.social.users.find(u => u.id === targetUid);
    
    if(targetUser.isFriend) {
        await updateDoc(myRef, { friends: arrayRemove(targetUid) });
        alert("친구 삭제 완료");
    } else {
        await updateDoc(myRef, { friends: arrayUnion(targetUid) });
        alert("친구 추가 완료");
    }
    fetchSocialData(); // 데이터 새로고침
}

// 탭 전환 시 소셜 데이터 새로고침 리스너
function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    if(tabId === 'social') {
        fetchSocialData(); // 소셜 탭 진입 시 항상 최신화
    }
}
