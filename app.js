// --- Firebase SDK 및 필수 모듈 임포트 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- Firebase 환경 설정 ---
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

// 구글 로그인 공급자 설정 (구글 피트니스 권한 포함)
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/fitness.activity.read');
googleProvider.setCustomParameters({ prompt: 'select_account' });

// --- 앱 통합 상태 관리 객체 ---
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
            location: null,
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

// --- 앱 초기화 및 이벤트 바인딩 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindEvents();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadUserDataFromDB(user); 
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            
            // 상태창 스크롤 잠금 (가독성 유지)
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
            document.getElementById('app-container').classList.remove('d-flex');
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
    // 인증 관련
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    
    // 네비게이션
    document.querySelectorAll('.nav-item').forEach(el => { 
        el.addEventListener('click', () => switchTab(el.dataset.tab, el)); 
    });

    // 프로필 편집 (이름, 인스타, 사진)
    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 
    
    // 모달 제어
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-status-info').addEventListener('click', openStatusInfoModal);
    document.getElementById('btn-quest-info').addEventListener('click', openQuestInfoModal);
    document.getElementById('btn-dungeon-info').addEventListener('click', openDungeonInfoModal);
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    // 기능 버튼
    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    // 설정
    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);
}

// --- DB 통신 로직 (저장/불러오기) ---
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
            location: AppState.user.location || null,
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
            if(data.titleHistoryStr) AppState.user.titleHistory = JSON.parse(data.titleHistoryStr);
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

// --- 로그인/로그아웃 시스템 ---
async function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const btn = document.getElementById('btn-login-submit');
    if(!email || !pw) { alert(i18n[AppState.currentLang].login_err_empty); return; }
    btn.innerText = "Processing..."; btn.disabled = true;
    try {
        if(!AppState.isLoginMode) { 
            const pwConfirm = document.getElementById('login-pw-confirm').value;
            if(pw !== pwConfirm) throw new Error("비밀번호 불일치");
            await createUserWithEmailAndPassword(auth, email, pw);
        } else { await signInWithEmailAndPassword(auth, email, pw); }
    } catch (e) { alert("인증 오류: " + e.message); } 
    finally { btn.innerText = AppState.isLoginMode ? "시스템 접속" : "회원가입"; btn.disabled = false; }
}

async function simulateGoogleLogin() { 
    try { 
        const result = await signInWithPopup(auth, googleProvider); 
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) { localStorage.setItem('gfit_token', credential.accessToken); }
    } catch(e) { 
        console.error(e); 
        if(e.code === 'auth/popup-blocked') alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.");
        else alert("Google 로그인 실패: " + e.message);
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

// --- UI 제어 및 탭 전환 ---
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
    if (AppState.user.syncEnabled && tabId === 'status') syncHealthData(false);
}

// --- 프로필 관리 ---
function loadPlayerName() { document.getElementById('prof-name').textContent = AppState.user.name; }
function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt);
    if (newName?.trim()) {
        AppState.user.name = newName.trim();
        document.getElementById('prof-name').textContent = AppState.user.name;
        saveUserData();
    }
}
function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt, AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', '');
        saveUserData();
        alert(i18n[AppState.currentLang].insta_success);
    }
}

async function loadProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = async function() {
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

// --- 가이드 모달 생성 로직 ---
function closeInfoModal() { document.getElementById('infoModal').classList.add('d-none'); }
function closeTitleModal() { document.getElementById('titleModal').classList.add('d-none'); }
function openTitleModal() {
    const container = document.getElementById('history-list-container');
    container.innerHTML = [...AppState.user.titleHistory].reverse().map(h => `
        <div class="history-item"><span class="hist-lvl">Lv. ${h.level}</span><span class="hist-title">${h.title[AppState.currentLang]}</span></div>
    `).join('');
    document.getElementById('titleModal').classList.remove('d-none');
}

function openStatusInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_status_title;
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>스탯</th><th>설명</th></tr></thead><tbody>`;
    statKeys.forEach(k => {
        html += `<tr><td style="text-align:center"><b>${i18n[AppState.currentLang][k]}</b></td><td style="word-break:keep-all">${i18n[AppState.currentLang]['desc_'+k]}</td></tr>`;
    });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = "전체 퀘스트 가이드";
    const body = document.getElementById('info-modal-body');
    const dayNames = ["일","월","화","수","목","금","토"];
    let html = `<table class="info-table"><thead><tr><th>요일</th><th>스탯</th><th>미션</th></tr></thead><tbody>`;
    weeklyQuestData.forEach((day, i) => {
        day.forEach((q, j) => {
            html += `<tr>${j===0 ? `<td rowspan="12" style="text-align:center"><b>${dayNames[i]}</b></td>` : ''}<td>${q.stat}</td><td>${q.title.ko}</td></tr>`;
        });
    });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = "이상 현상 DB";
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>분류</th><th>현상</th></tr></thead><tbody>`;
    Object.keys(raidMissions).forEach(k => {
        html += `<tr><td>${raidMissions[k].stat}</td><td style="word-break:keep-all">${raidMissions[k].title.ko}</td></tr>`;
    });
    body.innerHTML = html + `</tbody></table>`;
    document.getElementById('infoModal').classList.remove('d-none');
}

// --- 게임 로직 (레벨업, 레이더, 던전) ---
function getReqPoints(level) { return Math.floor(100 * Math.pow(1.5, level - 1)); }
function processLevelUp() {
    const req = getReqPoints(AppState.user.level);
    if(AppState.user.points < req) return;
    AppState.user.points -= req; AppState.user.level++;
    statKeys.forEach(k => { AppState.user.stats[k] = Math.min(100, AppState.user.stats[k] + AppState.user.pendingStats[k]); AppState.user.pendingStats[k] = 0; });
    const top = statKeys.map(k => ({k, v:AppState.user.stats[k]})).sort((a,b) => b.v - a.v);
    const newTitle = { 
        ko: `${titleVocab[top[0].k].ko.pre[0]} ${titleVocab[top[1].k].ko.suf[0]}`,
        en: `${titleVocab[top[0].k].en.pre[0]} ${titleVocab[top[1].k].en.suf[0]}`
    };
    AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitle });
    saveUserData(); updatePointUI(); drawRadarChart();
    alert("Level Up!");
}

function updatePointUI() {
    const req = getReqPoints(AppState.user.level);
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    statKeys.forEach(k => {
        const p = AppState.user.pendingStats[k];
        document.getElementById(`pendVal_${k}`).innerText = p > 0 ? `(+${p.toFixed(1)})` : "";
    });
}

function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33;
    const angles = statKeys.map((_, i) => -Math.PI/2 + (i * Math.PI/3));
    let points = "";
    statKeys.forEach((k, i) => {
        const val = AppState.user.stats[k];
        const r = radius * (val / 100);
        const x = centerX + r * Math.cos(angles[i]);
        const y = centerY + r * Math.sin(angles[i]);
        points += `${x},${y} `;
        document.getElementById(`barVal_${k}`).innerText = val;
        document.getElementById(`barFill_${k}`).style.width = `${val}%`;
    });
    document.getElementById('playerPolygon').setAttribute('points', points.trim());
    document.getElementById('totalScore').innerText = statKeys.reduce((s,k) => s + AppState.user.stats[k], 0);
}

// --- 퀘스트 및 캘린더 시스템 ---
function renderQuestList() {
    const day = AppState.quest.currentDayOfWeek;
    document.getElementById('quest-list-container').innerHTML = weeklyQuestData[day].map((q, i) => `
        <div class="quest-row ${AppState.quest.completedState[day][i] ? 'done' : ''}" onclick="toggleQuest(${i})">
            <div><div class="quest-title"><span class="quest-stat-tag">${q.stat}</span>${q.title[AppState.currentLang]}</div>
            <div class="quest-desc">${q.desc[AppState.currentLang]}</div></div><div class="quest-checkbox"></div>
        </div>
    `).join('');
}
window.toggleQuest = (i) => {
    const day = AppState.quest.currentDayOfWeek;
    const state = AppState.quest.completedState[day];
    state[i] = !state[i];
    const q = weeklyQuestData[day][i];
    const factor = state[i] ? 1 : -1;
    AppState.user.points += (20 * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (0.5 * factor);
    saveUserData(); renderQuestList(); renderCalendar(); updatePointUI();
};

function renderCalendar() {
    const today = new Date();
    document.getElementById('cal-month').innerText = today.toDateString().split(' ')[1];
    document.getElementById('calendar-grid').innerHTML = AppState.quest.completedState.map((s, i) => `
        <div class="cal-day ${i === AppState.quest.currentDayOfWeek ? 'today' : ''}">
            <div class="cal-date">${s.filter(v=>v).length}/12</div>
        </div>
    `).join('');
}

// --- 던전 레이드 시스템 ---
function updateDungeonStatus() {
    const now = new Date();
    const h = now.getHours();
    const slot = h < 8 ? 1 : h < 14 ? 2 : h < 22 ? 3 : 0;
    const dateStr = now.toDateString();
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== slot) {
        AppState.dungeon = { lastGeneratedDate: dateStr, slot: slot, stationIdx: Math.floor(Math.random()*5), participants: Math.floor(Math.random()*91)+10, isJoined: false, progress: 0, targetStat: statKeys[Math.floor(Math.random()*6)] };
        saveUserData();
    }
    renderDungeon();
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner');
    const board = document.getElementById('dungeon-active-board');
    if (AppState.dungeon.slot === 0) {
        board.style.display = 'none'; banner.style.display = 'block';
        banner.innerHTML = `<h3>던전 출현 대기 중...</h3>`;
    } else {
        const m = raidMissions[AppState.dungeon.targetStat];
        if (!AppState.dungeon.isJoined) {
            board.style.display = 'none'; banner.style.display = 'block';
            banner.innerHTML = `<h3>${seoulStations[AppState.dungeon.stationIdx].name.ko} - ${m.title.ko}</h3><button onclick="joinDungeon()" class="btn-primary">입장하기</button>`;
        } else {
            banner.style.display = 'none'; board.style.display = 'block';
            document.getElementById('raid-part-count').innerText = AppState.dungeon.participants;
            document.getElementById('raid-progress-bar').style.width = `${AppState.dungeon.progress}%`;
            document.getElementById('raid-progress-text').innerText = `${AppState.dungeon.progress}%`;
        }
    }
}
window.joinDungeon = () => { AppState.dungeon.isJoined = true; AppState.dungeon.participants++; AppState.dungeon.progress = 30; saveUserData(); renderDungeon(); };
document.getElementById('btn-raid-action').onclick = () => {
    AppState.dungeon.progress = Math.min(100, AppState.dungeon.progress + 10);
    saveUserData(); renderDungeon();
    if(AppState.dungeon.progress === 100) { document.getElementById('btn-raid-complete').classList.remove('d-none'); }
};

// --- 소셜 시스템 ---
async function fetchSocialData() {
    const snap = await getDocs(collection(db, "users"));
    AppState.social.users = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, isFriend: AppState.user.friends.includes(d.id), isMe: auth.currentUser?.uid === d.id };
    });
    renderUsers(AppState.social.sortCriteria);
}

function renderUsers(criteria) {
    const container = document.getElementById('user-list-container');
    const list = AppState.social.users.map(u => ({...u, total: Object.values(u.stats || {}).reduce((a,b)=>a+b, 0)}))
        .filter(u => AppState.social.mode === 'global' || u.isFriend)
        .sort((a,b) => b[criteria] - a[criteria]);
    
    container.innerHTML = list.map((u, i) => `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}">
            <div style="width:25px">${i+1}</div>
            <div class="user-info">${u.name} ${u.instaId ? `<span class="social-insta-btn" onclick="window.open('https://instagram.com/${u.instaId}', '_blank')">📸</span>` : ''}</div>
            <div class="user-score">${u[criteria]}</div>
            ${!u.isMe ? `<button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="toggleFriend('${u.id}')">${u.isFriend ? '친구✓' : '추가'}</button>` : ''}
        </div>
    `).join('');
}
window.toggleFriend = async (id) => {
    const myRef = doc(db, "users", auth.currentUser.uid);
    const isFriend = AppState.user.friends.includes(id);
    await updateDoc(myRef, { friends: isFriend ? arrayRemove(id) : arrayUnion(id) });
    AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
    fetchSocialData();
};

// --- 건강 데이터 동기화 (구글 피트니스) ---
async function toggleHealthSync() {
    AppState.user.syncEnabled = document.getElementById('sync-toggle').checked;
    saveUserData();
    if (AppState.user.syncEnabled) syncHealthData(true);
}

async function syncHealthData(showMsg) {
    const token = localStorage.getItem('gfit_token');
    if (!token) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    try {
        const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aggregateBy: [{ dataTypeName: 'com.google.step_count.delta', dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps' }],
                bucketByTime: { durationMillis: 86400000 }, 
                startTimeMillis: start, endTimeMillis: now.getTime()
            })
        });
        const data = await res.json();
        const steps = data.bucket[0]?.dataset[0]?.point[0]?.value[0]?.intVal || 0;
        const diff = steps - AppState.user.stepData.rewardedSteps;
        if (diff >= 1000) {
            const chunks = Math.floor(diff / 1000);
            AppState.user.points += chunks * 10;
            AppState.user.pendingStats.str += chunks * 0.5;
            AppState.user.stepData = { date: now.toDateString(), rewardedSteps: AppState.user.stepData.rewardedSteps + (chunks * 1000) };
            updatePointUI(); drawRadarChart(); saveUserData();
            if(showMsg) alert(`동기화 성공! +${chunks*10}P 획득`);
        }
    } catch(e) { console.error("동기화 실패", e); }
}

function changeLanguage(lang) { AppState.currentLang = lang; } // 단순화
function changeTheme() { 
    const light = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', light ? 'light' : '');
    localStorage.setItem('theme', light ? 'light' : 'dark');
}
function toggleGPS() { /* 위치 정보 로직 생략 */ }
