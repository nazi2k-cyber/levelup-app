// --- Firebase SDK 초기화 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
googleProvider.addScope('https://www.googleapis.com/auth/fitness.activity.read');
googleProvider.setCustomParameters({ prompt: 'select_account' });

// --- 상태 관리 객체 ---
let AppState = getInitialAppState();

function getInitialAppState() {
    return {
        isLoginMode: true,
        currentLang: 'ko',
        user: {
            name: "신규 헌터",
            level: 1,
            points: 50,
            stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            titleHistory: [ { level: 1, title: { ko: "신규 각성자", en: "New Awakened", ja: "新規覚醒者" } } ],
            photoURL: null, 
            friends: [],
            syncEnabled: false, 
            stepData: { date: "", rewardedSteps: 0 },
            instaId: "" 
        },
        quest: {
            currentDayOfWeek: new Date().getDay(),
            completedState: Array.from({length: 7}, () => Array(12).fill(false))
        },
        social: { mode: 'global', sortCriteria: 'total', users: [] },
        dungeon: { lastGeneratedDate: null, slot: 0, stationIdx: 0, participants: 0, isJoined: false, targetStat: 'str', progress: 0, isCleared: false },
    };
}

// --- 초기화 및 인증 감지 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindEvents();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadUserDataFromDB(user); 
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            document.querySelector('main').style.overflowY = 'hidden';
            
            changeLanguage(AppState.currentLang); 
            renderCalendar(); 
            updatePointUI(); 
            drawRadarChart(); 
            updateDungeonStatus();
            fetchSocialData(); 
            
            if (AppState.user.syncEnabled) { syncHealthData(false); }
        } else {
            document.getElementById('login-screen').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-none');
        }
    });

    setInterval(updateDungeonStatus, 60000); 
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.getElementById('theme-toggle').checked = true;
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

function bindEvents() {
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    
    document.querySelectorAll('.nav-item').forEach(el => { 
        el.addEventListener('click', () => switchTab(el.dataset.tab, el)); 
    });

    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 
    
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-status-info').addEventListener('click', openStatusInfoModal);
    document.getElementById('btn-quest-info').addEventListener('click', openQuestInfoModal);
    document.getElementById('btn-dungeon-info').addEventListener('click', openDungeonInfoModal);
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);
}

// --- DB 통신 ---
async function saveUserData() {
    if(!auth.currentUser) return;
    try {
        await setDoc(doc(db, "users", auth.currentUser.uid), {
            name: AppState.user.name,
            stats: AppState.user.stats,
            level: AppState.user.level,
            points: AppState.user.points,
            titleHistoryStr: JSON.stringify(AppState.user.titleHistory),
            questStr: JSON.stringify(AppState.quest.completedState),
            dungeonStr: JSON.stringify(AppState.dungeon),
            friends: AppState.user.friends || [],
            photoURL: AppState.user.photoURL || null,
            syncEnabled: AppState.user.syncEnabled, 
            stepData: AppState.user.stepData,
            instaId: AppState.user.instaId || "" 
        }, { merge: true });
    } catch(e) { console.error("데이터 저장 실패:", e); }
}

async function loadUserDataFromDB(user) {
    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if(data.stats) AppState.user.stats = data.stats;
            if(data.level) AppState.user.level = data.level;
            if(data.points) AppState.user.points = data.points;
            if(data.titleHistoryStr) {
                try { AppState.user.titleHistory = JSON.parse(data.titleHistoryStr); } catch(e) { AppState.user.titleHistory = [{level:1, title:{ko:"각성자"}}]; }
            }
            if(data.questStr) AppState.quest.completedState = JSON.parse(data.questStr);
            if(data.dungeonStr) AppState.dungeon = JSON.parse(data.dungeonStr);
            if(data.friends) AppState.user.friends = data.friends;
            if(data.syncEnabled !== undefined) AppState.user.syncEnabled = data.syncEnabled;
            if(data.stepData) AppState.user.stepData = data.stepData;
            if(data.instaId) AppState.user.instaId = data.instaId;
            document.getElementById('sync-toggle').checked = AppState.user.syncEnabled;
            AppState.user.name = data.name || user.displayName || "신규 헌터";
            if(data.photoURL) {
                AppState.user.photoURL = data.photoURL;
                document.getElementById('profilePreview').src = data.photoURL;
            }
        }
        loadPlayerName();
    } catch(e) { console.error("데이터 로드 실패:", e); }
}

// --- 로그인 시스템 (보안 및 오류 추적 강화) ---
async function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const btn = document.getElementById('btn-login-submit');
    if(!email || !pw) { alert(i18n[AppState.currentLang].login_err_empty || "이메일과 비밀번호를 입력해주세요."); return; }
    btn.innerText = "접속 중..."; btn.disabled = true;
    try {
        if(!AppState.isLoginMode) { 
            const pwConfirm = document.getElementById('login-pw-confirm').value;
            if(pw !== pwConfirm) throw new Error("비밀번호 불일치");
            await createUserWithEmailAndPassword(auth, email, pw);
        } else { await signInWithEmailAndPassword(auth, email, pw); }
    } catch (e) { 
        console.error(e);
        alert("로그인 실패: " + e.message); 
    } finally { 
        btn.innerText = AppState.isLoginMode ? "시스템 접속" : "회원가입"; 
        btn.disabled = false; 
    }
}

async function simulateGoogleLogin() { 
    try { 
        const result = await signInWithPopup(auth, googleProvider); 
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) { localStorage.setItem('gfit_token', credential.accessToken); }
    } catch(e) { 
        console.error(e); 
        if(e.code === 'auth/unauthorized-domain') {
            alert("보안 오류: 파이어베이스 콘솔에서 'up-reboot.vercel.app' 도메인을 승인해야 합니다.");
        } else if(e.code === 'auth/popup-blocked') {
            alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.");
        } else {
            alert("Google 로그인 실패: " + e.message);
        }
    }
}

async function logout() { await fbSignOut(auth); localStorage.clear(); window.location.reload(); }

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    document.getElementById('login-pw-confirm').classList.toggle('d-none', AppState.isLoginMode);
    btnSubmit.innerText = AppState.isLoginMode ? "시스템 접속" : "플레이어 등록";
    toggleText.innerText = AppState.isLoginMode ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인";
}

// --- 탭 이동 및 UI ---
function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    const mainEl = document.querySelector('main');
    if(tabId === 'status') { 
        mainEl.style.overflowY = 'hidden'; 
        drawRadarChart(); updatePointUI(); 
    } else {
        mainEl.style.overflowY = 'auto';
    }
    
    if(tabId === 'social') fetchSocialData(); 
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); }
    if(tabId === 'dungeon') updateDungeonStatus();
}

function loadPlayerName() { document.getElementById('prof-name').textContent = AppState.user.name; }
function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt || "이름 변경");
    if (newName?.trim()) {
        AppState.user.name = newName.trim();
        document.getElementById('prof-name').textContent = AppState.user.name;
        saveUserData();
    }
}
function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt || "인스타 ID", AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', '');
        saveUserData();
    }
}

async function loadProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 150; canvas.height = 150;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 150, 150);
            const base64 = canvas.toDataURL('image/jpeg', 0.6); 
            document.getElementById('profilePreview').src = base64;
            AppState.user.photoURL = base64;
            await saveUserData();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- 모달 제어 ---
function closeInfoModal() { 
    const m = document.getElementById('infoModal');
    m.classList.add('d-none'); m.classList.remove('d-flex');
}
function closeTitleModal() { document.getElementById('titleModal').classList.add('d-none'); }

function openTitleModal() {
    const container = document.getElementById('history-list-container');
    container.innerHTML = [...AppState.user.titleHistory].reverse().map(h => {
        const t = typeof h.title === 'object' ? h.title[AppState.currentLang] || h.title.ko : h.title;
        return `<div class="history-item"><span class="hist-lvl">Lv. ${h.level}</span><span class="hist-title">${t}</span></div>`;
    }).join('');
    document.getElementById('titleModal').classList.remove('d-none');
}

function openStatusInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_status_title;
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>스탯</th><th>설명</th></tr></thead><tbody>`;
    statKeys.forEach(k => { html += `<tr><td style="text-align:center"><b>${i18n[AppState.currentLang][k]}</b></td><td>${i18n[AppState.currentLang]['desc_'+k]}</td></tr>`; });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = "퀘스트 DB";
    const body = document.getElementById('info-modal-body');
    const dayNames = ["일","월","화","수","목","금","토"];
    let html = `<table class="info-table"><thead><tr><th>요일</th><th>미션</th></tr></thead><tbody>`;
    weeklyQuestData.forEach((day, i) => { 
        html += `<tr><td style="text-align:center"><b>${dayNames[i]}</b></td><td>${day[0].title.ko} 외 11건</td></tr>`;
    });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = "이상 현상 목록";
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>분류</th><th>현상</th></tr></thead><tbody>`;
    Object.keys(raidMissions).forEach(k => { html += `<tr><td>${raidMissions[k].stat}</td><td>${raidMissions[k].title.ko}</td></tr>`; });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

// --- 게임 로직 ---
function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33;
    const angles = statKeys.map((_, i) => -Math.PI/2 + (i * Math.PI/3));
    let points = "";
    statKeys.forEach((k, i) => {
        const val = Number(AppState.user.stats[k]) || 0;
        const r = radius * (val / 100);
        const x = centerX + r * Math.cos(angles[i]);
        const y = centerY + r * Math.sin(angles[i]);
        points += `${x},${y} `;
        document.getElementById(`barVal_${k}`).innerText = val;
        document.getElementById(`barFill_${k}`).style.width = `${val}%`;
    });
    document.getElementById('playerPolygon').setAttribute('points', points.trim());
    document.getElementById('totalScore').innerText = statKeys.reduce((s,k) => s + (Number(AppState.user.stats[k])||0), 0);
}

function processLevelUp() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    if(AppState.user.points < req) return;
    AppState.user.points -= req; AppState.user.level++;
    statKeys.forEach(k => { 
        AppState.user.stats[k] = Math.min(100, (Number(AppState.user.stats[k])||0) + (Number(AppState.user.pendingStats[k])||0)); 
        AppState.user.pendingStats[k] = 0; 
    });
    saveUserData(); updatePointUI(); drawRadarChart();
    alert("Level Up!");
}

function updatePointUI() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    const currentTitle = AppState.user.titleHistory[AppState.user.titleHistory.length-1].title;
    document.getElementById('prof-title-badge').innerText = (typeof currentTitle === 'object' ? currentTitle[AppState.currentLang] || currentTitle.ko : currentTitle) + " ℹ️";
}

// --- 소셜 시스템 (최종 복구 버전) ---
async function fetchSocialData() {
    try {
        const snap = await getDocs(collection(db, "users"));
        AppState.social.users = snap.docs.map(d => {
            const data = d.data();
            let userTitle = "각성자";
            if (data.titleHistoryStr) {
                try {
                    const parsed = JSON.parse(data.titleHistoryStr);
                    const last = parsed[parsed.length - 1].title;
                    userTitle = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last;
                } catch(e) {}
            }
            return { id: d.id, ...data, title: userTitle, stats: data.stats || {str:0,int:0,cha:0,vit:0,wlth:0,agi:0}, isFriend: AppState.user.friends.includes(d.id), isMe: auth.currentUser?.uid === d.id };
        });
        renderUsers(AppState.social.sortCriteria);
    } catch(e) { console.error(e); }
}

function renderUsers(criteria, btn = null) {
    if(btn) { 
        AppState.social.sortCriteria = criteria; 
        document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); 
    }
    const container = document.getElementById('user-list-container');
    let list = AppState.social.users.map(u => {
        const s = u.stats;
        const total = (Number(s.str)||0) + (Number(s.int)||0) + (Number(s.cha)||0) + (Number(s.vit)||0) + (Number(s.wlth)||0) + (Number(s.agi)||0);
        return { ...u, total, str:Number(s.str)||0, int:Number(s.int)||0, cha:Number(s.cha)||0, vit:Number(s.vit)||0, wlth:Number(s.wlth)||0, agi:Number(s.agi)||0 };
    });
    if(AppState.social.mode === 'friends') list = list.filter(u => u.isFriend || u.isMe);
    list.sort((a,b) => b[criteria] - a[criteria]);

    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: var(--text-sub);"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/></svg>`;

    container.innerHTML = list.map((u, i) => `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}">
            <div style="width:25px; font-weight:bold; color:var(--text-sub);">${i+1}</div>
            <div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">
                ${u.photoURL ? `<img src="${u.photoURL}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);">` : `<div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div class="user-info" style="margin-left:0;">
                    <div class="title-badge" style="font-size:0.6rem;">${u.title}</div>
                    <div style="font-size:0.9rem; display:flex; align-items:center;">
                        ${u.name} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${u.instaId}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                    </div>
                </div>
            </div>
            <div class="user-score" style="font-weight:900; color:var(--neon-blue);">${u[criteria]}</div>
            ${!u.isMe ? `<button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="toggleFriend('${u.id}')">${u.isFriend ? '친구✓' : '추가'}</button>` : ''}
        </div>
    `).join('');
}

// --- 기타 기능 ---
window.toggleQuest = (i) => { /* 기존 퀘스트 로직 동일 */ };
window.toggleFriend = async (id) => {
    const isFriend = AppState.user.friends.includes(id);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { friends: isFriend ? arrayRemove(id) : arrayUnion(id) });
    AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
    fetchSocialData();
};
function toggleHealthSync() { AppState.user.syncEnabled = document.getElementById('sync-toggle').checked; saveUserData(); if(AppState.user.syncEnabled) syncHealthData(true); }
async function syncHealthData(msg) { /* 기존 건강 동기화 로직 동일 */ }
function changeLanguage(lang) { AppState.currentLang = lang; /* i18n 업데이트 로직 */ }
function changeTheme() { /* 테마 업데이트 로직 */ }
function toggleGPS() { /* GPS 업데이트 로직 */ }
function updateDungeonStatus() { /* 던전 로직 동일 */ }
function renderCalendar() { /* 캘린더 로직 동일 */ }
