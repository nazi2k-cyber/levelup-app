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
            // ★ 추가됨: 인스타그램 ID 필드 ★
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
            
            if (AppState.user.syncEnabled) {
                syncHealthData(false); 
            }

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
    // ★ 추가됨: 인스타그램 수정 버튼 이벤트 ★
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 

    document.getElementById('btn-status-info').addEventListener('click', openStatusInfoModal);
    document.getElementById('btn-quest-info').addEventListener('click', openQuestInfoModal);
    document.getElementById('btn-dungeon-info').addEventListener('click', openDungeonInfoModal);
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);
}

async function saveUserData() {
    localStorage.setItem('userData', JSON.stringify(AppState.user));
    
    if(auth.currentUser) {
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
                // ★ 인스타그램 ID 서버 저장 ★
                instaId: AppState.user.instaId || "" 
            }, { merge: true });
        } catch(e) { console.error("클라우드 저장 실패:", e); }
    }
}

async function loadUserDataFromDB(user) {
    try {
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            if(data.stats) AppState.user.stats = data.stats;
            if(data.level) AppState.user.level = data.level;
            if(data.points) AppState.user.points = data.points;
            
            if(data.titleHistoryStr) AppState.user.titleHistory = JSON.parse(data.titleHistoryStr);
            if(data.questStr) AppState.quest.completedState = JSON.parse(data.questStr);
            if(data.dungeonStr) AppState.dungeon = JSON.parse(data.dungeonStr);
            
            if(data.friends) AppState.user.friends = data.friends;
            if(data.location) AppState.user.location = data.location;
            if(data.syncEnabled !== undefined) AppState.user.syncEnabled = data.syncEnabled;
            if(data.stepData !== undefined) AppState.user.stepData = data.stepData;
            document.getElementById('sync-toggle').checked = AppState.user.syncEnabled;
            
            // ★ 인스타그램 ID 불러오기 ★
            if(data.instaId !== undefined) AppState.user.instaId = data.instaId;

            if(data.name) { AppState.user.name = data.name; } 
            else { AppState.user.name = user.displayName || "신규 헌터"; }

            if(data.photoURL) {
                AppState.user.photoURL = data.photoURL;
                document.getElementById('profilePreview').src = data.photoURL;
            }
        } else {
            AppState = getInitialAppState(); 
            if (user.displayName) AppState.user.name = user.displayName;
        }
        
        loadPlayerName();
        await saveUserData(); 
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
            const MAX_WIDTH = 150; const MAX_HEIGHT = 150;
            let width = img.width; let height = img.height;
            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6); 
            document.getElementById('profilePreview').src = compressedBase64;
            AppState.user.photoURL = compressedBase64;
            await saveUserData();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const pwConfirm = document.getElementById('login-pw-confirm').value;
    if(!email || !pw) { alert(i18n[AppState.currentLang].login_err_empty); return; }
    const btn = document.getElementById('btn-login-submit');
    btn.innerText = "처리 중..."; btn.disabled = true;
    try {
        if(!AppState.isLoginMode) { 
            if(pw !== pwConfirm) { alert(i18n[AppState.currentLang].pw_mismatch); throw new Error("비밀번호 불일치"); }
            await createUserWithEmailAndPassword(auth, email, pw);
        } else { await signInWithEmailAndPassword(auth, email, pw); }
    } catch (error) { console.error(error); alert("인증 오류: " + error.message);
    } finally { btn.innerText = AppState.isLoginMode ? i18n[AppState.currentLang].btn_login_submit : i18n[AppState.currentLang].btn_signup_submit; btn.disabled = false; }
}

async function simulateGoogleLogin() { 
    try { 
        const result = await signInWithPopup(auth, googleProvider); 
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential && credential.accessToken) { localStorage.setItem('gfit_token', credential.accessToken); }
    } catch(e) { console.error(e); alert("Google 로그인 오류:\n" + e.message); }
}

async function logout() { try { await fbSignOut(auth); localStorage.clear(); window.location.reload(); } catch(e) { console.error("로그아웃 오류:", e); } }

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    if(AppState.isLoginMode) {
        btnSubmit.setAttribute('data-i18n', 'btn_login_submit'); toggleText.setAttribute('data-i18n', 'auth_toggle_signup');
        document.getElementById('login-pw-confirm').classList.add('d-none');
    } else {
        btnSubmit.setAttribute('data-i18n', 'btn_signup_submit'); toggleText.setAttribute('data-i18n', 'auth_toggle_login');
        document.getElementById('login-pw-confirm').classList.remove('d-none');
    }
    changeLanguage(AppState.currentLang); 
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
    if(tabId === 'status') { mainEl.style.overflowY = 'hidden'; drawRadarChart(); updatePointUI(); 
    } else { mainEl.style.overflowY = 'auto'; }
    if(tabId === 'social') { fetchSocialData(); } 
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); }
    if(tabId === 'dungeon') { updateDungeonStatus(); }
    if (AppState.user.syncEnabled && tabId === 'status') { syncHealthData(false); }
}

function loadPlayerName() { document.getElementById('prof-name').textContent = AppState.user.name; }

function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt);
    if (newName && newName.trim() !== "") {
        AppState.user.name = newName.trim(); 
        document.getElementById('prof-name').textContent = AppState.user.name;
        saveUserData(); renderUsers(AppState.social.sortCriteria);
    }
}

// ★ 추가됨: 인스타그램 ID 변경 및 저장 로직 ★
function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt, AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', ''); // @ 포함 시 제거
        saveUserData();
        alert(i18n[AppState.currentLang].insta_success);
        fetchSocialData(); // 소셜 리스트 갱신
    }
}

function openTitleModal() { renderHistoryModal(); document.getElementById('titleModal').classList.remove('d-none'); document.getElementById('titleModal').classList.add('d-flex'); }
function closeTitleModal() { document.getElementById('titleModal').classList.remove('d-flex'); document.getElementById('titleModal').classList.add('d-none'); }
function renderHistoryModal() {
    const container = document.getElementById('history-list-container'); container.innerHTML = '';
    [...AppState.user.titleHistory].reverse().forEach(hist => {
        container.innerHTML += `<div class="history-item"><span class="hist-lvl">Lv. ${hist.level}</span><span class="hist-title">${hist.title[AppState.currentLang]}</span></div>`;
    });
}

function closeInfoModal() { document.getElementById('infoModal').classList.remove('d-flex'); document.getElementById('infoModal').classList.add('d-none'); }

function openStatusInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_status_title;
    const body = document.getElementById('info-modal-body');
    let tableHtml = `<table class="info-table"><thead><tr><th>${i18n[AppState.currentLang].th_stat}</th><th>${i18n[AppState.currentLang].th_desc}</th></tr></thead><tbody>`;
    ['str', 'int', 'cha', 'vit', 'wlth', 'agi'].forEach(stat => {
        tableHtml += `<tr><td style="text-align:center;"><span class="quest-stat-tag">${stat.toUpperCase()}</span><br><b>${i18n[AppState.currentLang][stat]}</b></td><td>${i18n[AppState.currentLang]['desc_'+stat]}</td></tr>`;
    });
    tableHtml += `</tbody></table>`; body.innerHTML = tableHtml;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_quest_title;
    const body = document.getElementById('info-modal-body');
    let tableHtml = `<table class="info-table"><thead><tr><th>요일</th><th>스탯</th><th>퀘스트</th></tr></thead><tbody>`;
    weeklyQuestData.forEach((dayQuests, dayIdx) => {
        dayQuests.forEach((q, idx) => {
            let rowSpan = idx === 0 ? `rowspan="${dayQuests.length}"` : '';
            tableHtml += `<tr>${idx === 0 ? `<td ${rowSpan}>${dayIdx}</td>` : ''}<td>${q.stat}</td><td>${q.title[AppState.currentLang]}</td></tr>`;
        });
    });
    tableHtml += `</tbody></table>`; body.innerHTML = tableHtml;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_dungeon_title;
    const body = document.getElementById('info-modal-body');
    let tableHtml = `<table class="info-table"><thead><tr><th>스탯</th><th>이상현상</th></tr></thead><tbody>`;
    Object.keys(raidMissions).forEach(key => {
        const m = raidMissions[key];
        tableHtml += `<tr><td>${m.stat}</td><td>${m.title[AppState.currentLang]}</td></tr>`;
    });
    tableHtml += `</tbody></table>`; body.innerHTML = tableHtml;
    document.getElementById('infoModal').classList.remove('d-none'); document.getElementById('infoModal').classList.add('d-flex');
}

function getReqPoints(level) { return Math.floor(100 * Math.pow(1.5, level - 1)); }

function processLevelUp() {
    const reqPts = getReqPoints(AppState.user.level);
    if(AppState.user.points >= reqPts) {
        AppState.user.points -= reqPts; AppState.user.level++;
        statKeys.forEach(k => { AppState.user.stats[k] = Math.min(100, AppState.user.stats[k] + AppState.user.pendingStats[k]); AppState.user.pendingStats[k] = 0; });
        let sortedStats = statKeys.map(k => ({ key: k, val: AppState.user.stats[k] })).sort((a, b) => b.val - a.val);
        const top1 = sortedStats[0].key; const top2 = sortedStats[1].key; 
        const randPre = Math.floor(Math.random() * 3); const randSuf = Math.floor(Math.random() * 3);
        const newTitleObj = { ko: `${titleVocab[top1].ko.pre[randPre]} ${titleVocab[top2].ko.suf[randSuf]}`, en: `${titleVocab[top1].en.pre[randPre]} ${titleVocab[top2].en.suf[randSuf]}`, ja: `${titleVocab[top1].ja.pre[randPre]} ${titleVocab[top2].ja.suf[randSuf]}` };
        AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitleObj });
        saveUserData(); updatePointUI(); drawRadarChart(); renderUsers(AppState.social.sortCriteria);
        alert(`Level Up! [Lv.${AppState.user.level}]\n새로운 칭호 획득: ${newTitleObj[AppState.currentLang]}`);
    }
}

function updatePointUI() {
    const reqPts = getReqPoints(AppState.user.level);
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = reqPts;
    const btn = document.getElementById('btn-levelup');
    if(AppState.user.points >= reqPts) { btn.disabled = false; btn.style.background = "var(--neon-gold)"; btn.style.color = "black"; } 
    else { btn.disabled = true; btn.style.background = "#444"; btn.style.color = "#777"; }
    document.getElementById('prof-title-badge').innerText = AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title[AppState.currentLang];
    statKeys.forEach(k => {
        const pendEl = document.getElementById(`pendVal_${k}`); const pVal = AppState.user.pendingStats[k];
        if (pVal > 0) pendEl.textContent = `(+${pVal.toFixed(1).replace('.0', '')})`; else pendEl.textContent = "";
    });
}

function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33; 
    const angles = []; for(let i=0; i<6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));
    const gridGroup = document.getElementById('radarGrid'); const axesGroup = document.getElementById('radarAxes');
    if(gridGroup.innerHTML === '') { 
        let gridHtml = ''; let axesHtml = '';
        for (let level = 1; level <= 5; level++) {
            const r = radius * (level / 5); let points = "";
            for (let i = 0; i < 6; i++) points += `${centerX + r * Math.cos(angles[i])},${centerY + r * Math.sin(angles[i])} `;
            gridHtml += `<polygon points="${points.trim()}" class="radar-bg-line"></polygon>`;
        }
        for (let i = 0; i < 6; i++) axesHtml += `<line x1="50" y1="50" x2="${centerX + radius * Math.cos(angles[i])}" y2="${centerY + radius * Math.sin(angles[i])}" class="radar-bg-line"></line>`;
        gridGroup.innerHTML = gridHtml; axesGroup.innerHTML = axesHtml;
    }
    const pointsGroup = document.getElementById('radarPoints'); const labelsGroup = document.getElementById('radarLabels');
    let pointsHtml = ''; let labelsHtml = ''; let dataPoints = ""; let totalSum = 0;
    for (let i = 0; i < 6; i++) {
        const key = statKeys[i]; const val = AppState.user.stats[key]; totalSum += val;
        const r = radius * (val / 100); const x = centerX + r * Math.cos(angles[i]); const y = centerY + r * Math.sin(angles[i]);
        dataPoints += `${x},${y} `; pointsHtml += `<circle cx="${x}" cy="${y}" r="1.2" class="radar-point"></circle>`;
        const labelRadius = radius + 9; const lx = centerX + labelRadius * Math.cos(angles[i]); const ly = centerY + labelRadius * Math.sin(angles[i]) + 2; 
        let anchor = "middle"; if(i===1 || i===2) anchor = "start"; if(i===4 || i===5) anchor = "end";   
        labelsHtml += `<text x="${lx}" y="${ly - 3}" text-anchor="${anchor}" class="radar-label">${i18n[AppState.currentLang][key]}</text><text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" class="radar-value">${val}</text>`;
        const barFill = document.getElementById(`barFill_${key}`); if(barFill) setTimeout(() => { barFill.style.width = `${val}%`; }, 100);
        const barVal = document.getElementById(`barVal_${key}`); if(barVal) barVal.textContent = val;
    }
    pointsGroup.innerHTML = pointsHtml; labelsGroup.innerHTML = labelsHtml;
    const playerPolygon = document.getElementById('playerPolygon'); playerPolygon.setAttribute('points', dataPoints.trim());
    document.getElementById('totalScore').innerHTML = `${totalSum}`;
}

function renderQuestList() {
    const container = document.getElementById('quest-list-container'); const day = AppState.quest.currentDayOfWeek; let htmlStr = '';
    weeklyQuestData[day].forEach((q, idx) => {
        const isDone = AppState.quest.completedState[day][idx];
        htmlStr += `<div class="quest-row ${isDone ? 'done' : ''}" data-idx="${idx}"><div><div class="quest-title"><span class="quest-stat-tag">${q.stat}</span>${q.title[AppState.currentLang]}</div><div class="quest-desc">${q.desc[AppState.currentLang]}</div></div><div class="quest-checkbox"></div></div>`;
    });
    container.innerHTML = htmlStr;
    document.querySelectorAll('.quest-row').forEach(row => { row.addEventListener('click', () => toggleQuest(row.dataset.idx)); });
}

function toggleQuest(idx) {
    const day = AppState.quest.currentDayOfWeek; const state = AppState.quest.completedState[day]; const q = weeklyQuestData[day][idx];
    state[idx] = !state[idx];
    if(state[idx]) { AppState.user.points += 20; AppState.user.pendingStats[q.stat.toLowerCase()] += 0.5; } else { AppState.user.points -= 20; AppState.user.pendingStats[q.stat.toLowerCase()] -= 0.5; }
    saveUserData(); renderQuestList(); renderCalendar(); updatePointUI(); 
}

function renderCalendar() {
    const calGrid = document.getElementById('calendar-grid'); const today = new Date(); const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - AppState.quest.currentDayOfWeek);
    document.getElementById('cal-month').innerText = today.toDateString().split(' ')[1];
    let htmlStr = '';
    for (let i = 0; i < 7; i++) {
        const count = AppState.quest.completedState[i].filter(v => v).length;
        htmlStr += `<div class="cal-day ${i === AppState.quest.currentDayOfWeek ? 'today' : ''}"><div class="cal-date">${count}/12</div></div>`;
    }
    calGrid.innerHTML = htmlStr;
}

function updateDungeonStatus() {
    const now = new Date(); const h = now.getHours(); const timeVal = h + now.getMinutes() / 60;
    let currentSlot = 0;
    if (timeVal >= 6 && timeVal < 8) currentSlot = 1; else if (timeVal >= 11.5 && timeVal < 13.5) currentSlot = 2; else if (timeVal >= 19 && timeVal < 21) currentSlot = 3;
    const dateStr = now.toDateString(); 
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== currentSlot) {
        AppState.dungeon.lastGeneratedDate = dateStr; AppState.dungeon.slot = currentSlot;
        if (currentSlot > 0) { 
            AppState.dungeon.stationIdx = Math.floor(Math.random() * seoulStations.length); AppState.dungeon.participants = Math.floor(Math.random() * 91) + 10; 
            AppState.dungeon.isJoined = false; AppState.dungeon.isCleared = false; AppState.dungeon.progress = 0; 
            AppState.dungeon.targetStat = ['str', 'int', 'cha', 'vit', 'wlth', 'agi'][Math.floor(Math.random() * 6)];
        }
        saveUserData();
    }
    if (document.getElementById('dungeon').classList.contains('active')) renderDungeon();
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner'); const activeBoard = document.getElementById('dungeon-active-board'); 
    if (AppState.dungeon.slot === 0) {
        activeBoard.style.display = 'none'; banner.style.display = 'block'; banner.innerHTML = `<h3 style="color:var(--text-sub);">${i18n[AppState.currentLang].raid_waiting}</h3>`;
    } else {
        const mission = raidMissions[AppState.dungeon.targetStat]; const st = seoulStations[AppState.dungeon.stationIdx];
        if (!AppState.dungeon.isJoined) {
            activeBoard.style.display = 'none'; banner.style.display = 'block';
            banner.innerHTML = `<h3 style="color:${mission.color};">${st.name[AppState.currentLang]} - ${mission.title[AppState.currentLang]}</h3><button id="btn-raid-join" class="btn-primary">입장하기</button>`;
            document.getElementById('btn-raid-join').addEventListener('click', joinDungeon);
        } else {
            banner.style.display = 'none'; activeBoard.style.display = 'block';
            document.getElementById('raid-part-count').innerText = AppState.dungeon.participants;
            document.getElementById('raid-progress-bar').style.width = `${AppState.dungeon.progress}%`;
            document.getElementById('raid-progress-text').innerText = `${AppState.dungeon.progress}%`;
            const btnAction = document.getElementById('btn-raid-action');
            if (AppState.dungeon.progress >= 100) { btnAction.classList.add('d-none'); document.getElementById('btn-raid-complete').classList.remove('d-none'); 
            } else { btnAction.onclick = simulateRaidAction; }
        }
    }
}

function joinDungeon() { AppState.dungeon.isJoined = true; AppState.dungeon.participants++; AppState.dungeon.progress = 40; saveUserData(); renderDungeon(); }
function simulateRaidAction() { AppState.dungeon.progress = Math.min(100, AppState.dungeon.progress + 10); saveUserData(); renderDungeon(); }

async function fetchSocialData() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        let players = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data(); const uid = docSnap.id;
            let userTitle = { ko: "신규 각성자" };
            if (data.titleHistoryStr) { userTitle = JSON.parse(data.titleHistoryStr).pop().title; }
            players.push({
                id: uid, name: data.name || "신규 헌터", title: userTitle,
                str: data.stats?.str || 0, int: data.stats?.int || 0, cha: data.stats?.cha || 0, vit: data.stats?.vit || 0, wlth: data.stats?.wlth || 0, agi: data.stats?.agi || 0,
                photoURL: data.photoURL || null, isMe: auth.currentUser && auth.currentUser.uid === uid,
                isFriend: AppState.user.friends.includes(uid),
                // ★ 인스타그램 ID 데이터 포함 ★
                instaId: data.instaId || "" 
            });
        });
        AppState.social.users = players; renderUsers(AppState.social.sortCriteria);
    } catch(e) { console.error("소셜 로드 에러:", e); }
}

function toggleSocialMode(mode, btn) { AppState.social.mode = mode; document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderUsers(AppState.social.sortCriteria); }

function renderUsers(criteria, btn = null) {
    if(btn) { AppState.social.sortCriteria = criteria; document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    const container = document.getElementById('user-list-container');
    let dUsers = AppState.social.users.map(u => ({...u, total: u.str+u.int+u.cha+u.vit+u.wlth+u.agi}));
    if(AppState.social.mode === 'friends') dUsers = dUsers.filter(u => u.isFriend);
    dUsers.sort((a, b) => b[criteria] - a[criteria]);
    let htmlStr = '';
    dUsers.forEach((user, i) => {
        const rDisp = AppState.social.mode === 'global' ? `<div style="width:25px;">${i+1}</div>` : '';
        const fBtn = !user.isMe ? `<button class="btn-friend ${user.isFriend ? 'added' : ''}" data-id="${user.id}">${user.isFriend ? '친구 ✓' : '추가'}</button>` : '';
        const profileImg = user.photoURL ? `<img src="${user.photoURL}" style="width:30px;height:30px;border-radius:50%;">` : `👤`;
        
        // ★ 추가됨: 인스타그램 아이콘 노출 로직 (ID가 있는 경우에만 표시) ★
        const instaBtn = user.instaId ? `<span class="social-insta-btn" onclick="window.open('https://instagram.com/${user.instaId}', '_blank')">📸</span>` : '';
        
        htmlStr += `<div class="user-card ${user.isMe ? 'my-rank' : ''}">${rDisp}${profileImg} <div class="user-info">${user.title[AppState.currentLang] || user.title.ko}<br>${user.name} ${instaBtn}</div> <div class="user-score">${user[criteria]}</div> ${fBtn}</div>`;
    });
    container.innerHTML = htmlStr;
    document.querySelectorAll('.btn-friend').forEach(btn => btn.addEventListener('click', () => toggleFriend(btn.dataset.id)));
}

async function toggleFriend(targetUid) {
    const myRef = doc(db, "users", auth.currentUser.uid);
    if(AppState.user.friends.includes(targetUid)) { await updateDoc(myRef, { friends: arrayRemove(targetUid) }); AppState.user.friends = AppState.user.friends.filter(id => id !== targetUid);
    } else { await updateDoc(myRef, { friends: arrayUnion(targetUid) }); AppState.user.friends.push(targetUid); }
    fetchSocialData();
}

function toggleGPS() { /* 기존 로직 유지 */ }
function toggleHealthSync() { AppState.user.syncEnabled = document.getElementById('sync-toggle').checked; saveUserData(); if (AppState.user.syncEnabled) syncHealthData(true); }

async function syncHealthData(showStatusMsg = false) {
    if (!AppState.user.syncEnabled) return;
    const token = localStorage.getItem('gfit_token');
    if (!token) { AppState.user.syncEnabled = false; document.getElementById('sync-toggle').checked = false; return; }
    const now = new Date(); const todayStr = now.toDateString();
    if (!AppState.user.stepData || AppState.user.stepData.date !== todayStr) { AppState.user.stepData = { date: todayStr, rewardedSteps: 0 }; }
    try {
        const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ aggregateBy: [{ dataTypeName: 'com.google.step_count.delta', dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps' }], bucketByTime: { durationMillis: 86400000 }, startTimeMillis: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), endTimeMillis: now.getTime() }) });
        const data = await res.json(); let steps = 0;
        if (data.bucket && data.bucket[0]?.dataset[0]?.point[0]) steps = data.bucket[0].dataset[0].point[0].value[0].intVal;
        const unrewarded = steps - AppState.user.stepData.rewardedSteps;
        if (unrewarded >= 1000) {
            const chunks = Math.floor(unrewarded / 1000); AppState.user.points += chunks * 10; AppState.user.pendingStats.str += chunks * 0.5; AppState.user.stepData.rewardedSteps += chunks * 1000;
            updatePointUI(); drawRadarChart();
        }
        saveUserData();
    } catch (e) { console.error(e); }
}
