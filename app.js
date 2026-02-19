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

// --- 상태 관리 객체 (초기 상태 세팅) ---
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
            location: null 
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
            
            // ★ 수정됨: 앱 로그인 직후(상태창 뷰) 메인 화면 스크롤 잠금 ★
            document.querySelector('main').style.overflowY = 'hidden';
            
            changeLanguage(AppState.currentLang); 
            renderCalendar(); 
            updatePointUI(); 
            drawRadarChart(); 
            updateDungeonStatus();
            fetchSocialData(); 
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
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 

    // 모달(가이드 버튼) 이벤트 연결
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

// --- Firebase 데이터 저장 ---
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
                location: AppState.user.location || null 
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
            
            if(data.name) { AppState.user.name = data.name; } 
            else { AppState.user.name = user.displayName || "신규 헌터"; }

            if(data.photoURL) {
                AppState.user.photoURL = data.photoURL;
                document.getElementById('profilePreview').src = data.photoURL;
            } else {
                AppState.user.photoURL = null;
                document.getElementById('profilePreview').src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
            }
        } else {
            AppState = getInitialAppState(); 
            if (user.displayName) AppState.user.name = user.displayName;
            if (user.photoURL) {
                AppState.user.photoURL = user.photoURL;
                document.getElementById('profilePreview').src = user.photoURL;
            }
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

// --- 로그인 ---
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
        } else { 
            await signInWithEmailAndPassword(auth, email, pw);
        }
    } catch (error) {
        console.error(error); alert("인증 오류: " + error.message);
    } finally {
        btn.innerText = AppState.isLoginMode ? i18n[AppState.currentLang].btn_login_submit : i18n[AppState.currentLang].btn_signup_submit;
        btn.disabled = false;
    }
}

async function simulateGoogleLogin() { 
    try { await signInWithPopup(auth, googleProvider); } 
    catch(e) { console.error(e); alert("Google 로그인 오류:\n" + e.message); }
}

async function logout() {
    try {
        await fbSignOut(auth);
        localStorage.clear(); 
        window.location.reload(); 
    } catch(e) { console.error("로그아웃 오류:", e); }
}

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    const pwConfirm = document.getElementById('login-pw-confirm');
    const pwHint = document.getElementById('pw-hint');
    const disclaimerBox = document.getElementById('disclaimer-box');
    
    if(AppState.isLoginMode) {
        btnSubmit.setAttribute('data-i18n', 'btn_login_submit'); toggleText.setAttribute('data-i18n', 'auth_toggle_signup');
        pwConfirm.classList.add('d-none'); pwHint.classList.add('d-none'); disclaimerBox.classList.add('d-none');
    } else {
        btnSubmit.setAttribute('data-i18n', 'btn_signup_submit'); toggleText.setAttribute('data-i18n', 'auth_toggle_login');
        pwConfirm.classList.remove('d-none'); pwHint.classList.remove('d-none'); disclaimerBox.classList.remove('d-none');
    }
    changeLanguage(AppState.currentLang); 
}

function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (i18n[langCode][key]) el.setAttribute('placeholder', i18n[langCode][key]);
    });

    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart(); renderUsers(AppState.social.sortCriteria); renderQuestList(); updatePointUI(); updateDungeonStatus();
        if(!document.getElementById('titleModal').classList.contains('d-none')) renderHistoryModal();
        loadPlayerName();
    }
}

function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    // ★ 수정됨: 탭 이동 시 스크롤 동적 제어 (상태창에서만 잠금) ★
    const mainEl = document.querySelector('main');
    if(tabId === 'status') { 
        mainEl.style.overflowY = 'hidden'; 
        drawRadarChart(); updatePointUI(); 
    } else {
        mainEl.style.overflowY = 'auto';
    }
    
    if(tabId === 'social') { fetchSocialData(); } 
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); }
    if(tabId === 'dungeon') { updateDungeonStatus(); }
}

function loadPlayerName() {
    document.getElementById('prof-name').textContent = AppState.user.name;
    document.getElementById('prof-name').removeAttribute('data-i18n'); 
}

function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt);
    if (newName && newName.trim() !== "") {
        AppState.user.name = newName.trim(); 
        document.getElementById('prof-name').textContent = AppState.user.name;
        document.getElementById('prof-name').removeAttribute('data-i18n');
        saveUserData(); 
        renderUsers(AppState.social.sortCriteria);
    }
}

function changeTheme() {
    const isLight = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : '');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    let themeMeta = document.querySelector('meta[name="theme-color"]') || document.createElement('meta');
    themeMeta.name = "theme-color"; themeMeta.content = isLight ? "#ffffff" : "#050508";
    document.head.appendChild(themeMeta);
}

function openTitleModal() { renderHistoryModal(); document.getElementById('titleModal').classList.remove('d-none'); document.getElementById('titleModal').classList.add('d-flex'); }
function closeTitleModal() { document.getElementById('titleModal').classList.remove('d-flex'); document.getElementById('titleModal').classList.add('d-none'); }
function renderHistoryModal() {
    const container = document.getElementById('history-list-container'); container.innerHTML = '';
    [...AppState.user.titleHistory].reverse().forEach(hist => {
        container.innerHTML += `<div class="history-item"><span class="hist-lvl">Lv. ${hist.level}</span><span class="hist-title">${hist.title[AppState.currentLang]}</span></div>`;
    });
}

// --- 정보 모달 및 표 렌더링 로직 ---
function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('d-flex');
    document.getElementById('infoModal').classList.add('d-none');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_quest_title;
    const body = document.getElementById('info-modal-body');
    
    let tableHtml = `<table class="info-table">
        <thead>
            <tr><th>${i18n[AppState.currentLang].th_day}</th><th>${i18n[AppState.currentLang].th_stat}</th><th>${i18n[AppState.currentLang].th_quest}</th></tr>
        </thead>
        <tbody>`;
    
    const dayNames = { ko: ["일","월","화","수","목","금","토"], en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja: ["日","月","火","水","木","金","土"] };
    
    weeklyQuestData.forEach((dayQuests, dayIdx) => {
        dayQuests.forEach((q, idx) => {
            let rowSpan = '';
            if(idx === 0) rowSpan = `rowspan="${dayQuests.length}" style="text-align:center; font-weight:bold; background:rgba(255,255,255,0.05);"`;
            
            tableHtml += `<tr>
                ${idx === 0 ? `<td ${rowSpan}>${dayNames[AppState.currentLang][dayIdx]}</td>` : ''}
                <td><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">${q.stat}</span></td>
                <td>${q.title[AppState.currentLang]}<br><span style="font-size:0.65rem; color:var(--text-sub);">${q.desc[AppState.currentLang]}</span></td>
            </tr>`;
        });
    });
    tableHtml += `</tbody></table>`;
    body.innerHTML = tableHtml;
    
    document.getElementById('infoModal').classList.remove('d-none');
    document.getElementById('infoModal').classList.add('d-flex');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_dungeon_title;
    const body = document.getElementById('info-modal-body');
    
    let tableHtml = `<table class="info-table">
        <thead>
            <tr><th>${i18n[AppState.currentLang].th_stat}</th><th>${i18n[AppState.currentLang].th_raid}</th><th>${i18n[AppState.currentLang].th_req}</th></tr>
        </thead>
        <tbody>`;
    
    Object.keys(raidMissions).forEach(key => {
        const mission = raidMissions[key];
        tableHtml += `<tr>
            <td><span class="quest-stat-tag" style="border-color:${mission.color}; color:${mission.color};">${mission.stat}</span></td>
            <td style="color:var(--text-main); font-weight:bold;">${mission.title[AppState.currentLang]}</td>
            <td style="color:var(--text-sub);">${mission.desc2[AppState.currentLang]}</td>
        </tr>`;
    });
    tableHtml += `</tbody></table>`;
    body.innerHTML = tableHtml;
    
    document.getElementById('infoModal').classList.remove('d-none');
    document.getElementById('infoModal').classList.add('d-flex');
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
        
        saveUserData(); 
        updatePointUI(); drawRadarChart(); renderUsers(AppState.social.sortCriteria);
        alert(`Level Up! [Lv.${AppState.user.level}]\n새로운 칭호 획득: ${newTitleObj[AppState.currentLang]}`);
    }
}

function updatePointUI() {
    const reqPts = getReqPoints(AppState.user.level);
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = reqPts;
    const btn = document.getElementById('btn-levelup');
    if(AppState.user.points >= reqPts) { btn.disabled = false; btn.style.background = "var(--neon-gold)"; btn.style.color = "black"; btn.style.boxShadow = "0 0 15px var(--neon-gold)"; } 
    else { btn.disabled = true; btn.style.background = "#444"; btn.style.color = "#777"; btn.style.boxShadow = "none"; }
    document.getElementById('prof-title-badge').innerText = AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title[AppState.currentLang];
    statKeys.forEach(k => {
        const pendEl = document.getElementById(`pendVal_${k}`); const pVal = AppState.user.pendingStats[k];
        if (pVal > 0) pendEl.textContent = `(+${pVal.toFixed(1).replace('.0', '')})`; else if (pVal < 0) pendEl.textContent = `(${pVal.toFixed(1).replace('.0', '')})`; else pendEl.textContent = "";
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
        const barVal = document.getElementById(`barVal_${key}`); if(barVal) barVal.textContent = val;
        const barFill = document.getElementById(`barFill_${key}`); if(barFill) setTimeout(() => { barFill.style.width = `${val}%`; }, 100);
    }
    pointsGroup.innerHTML = pointsHtml; labelsGroup.innerHTML = labelsHtml;
    const playerPolygon = document.getElementById('playerPolygon');
    if(!playerPolygon.getAttribute('points')) playerPolygon.setAttribute('points', "50,50 50,50 50,50 50,50 50,50 50,50"); 
    setTimeout(() => { playerPolygon.setAttribute('points', dataPoints.trim()); }, 50);
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
    const day = AppState.quest.currentDayOfWeek; const state = AppState.quest.completedState[day]; const q = weeklyQuestData[day][idx]; const sKey = q.stat.toLowerCase();
    state[idx] = !state[idx];
    if(state[idx]) { AppState.user.points += 20; AppState.user.pendingStats[sKey] += 0.5; } else { AppState.user.points -= 20; AppState.user.pendingStats[sKey] -= 0.5; }
    
    saveUserData(); 
    renderQuestList(); renderCalendar(); updatePointUI(); 
}

function renderCalendar() {
    const calGrid = document.getElementById('calendar-grid'); const today = new Date(); const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - AppState.quest.currentDayOfWeek);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('cal-month').innerText = `${monthNames[startOfWeek.getMonth()]} ${startOfWeek.getFullYear()}`;
    const dayNames = { ko: ["일","월","화","수","목","금","토"], en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja: ["日","月","火","水","木","金","土"] };
    let htmlStr = '';
    for (let i = 0; i < 7; i++) {
        const cDate = new Date(startOfWeek); cDate.setDate(startOfWeek.getDate() + i); const count = AppState.quest.completedState[i].filter(v => v).length;
        htmlStr += `<div class="cal-day ${i === AppState.quest.currentDayOfWeek ? 'today' : ''}"><div class="cal-name">${dayNames[AppState.currentLang][i]}</div><div class="cal-date">${cDate.getDate()}</div><div class="cal-score">${count}/12</div></div>`;
    }
    calGrid.innerHTML = htmlStr;
}

function updateDungeonStatus() {
    const now = new Date(); const h = now.getHours(); const m = now.getMinutes(); const timeVal = h + m / 60;
    
    let currentSlot = 0;
    if (timeVal >= 6 && timeVal < 8) currentSlot = 1; 
    else if (timeVal >= 11.5 && timeVal < 13.5) currentSlot = 2; 
    else if (timeVal >= 19 && timeVal < 21) currentSlot = 3;

    const dateStr = now.toDateString(); 
    
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== currentSlot) {
        AppState.dungeon.lastGeneratedDate = dateStr; 
        AppState.dungeon.slot = currentSlot;
        
        if (currentSlot > 0) { 
            AppState.dungeon.stationIdx = Math.floor(Math.random() * seoulStations.length); 
            AppState.dungeon.participants = Math.floor(Math.random() * 91) + 10; 
            AppState.dungeon.isJoined = false; 
            AppState.dungeon.isCleared = false; 
            AppState.dungeon.progress = 0; 
            const statKeysArr = ['str', 'int', 'cha', 'vit', 'wlth', 'agi']; 
            AppState.dungeon.targetStat = statKeysArr[Math.floor(Math.random() * statKeysArr.length)];
        } else {
            AppState.dungeon.isJoined = false;
        }
        saveUserData();
    }
    
    if (document.getElementById('dungeon').classList.contains('active')) renderDungeon();
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner'); 
    const activeBoard = document.getElementById('dungeon-active-board'); 
    const timer = document.getElementById('raid-timer');
    
    if (AppState.dungeon.slot === 0) {
        timer.classList.add('d-none'); activeBoard.classList.remove('d-flex'); activeBoard.classList.add('d-none'); banner.classList.remove('d-none');
        banner.innerHTML = `<h3 style="color: var(--text-sub); margin: 0 0 10px 0; font-size:1.1rem;">${i18n[AppState.currentLang].raid_waiting}</h3><p style="font-size: 0.8rem; color: var(--text-sub); margin-bottom: 5px;">${i18n[AppState.currentLang].raid_time_info}</p>`;
    } else {
        const mission = raidMissions[AppState.dungeon.targetStat]; const st = seoulStations[AppState.dungeon.stationIdx]; const stName = st.name[AppState.currentLang];
        
        if (!AppState.dungeon.isJoined) {
            timer.classList.add('d-none'); activeBoard.classList.remove('d-flex'); activeBoard.classList.add('d-none'); banner.classList.remove('d-none');
            
            const mapUrl = `https://maps.google.com/maps?q=${st.lat},${st.lng}&hl=${AppState.currentLang}&z=15&output=embed`;
            
            banner.innerHTML = `<div style="display:inline-block; padding:2px 6px; font-size:0.6rem; font-weight:bold; color:${mission.color}; border:1px solid ${mission.color}; border-radius:3px; margin-bottom:5px;">${mission.stat} 요구됨</div><h3 class="raid-boss-title" style="color:${mission.color}; margin: 0 0 10px 0; font-size:1.1rem;">📍 ${stName} - ${mission.title[AppState.currentLang]}</h3><div class="map-container"><iframe src="${mapUrl}" allowfullscreen="" loading="lazy"></iframe></div><p class="text-sm text-main mb-5" style="font-size: 0.8rem; margin-bottom: 5px;">${mission.desc1[AppState.currentLang]}</p><div class="raid-participants" style="font-size: 0.8rem; margin: 12px 0; font-weight:bold;">${i18n[AppState.currentLang].raid_part} <span class="text-blue">${AppState.dungeon.participants}</span> 명</div><button id="btn-raid-join" class="btn-primary" style="background:${mission.color}; border-color:${mission.color}; margin-top:10px; color:black;">작전 합류 (입장)</button>`;
            document.getElementById('btn-raid-join').addEventListener('click', joinDungeon);
        } else {
            banner.classList.add('d-none'); activeBoard.classList.remove('d-none'); activeBoard.classList.add('d-flex'); timer.classList.remove('d-none'); 
            
            document.getElementById('active-stat-badge').innerText = mission.stat; 
            document.getElementById('active-stat-badge').style.color = mission.color; 
            document.getElementById('active-stat-badge').style.borderColor = mission.color;
            document.getElementById('active-raid-title').innerText = mission.title[AppState.currentLang]; 
            document.getElementById('active-raid-desc').innerHTML = mission.desc2[AppState.currentLang];
            
            document.getElementById('raid-part-count').innerText = AppState.dungeon.participants;
            document.getElementById('raid-progress-bar').style.width = `${AppState.dungeon.progress}%`; 
            document.getElementById('raid-progress-text').innerText = `${AppState.dungeon.progress}%`;
            
            const btnAction = document.getElementById('btn-raid-action'); 
            const btnComplete = document.getElementById('btn-raid-complete');
            btnAction.innerText = mission.actionText[AppState.currentLang]; 
            
            if (AppState.dungeon.isCleared) {
                btnAction.classList.add('d-none'); btnComplete.classList.remove('d-none'); btnComplete.innerText = "레이드 정산 완료됨"; btnComplete.disabled = true; btnComplete.style.background = "#444"; document.getElementById('raid-progress-text').innerText = "100% (CLEAR)";
            } else if (AppState.dungeon.progress >= 100) {
                btnAction.classList.add('d-none'); btnComplete.classList.remove('d-none'); btnComplete.onclick = completeDungeon;
            } else {
                btnAction.classList.remove('d-none'); btnComplete.classList.add('d-none'); btnAction.onclick = simulateRaidAction;
            }
        }
    }
}

function joinDungeon() { 
    if(AppState.dungeon.isJoined) return; 
    AppState.dungeon.isJoined = true; 
    AppState.dungeon.participants++; 
    AppState.dungeon.progress = Math.floor(Math.random() * 31) + 30; 
    saveUserData(); 
    renderDungeon(); 
}

function simulateRaidAction() { 
    if (AppState.dungeon.progress >= 100) return;

    const contribution = Math.floor(Math.random() * 11) + 5; 
    AppState.dungeon.progress += contribution;
    
    if (AppState.dungeon.progress > 100) AppState.dungeon.progress = 100;

    const btnAction = document.getElementById('btn-raid-action');
    const originalText = btnAction.innerText;
    btnAction.innerText = `기여 완료! (+${contribution}%)`; 
    btnAction.disabled = true;
    
    saveUserData(); 
    renderDungeon(); 

    setTimeout(() => { 
        if (AppState.dungeon.progress < 100) {
            btnAction.innerText = originalText;
            btnAction.disabled = false;
        }
    }, 500); 
}

function completeDungeon() {
    if(AppState.dungeon.isCleared) return;
    const target = AppState.dungeon.targetStat; const multiplier = Math.floor(Math.random() * 3) + 1; const pts = 100 * multiplier; const statInc = 3.0 * multiplier; 
    AppState.user.points += pts; AppState.user.pendingStats[target] += statInc; AppState.dungeon.isCleared = true;
    saveUserData(); renderDungeon(); updatePointUI();
    alert(`[SYSTEM] 아노말리 진압 완료.\n결속 보상: ${pts} P\n성장 데이터: ${target.toUpperCase()} +${statInc}`);
}

async function fetchSocialData() {
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        let players = [];
        let myFriends = AppState.user.friends || [];
        
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data(); const uid = docSnap.id; const isMe = auth.currentUser && auth.currentUser.uid === uid;
            const isFriendCheck = myFriends.some(fid => String(fid) === String(uid));

            let userTitle = { ko: "신규 각성자", en: "New Awakened", ja: "新規覚醒者" };
            if (data.titleHistoryStr) {
                const hist = JSON.parse(data.titleHistoryStr);
                userTitle = hist[hist.length - 1].title;
            }

            players.push({
                id: uid, name: data.name || "신규 헌터", title: userTitle,
                str: data.stats?.str || 0, int: data.stats?.int || 0, cha: data.stats?.cha || 0, vit: data.stats?.vit || 0, wlth: data.stats?.wlth || 0, agi: data.stats?.agi || 0,
                photoURL: data.photoURL || null, isMe: isMe, isFriend: isFriendCheck
            });
        });
        AppState.social.users = players; renderUsers(AppState.social.sortCriteria);
    } catch(e) { console.error("소셜 로드 에러:", e); }
}

function toggleSocialMode(mode, btn) { AppState.social.mode = mode; document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); document.getElementById('ranking-controls').style.display = mode === 'global' ? 'flex' : 'none'; renderUsers(AppState.social.sortCriteria); }

function renderUsers(criteria, btn = null) {
    if(btn) { AppState.social.sortCriteria = criteria; document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    const container = document.getElementById('user-list-container');
    if(!auth.currentUser) return;
    
    AppState.social.users.forEach(u => u.total = u.str + u.int + u.cha + u.vit + u.wlth + u.agi);
    let dUsers = [...AppState.social.users];
    
    if(AppState.social.mode === 'friends') dUsers = dUsers.filter(u => u.isFriend);
    dUsers.sort((a, b) => b[criteria] - a[criteria]);
    
    if(dUsers.length === 0) { container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub);">${i18n[AppState.currentLang].no_friend}</div>`; return; }
    
    let htmlStr = '';
    dUsers.forEach((user, i) => {
        const rDisp = AppState.social.mode === 'global' ? `<div style="font-size:1.1rem; font-weight:bold; color:var(--text-sub); width:25px; text-align:center;">${i+1}</div>` : '';
        let fBtn = '';
        if(!user.isMe) { 
            fBtn = user.isFriend ? `<button class="btn-friend added" data-id="${user.id}">${i18n[AppState.currentLang].btn_added}</button>` : `<button class="btn-friend" data-id="${user.id}">${i18n[AppState.currentLang].btn_add}</button>`; 
        }
        const profileImg = user.photoURL ? `<img src="${user.photoURL}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);">` : `<div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`;
        const tDisp = typeof user.title === 'object' ? user.title[AppState.currentLang] : user.title; const nDisp = typeof user.name === 'object' ? user.name[AppState.currentLang] : user.name;
        htmlStr += `<div class="user-card ${user.isMe ? 'my-rank' : ''}">${rDisp}<div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">${profileImg}<div class="user-info" style="margin-left:0;"><div class="title-badge">${tDisp}</div><div style="font-size:0.95rem;">${nDisp}</div></div></div><div class="user-score">${user[criteria]}</div>${fBtn}</div>`;
    });
    container.innerHTML = htmlStr;
    
    document.querySelectorAll('.btn-friend').forEach(btn => { 
        btn.addEventListener('click', () => toggleFriend(btn.dataset.id)); 
    });
}

async function toggleFriend(targetUid) {
    if(!auth.currentUser) return;
    const targetStr = String(targetUid);
    const myRef = doc(db, "users", auth.currentUser.uid); 
    const targetUser = AppState.social.users.find(u => String(u.id) === targetStr);
    
    if(targetUser.isFriend) {
        await updateDoc(myRef, { friends: arrayRemove(targetStr) }); 
        AppState.user.friends = AppState.user.friends.filter(id => String(id) !== targetStr); 
        alert("친구 목록에서 삭제되었습니다.");
    } else {
        await updateDoc(myRef, { friends: arrayUnion(targetStr) }); 
        if(!AppState.user.friends) AppState.user.friends = []; 
        AppState.user.friends.push(targetStr); 
        alert("내 친구로 추가되었습니다.");
    }
    fetchSocialData(); 
}

function toggleGPS() {
    const isChecked = document.getElementById('gps-toggle').checked; const statusDiv = document.getElementById('gps-status'); statusDiv.style.display = 'flex';
    if(isChecked) {
        statusDiv.innerHTML = '...';
        if ("geolocation" in navigator) navigator.geolocation.getCurrentPosition(() => statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].gps_on}</span>`, () => { statusDiv.innerHTML = `<span style="color:var(--neon-red);">${i18n[AppState.currentLang].gps_err}</span>`; document.getElementById('gps-toggle').checked = false; });
    } else statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].gps_off}</span>`;
}

function toggleHealthSync() {
    const isChecked = document.getElementById('sync-toggle').checked; const statusDiv = document.getElementById('sync-status'); statusDiv.style.display = 'flex';
    if(isChecked) {
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_req}</span>`;
        setTimeout(() => {
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].sync_done}</span>`;
            AppState.user.stats.str = Math.min(100, AppState.user.stats.str + 3); AppState.user.stats.vit = Math.min(100, AppState.user.stats.vit + 2); AppState.user.points += 50; 
            saveUserData(); updatePointUI(); drawRadarChart();
        }, 2000);
    } else statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_off}</span>`;
}
