// --- Firebase SDK 초기화 및 모듈 임포트 ---
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

// --- 앱 상태 관리 객체 ---
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
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    
    document.querySelectorAll('.nav-item').forEach(el => { el.addEventListener('click', () => switchTab(el.dataset.tab, el)); });

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
    
    // 소셜 탭 모드 및 랭킹 정렬 이벤트
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);
}

// --- DB 로직 ---
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

// --- 로그인 ---
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

function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart(); renderUsers(AppState.social.sortCriteria); renderQuestList(); updatePointUI(); updateDungeonStatus();
        loadPlayerName();
    }
}

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

function loadPlayerName() { document.getElementById('prof-name').textContent = AppState.user.name; }
function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt);
    if (newName?.trim()) {
        AppState.user.name = newName.trim();
        document.getElementById('prof-name').textContent = AppState.user.name;
        saveUserData(); fetchSocialData();
    }
}
function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt, AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', '');
        saveUserData(); alert(i18n[AppState.currentLang].insta_success); fetchSocialData();
    }
}

function changeTheme() {
    const isLight = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : '');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// --- 모달 로직 ---
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
    statKeys.forEach(k => { html += `<tr><td style="text-align:center"><b>${i18n[AppState.currentLang][k]}</b></td><td style="word-break:keep-all">${i18n[AppState.currentLang]['desc_'+k]}</td></tr>`; });
    body.innerHTML = html + `</tbody></table>`; document.getElementById('infoModal').classList.remove('d-none');
}
function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = "전체 퀘스트 가이드";
    const body = document.getElementById('info-modal-body');
    const dayNames = ["일","월","화","수","목","금","토"];
    let html = `<table class="info-table"><thead><tr><th>요일</th><th>스탯</th><th>미션</th></tr></thead><tbody>`;
    weeklyQuestData.forEach((day, i) => { day.forEach((q, j) => { html += `<tr>${j===0 ? `<td rowspan="12" style="text-align:center"><b>${dayNames[i]}</b></td>` : ''}<td>${q.stat}</td><td>${q.title.ko}</td></tr>`; }); });
    body.innerHTML = html + `</tbody></table>`; document.getElementById('infoModal').classList.remove('d-none');
}
function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = "이상 현상 DB";
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>분류</th><th>현상</th></tr></thead><tbody>`;
    Object.keys(raidMissions).forEach(k => { html += `<tr><td>${raidMissions[k].stat}</td><td style="word-break:keep-all">${raidMissions[k].title.ko}</td></tr>`; });
    body.innerHTML = html + `</tbody></table>`; document.getElementById('infoModal').classList.remove('d-none');
}

// --- 게임/레벨업 로직 ---
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
    saveUserData(); updatePointUI(); drawRadarChart(); renderUsers(AppState.social.sortCriteria);
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

// --- 퀘스트 로직 ---
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

// --- 던전 로직 ---
function updateDungeonStatus() {
    const now = new Date(); const h = now.getHours(); const slot = h < 8 ? 1 : h < 14 ? 2 : h < 22 ? 3 : 0;
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
        banner.innerHTML = `<h3 style="color:var(--text-sub);">${i18n[AppState.currentLang].raid_waiting}</h3>`;
    } else {
        const m = raidMissions[AppState.dungeon.targetStat];
        if (!AppState.dungeon.isJoined) {
            board.style.display = 'none'; banner.style.display = 'block';
            banner.innerHTML = `<h3 style="color:${m.color};">${seoulStations[AppState.dungeon.stationIdx].name.ko} - ${m.title.ko}</h3><button onclick="joinDungeon()" class="btn-primary">입장하기</button>`;
        } else {
            banner.style.display = 'none'; board.style.display = 'block';
            document.getElementById('raid-part-count').innerText = AppState.dungeon.participants;
            document.getElementById('raid-progress-bar').style.width = `${AppState.dungeon.progress}%`;
            document.getElementById('raid-progress-text').innerText = `${AppState.dungeon.progress}%`;
            const btnAction = document.getElementById('btn-raid-action');
            if (AppState.dungeon.progress >= 100) { btnAction.classList.add('d-none'); document.getElementById('btn-raid-complete').classList.remove('d-none'); 
            } else { btnAction.onclick = simulateRaidAction; }
        }
    }
}
window.joinDungeon = () => { AppState.dungeon.isJoined = true; AppState.dungeon.participants++; AppState.dungeon.progress = 30; saveUserData(); renderDungeon(); };
document.getElementById('btn-raid-action').onclick = () => { AppState.dungeon.progress = Math.min(100, AppState.dungeon.progress + 10); saveUserData(); renderDungeon(); };

// --- 소셜 시스템 (undefined 에러 해결 및 SVG 통일) ---
async function fetchSocialData() {
    try {
        const snap = await getDocs(collection(db, "users"));
        let players = [];
        
        snap.forEach((docSnap) => {
            const data = docSnap.data(); 
            const uid = docSnap.id;
            
            // 칭호 에러 방지 (방어 코드)
            let userTitle = "각성자";
            if (data.titleHistoryStr) {
                try {
                    const parsedHist = JSON.parse(data.titleHistoryStr);
                    if (parsedHist.length > 0) {
                        const lastTitle = parsedHist[parsedHist.length - 1].title;
                        userTitle = typeof lastTitle === 'object' ? lastTitle[AppState.currentLang] || lastTitle.ko : lastTitle;
                    }
                } catch(e) {}
            }

            players.push({
                id: uid, 
                name: data.name || "신규 헌터", 
                title: userTitle,
                str: Number(data.stats?.str) || 0, 
                int: Number(data.stats?.int) || 0, 
                cha: Number(data.stats?.cha) || 0, 
                vit: Number(data.stats?.vit) || 0, 
                wlth: Number(data.stats?.wlth) || 0, 
                agi: Number(data.stats?.agi) || 0,
                photoURL: data.photoURL || null, 
                isMe: auth.currentUser && auth.currentUser.uid === uid,
                isFriend: AppState.user.friends.includes(uid),
                instaId: data.instaId || ""
            });
        });
        
        AppState.social.users = players; 
        renderUsers(AppState.social.sortCriteria);
    } catch(e) { console.error("소셜 데이터 로드 에러:", e); }
}

function toggleSocialMode(mode, btn) { 
    AppState.social.mode = mode; 
    document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); 
    btn.classList.add('active'); 
    
    // 글로벌/친구 탭 이동 시에도 현재 선택된 랭킹 정렬 기준을 유지하여 렌더링
    renderUsers(AppState.social.sortCriteria); 
}

function renderUsers(criteria, btn = null) {
    if(btn) { 
        AppState.social.sortCriteria = criteria; 
        document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); 
        btn.classList.add('active'); 
    }
    
    const container = document.getElementById('user-list-container');
    if(!auth.currentUser) return;
    
    // total(종합스코어) 계산 및 에러 방지
    let dUsers = AppState.social.users.map(u => {
        u.total = u.str + u.int + u.cha + u.vit + u.wlth + u.agi;
        return u;
    });
    
    // 친구 필터링
    if(AppState.social.mode === 'friends') dUsers = dUsers.filter(u => u.isFriend);
    
    // 선택된 기준으로 내림차순 정렬
    dUsers.sort((a, b) => b[criteria] - a[criteria]);
    
    if(dUsers.length === 0) { 
        container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub);">검색된 유저가 없습니다.</div>`; 
        return; 
    }
    
    // 상태창과 동일한 인스타그램 공식 SVG 아이콘
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: var(--text-sub);"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;
    
    let htmlStr = '';
    dUsers.forEach((user, i) => {
        const rDisp = AppState.social.mode === 'global' ? `<div style="font-size:1.1rem; font-weight:bold; color:var(--text-sub); width:25px; text-align:center;">${i+1}</div>` : '';
        const fBtn = !user.isMe ? `<button class="btn-friend ${user.isFriend ? 'added' : ''}" data-id="${user.id}">${user.isFriend ? '친구 ✓' : '추가'}</button>` : '';
        const profileImg = user.photoURL ? `<img src="${user.photoURL}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);">` : `<div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`;
        
        // 인스타그램 링크가 있는 유저만 아이콘 노출
        const instaBtn = user.instaId 
            ? `<button onclick="window.open('https://instagram.com/${user.instaId}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex; align-items:center; vertical-align:middle;">${instaSvg}</button>`
            : '';
            
        // undefined 해결된 완벽한 UI 출력
        htmlStr += `
            <div class="user-card ${user.isMe ? 'my-rank' : ''}">
                ${rDisp}
                <div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">
                    ${profileImg}
                    <div class="user-info" style="margin-left:0;">
                        <div class="title-badge">${user.title}</div>
                        <div style="font-size:0.95rem; display:flex; align-items:center;">${user.name} ${instaBtn}</div>
                    </div>
                </div>
                <div class="user-score">${user[criteria]}</div>
                ${fBtn}
            </div>
        `;
    });
    
    container.innerHTML = htmlStr;
    
    // 친구 추가 이벤트 바인딩
    document.querySelectorAll('.btn-friend').forEach(btn => { 
        btn.addEventListener('click', () => toggleFriend(btn.dataset.id)); 
    });
}

window.toggleFriend = async (id) => {
    const myRef = doc(db, "users", auth.currentUser.uid);
    const isFriend = AppState.user.friends.includes(id);
    await updateDoc(myRef, { friends: isFriend ? arrayRemove(id) : arrayUnion(id) });
    AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
    fetchSocialData();
};

function toggleGPS() { /* 생략 */ }
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
        let steps = 0;
        if (data.bucket && data.bucket[0]?.dataset[0]?.point[0]) steps = data.bucket[0].dataset[0].point[0].value[0].intVal;
        const unrewarded = steps - AppState.user.stepData.rewardedSteps;
        if (unrewarded >= 1000) {
            const chunks = Math.floor(unrewarded / 1000);
            AppState.user.points += chunks * 10;
            AppState.user.pendingStats.str += chunks * 0.5;
            AppState.user.stepData = { date: now.toDateString(), rewardedSteps: AppState.user.stepData.rewardedSteps + (chunks * 1000) };
            updatePointUI(); drawRadarChart(); saveUserData();
            if(showMsg) alert(`동기화 성공! +${chunks*10}P 획득`);
        }
    } catch(e) { console.error("동기화 실패", e); }
}
