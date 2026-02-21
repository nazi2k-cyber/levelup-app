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
        dungeon: { lastGeneratedDate: null, slot: 0, stationIdx: 0, maxParticipants: 5, globalParticipants: 0, globalProgress: 0, isJoined: false, hasContributed: false, targetStat: 'str', isCleared: false },
    };
}

// --- 앱 초기 로드 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindEvents();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadUserDataFromDB(user); 
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            
            document.querySelector('main').style.overflowY = 'auto'; 
            
            changeLanguage(AppState.currentLang); 
            renderCalendar(); 
            updatePointUI(); 
            drawRadarChart(); 
            updateDungeonStatus();
            startRaidTimer(); 
            renderQuestList(); 
            fetchSocialData(); 
            
            if (AppState.user.syncEnabled) { syncHealthData(false); }
        } else {
            document.getElementById('login-screen').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-none');
        }
    });

    setInterval(() => {
        updateDungeonStatus();
        if(document.getElementById('dungeon').classList.contains('active')) {
            window.syncGlobalDungeon();
        }
    }, 30000); 
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
    
    document.getElementById('btn-raid-action').addEventListener('click', window.simulateRaidAction);
    document.getElementById('btn-raid-complete').addEventListener('click', window.completeDungeon);
}

// --- 데이터 저장/로드 ---
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
    } catch(e) { console.error("DB 저장 실패:", e); }
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
            if(data.dungeonStr) {
                AppState.dungeon = JSON.parse(data.dungeonStr);
                if(!AppState.dungeon.maxParticipants) AppState.dungeon.maxParticipants = 5; 
                if(AppState.dungeon.hasContributed === undefined) AppState.dungeon.hasContributed = false; 
                AppState.dungeon.globalParticipants = 0;
                AppState.dungeon.globalProgress = 0;
            }
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
    } catch(e) { console.error("데이터 로드 에러:", e); }
}

function loadPlayerName() { 
    const nameEl = document.getElementById('prof-name');
    if(nameEl) {
        nameEl.textContent = AppState.user.name; 
        nameEl.removeAttribute('data-i18n'); 
    }
}

function changePlayerName() {
    const newName = prompt(i18n[AppState.currentLang].name_prompt || "닉네임 변경", AppState.user.name);
    if (newName && newName.trim() !== "") {
        AppState.user.name = newName.trim();
        loadPlayerName(); 
        saveUserData().then(() => fetchSocialData());
    }
}

function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt || "인스타 ID를 입력하세요", AppState.user.instaId);
    if (newId !== null) { 
        AppState.user.instaId = newId.trim().replace('@', ''); 
        saveUserData().then(() => fetchSocialData());
    }
}

// --- 스탯 레이더 ---
function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33; 
    const angles = []; 
    for(let i=0; i<6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));
    
    const gridGroup = document.getElementById('radarGrid'); 
    const axesGroup = document.getElementById('radarAxes');
    
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
    
    const pointsGroup = document.getElementById('radarPoints'); 
    const labelsGroup = document.getElementById('radarLabels');
    let pointsHtml = ''; let labelsHtml = ''; let dataPoints = ""; let totalSum = 0;
    
    for (let i = 0; i < 6; i++) {
        const key = statKeys[i]; 
        const val = Number(AppState.user.stats[key]) || 0; 
        totalSum += val;
        
        const r = radius * (val / 100); 
        const x = centerX + r * Math.cos(angles[i]); 
        const y = centerY + r * Math.sin(angles[i]);
        dataPoints += `${x},${y} `; 
        pointsHtml += `<circle cx="${x}" cy="${y}" r="1.2" class="radar-point"></circle>`;
        
        const labelRadius = radius + 9; 
        const lx = centerX + labelRadius * Math.cos(angles[i]); 
        const ly = centerY + labelRadius * Math.sin(angles[i]) + 2; 
        let anchor = "middle"; 
        if(i===1 || i===2) anchor = "start"; 
        if(i===4 || i===5) anchor = "end";   
        
        labelsHtml += `<text x="${lx}" y="${ly - 3}" text-anchor="${anchor}" class="radar-label">${i18n[AppState.currentLang][key]}</text><text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" class="radar-value">${val}</text>`;
    }
    
    pointsGroup.innerHTML = pointsHtml; 
    labelsGroup.innerHTML = labelsHtml;
    
    const playerPolygon = document.getElementById('playerPolygon');
    if(!playerPolygon.getAttribute('points')) playerPolygon.setAttribute('points', "50,50 50,50 50,50 50,50 50,50 50,50"); 
    setTimeout(() => { playerPolygon.setAttribute('points', dataPoints.trim()); }, 50);
    
    const totalScoreEl = document.getElementById('totalScore');
    if(totalScoreEl) totalScoreEl.innerHTML = `${totalSum}`;
}

// --- 퀘스트 로직 ---
function renderQuestList() {
    const container = document.getElementById('quest-list-container');
    if(!container) return;
    
    const day = AppState.quest.currentDayOfWeek;
    const quests = weeklyQuestData[day];
    
    container.innerHTML = quests.map((q, i) => {
        const isDone = AppState.quest.completedState[day][i];
        return `
            <div class="quest-row ${isDone ? 'done' : ''}" onclick="window.toggleQuest(${i})">
                <div>
                    <div class="quest-title"><span class="quest-stat-tag">${q.stat}</span>${q.title[AppState.currentLang]}</div>
                    <div class="quest-desc">${q.desc[AppState.currentLang]}</div>
                </div>
                <div class="quest-checkbox"></div>
            </div>
        `;
    }).join('');
}

window.toggleQuest = (i) => {
    const day = AppState.quest.currentDayOfWeek;
    const state = AppState.quest.completedState[day];
    state[i] = !state[i];
    
    const q = weeklyQuestData[day][i];
    const factor = state[i] ? 1 : -1;
    
    AppState.user.points += (20 * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (0.5 * factor);
    
    saveUserData(); 
    renderQuestList(); 
    renderCalendar(); 
    updatePointUI();
};

function renderCalendar() {
    const container = document.getElementById('calendar-grid');
    if(!container) return;
    
    const today = new Date();
    const currentDay = today.getDay(); 
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDay);
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthEl = document.getElementById('cal-month');
    if(monthEl) {
        monthEl.innerText = `${startOfWeek.getFullYear()} ${monthNames[startOfWeek.getMonth()]}`;
    }
    
    const dayNames = { 
        ko: ["일","월","화","수","목","금","토"], 
        en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], 
        ja: ["日","月","火","水","木","金","土"] 
    };
    
    container.innerHTML = AppState.quest.completedState.map((s, i) => {
        const iterDate = new Date(startOfWeek);
        iterDate.setDate(startOfWeek.getDate() + i); 
        const isToday = (i === AppState.quest.currentDayOfWeek);
        const count = s.filter(v=>v).length;
        
        return `
            <div class="cal-day ${isToday ? 'today' : ''}">
                <div class="cal-name">${dayNames[AppState.currentLang][i]}</div>
                <div class="cal-date">${iterDate.getDate()}</div>
                <div class="cal-score">${count}/12</div>
            </div>
        `;
    }).join('');
}

// --- 던전 로직 ---
let raidTimerInterval = null;

function getFixedDungeonData(dateStr, slot) {
    const seedStr = dateStr + "_slot" + slot;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    return {
        stationIdx: hash % seoulStations.length,
        targetStat: statKeys[hash % statKeys.length]
    };
}

function startRaidTimer() {
    if(raidTimerInterval) clearInterval(raidTimerInterval);
    
    raidTimerInterval = setInterval(() => {
        const timerEl = document.getElementById('raid-timer');
        if(!timerEl || AppState.dungeon.slot === 0) return;

        const now = new Date();
        let endHour = 0;

        if (AppState.dungeon.slot === 1) endHour = 9;
        else if (AppState.dungeon.slot === 2) endHour = 14;
        else if (AppState.dungeon.slot === 3) endHour = 21;

        const endTime = new Date(now);
        endTime.setHours(endHour, 0, 0, 0);

        const diff = endTime.getTime() - now.getTime();

        if (diff <= 0) {
            timerEl.innerText = "00:00:00";
            updateDungeonStatus(); 
        } else {
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            timerEl.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }, 1000);
}

window.syncGlobalDungeon = async () => {
    if (AppState.dungeon.slot === 0 || !auth.currentUser) return;
    try {
        const snap = await getDocs(collection(db, "users"));
        let realParticipants = 0;
        let realProgressCount = 0;
        const targetDate = AppState.dungeon.lastGeneratedDate;
        const targetSlot = AppState.dungeon.slot;

        snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.dungeonStr) {
                try {
                    const dng = JSON.parse(data.dungeonStr);
                    if (dng.lastGeneratedDate === targetDate && dng.slot === targetSlot && dng.isJoined) {
                        realParticipants++;
                        if (dng.hasContributed) realProgressCount++; 
                    }
                } catch(e) {}
            }
        });

        AppState.dungeon.globalParticipants = realParticipants;
        AppState.dungeon.globalProgress = Math.min(100, (realProgressCount / AppState.dungeon.maxParticipants) * 100);

        if (document.getElementById('dungeon').classList.contains('active')) {
            renderDungeon();
        }
    } catch (e) {
        console.error("글로벌 동기화 에러:", e);
    }
};

function updateDungeonStatus() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const timeVal = h + m / 60;
    
    let currentSlot = 0;
    if (timeVal >= 6 && timeVal < 9) currentSlot = 1; 
    else if (timeVal >= 11 && timeVal < 14) currentSlot = 2; 
    else if (timeVal >= 18 && timeVal < 21) currentSlot = 3;

    const dateStr = now.toDateString(); 
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== currentSlot) {
        AppState.dungeon.lastGeneratedDate = dateStr; 
        AppState.dungeon.slot = currentSlot;
        
        if (currentSlot > 0) { 
            const fixedData = getFixedDungeonData(dateStr, currentSlot);
            AppState.dungeon.stationIdx = fixedData.stationIdx;
            AppState.dungeon.targetStat = fixedData.targetStat;
            
            AppState.dungeon.maxParticipants = 5; 
            
            AppState.dungeon.isJoined = false; 
            AppState.dungeon.hasContributed = false;
            AppState.dungeon.isCleared = false; 
            
            AppState.dungeon.globalParticipants = 0;
            AppState.dungeon.globalProgress = 0;
        } else {
            AppState.dungeon.isJoined = false;
        }
        saveUserData();
    }
    renderDungeon();
    
    if (currentSlot > 0) {
        window.syncGlobalDungeon();
    }
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner');
    const activeBoard = document.getElementById('dungeon-active-board');
    const timer = document.getElementById('raid-timer');
    if(!banner || !activeBoard) return;

    if (AppState.dungeon.slot === 0) {
        if(timer) timer.classList.add('d-none');
        activeBoard.classList.add('d-none'); 
        banner.classList.remove('d-none');
        
        const timeStr = AppState.currentLang === 'ko' ? "출현 시간: 06:00~09:00 | 11:00~14:00 | 18:00~21:00" : "Open: 06:00~09:00 | 11:00~14:00 | 18:00~21:00";
        banner.innerHTML = `<h3 style="color:var(--text-sub); margin:0; padding:20px 0;">${i18n[AppState.currentLang].raid_waiting}</h3><p style="font-size: 0.8rem; color: var(--text-sub); margin-bottom: 5px;">${timeStr}</p>`;
    } else {
        const m = raidMissions[AppState.dungeon.targetStat];
        const st = seoulStations[AppState.dungeon.stationIdx];
        
        if (!AppState.dungeon.isJoined) {
            if(timer) timer.classList.add('d-none');
            activeBoard.classList.add('d-none'); 
            banner.classList.remove('d-none');
            
            const mapUrl = `https://maps.google.com/maps?q=${st.lat},${st.lng}&hl=${AppState.currentLang}&z=15&output=embed`;
            
            const isFull = AppState.dungeon.globalParticipants >= AppState.dungeon.maxParticipants;
            const joinBtnHtml = isFull 
                ? `<button disabled class="btn-primary" style="background:#333; border-color:#333; margin-top:10px; color:#888; font-weight:bold; cursor:not-allowed;">정원 초과 (입장 불가)</button>`
                : `<button onclick="window.joinDungeon()" class="btn-primary" style="background:${m.color}; border-color:${m.color}; margin-top:10px; color:black; font-weight:bold;">작전 합류 (입장)</button>`;

            banner.innerHTML = `
                <div style="display:inline-block; padding:2px 6px; font-size:0.6rem; font-weight:bold; color:${m.color}; border:1px solid ${m.color}; border-radius:3px; margin-bottom:5px;">${m.stat} 요구됨</div>
                <h3 class="raid-boss-title" style="color:${m.color}; margin: 0 0 10px 0; font-size:1.1rem;">📍 ${st.name[AppState.currentLang]} - ${m.title[AppState.currentLang]}</h3>
                <div class="map-container" style="width:100%; height:180px; border-radius:6px; overflow:hidden; margin-bottom:12px; border:1px solid var(--border-color);">
                    <iframe src="${mapUrl}" style="width:100%; height:100%; border:none;" allowfullscreen="" loading="lazy"></iframe>
                </div>
                <p style="font-size: 0.8rem; margin-bottom: 5px; color:var(--text-main); word-break:keep-all;">${m.desc1[AppState.currentLang]}</p>
                <div style="font-size: 0.8rem; margin: 12px 0; font-weight:bold;">
                    ${i18n[AppState.currentLang].raid_part} 
                    <span class="text-blue">${AppState.dungeon.globalParticipants} / ${AppState.dungeon.maxParticipants}</span> 명
                </div>
                ${joinBtnHtml}
            `;
        } else {
            if(timer) timer.classList.remove('d-none');
            banner.classList.add('d-none'); 
            activeBoard.classList.remove('d-none'); 
            
            document.getElementById('active-stat-badge').innerText = m.stat;
            document.getElementById('active-stat-badge').style.borderColor = m.color;
            document.getElementById('active-stat-badge').style.color = m.color;
            document.getElementById('active-raid-title').innerText = m.title[AppState.currentLang];
            document.getElementById('active-raid-desc').innerText = m.desc2[AppState.currentLang];
            
            document.getElementById('raid-part-count').innerText = `${AppState.dungeon.globalParticipants} / ${AppState.dungeon.maxParticipants}`;
            document.getElementById('raid-progress-bar').style.width = `${AppState.dungeon.globalProgress}%`;
            document.getElementById('raid-progress-text').innerText = `${AppState.dungeon.globalProgress}%`;
            
            const btnAction = document.getElementById('btn-raid-action');
            const btnComplete = document.getElementById('btn-raid-complete');
            
            if (AppState.dungeon.globalProgress >= 100) {
                btnAction.classList.add('d-none');
                btnComplete.classList.remove('d-none');
                
                if(AppState.dungeon.isCleared) {
                    btnComplete.innerText = "정산 완료";
                    btnComplete.disabled = true;
                    btnComplete.style.background = "#444";
                    btnComplete.style.color = "#888";
                } else {
                    btnComplete.innerText = "전리품 획득";
                    btnComplete.disabled = false;
                    btnComplete.style.background = "var(--neon-gold)";
                    btnComplete.style.color = "black";
                }
            } else {
                btnAction.classList.remove('d-none');
                btnComplete.classList.add('d-none');
                
                if (AppState.dungeon.hasContributed) {
                    btnAction.innerText = "데이터 전송 완료";
                    btnAction.disabled = true;
                    btnAction.style.opacity = "0.5";
                } else {
                    btnAction.innerText = m.actionText[AppState.currentLang];
                    btnAction.disabled = false;
                    btnAction.style.opacity = "1";
                }
            }
        }
    }
}

window.joinDungeon = async () => {
    if(AppState.dungeon.globalParticipants >= AppState.dungeon.maxParticipants) {
        alert("이미 정원이 초과되었습니다.");
        return;
    }
    AppState.dungeon.isJoined = true;
    await saveUserData(); 
    await window.syncGlobalDungeon(); 
};

window.simulateRaidAction = async () => {
    if (AppState.dungeon.hasContributed || AppState.dungeon.globalProgress >= 100) return;
    
    const btn = document.getElementById('btn-raid-action');
    btn.innerText = `데이터 전송 중...`;
    btn.disabled = true;

    AppState.dungeon.hasContributed = true;
    await saveUserData(); 
    await window.syncGlobalDungeon(); 
};

window.completeDungeon = () => {
    if(AppState.dungeon.isCleared) return;
    const target = AppState.dungeon.targetStat;
    const pts = 200;
    const statInc = 2.0;
    
    AppState.user.points += pts;
    AppState.user.pendingStats[target] += statInc;
    AppState.dungeon.isCleared = true;
    
    saveUserData(); 
    renderDungeon(); 
    updatePointUI();
    alert(`[SYSTEM] 아노말리 진압 완료.\n결속 보상: ${pts} P\n성장 데이터: ${target.toUpperCase()} +${statInc}`);
};

// --- 공통 UI ---
function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    const mainEl = document.querySelector('main');
    if(tabId === 'status') { 
        mainEl.style.overflowY = 'auto'; 
        drawRadarChart(); updatePointUI(); 
    } else {
        mainEl.style.overflowY = 'auto';
    }
    
    if(tabId === 'social') fetchSocialData(); 
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); }
    if(tabId === 'dungeon') {
        updateDungeonStatus();
        window.syncGlobalDungeon(); 
    }
}

function updatePointUI() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    
    const titleObj = AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title;
    const titleText = typeof titleObj === 'object' ? titleObj[AppState.currentLang] || titleObj.ko : titleObj;
    document.getElementById('prof-title-badge').innerHTML = `${titleText} ℹ️`;
}

function processLevelUp() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    if(AppState.user.points < req) return;
    AppState.user.points -= req; AppState.user.level++;
    statKeys.forEach(k => { 
        AppState.user.stats[k] = Math.min(100, (Number(AppState.user.stats[k])||0) + (Number(AppState.user.pendingStats[k])||0)); 
        AppState.user.pendingStats[k] = 0; 
    });
    const top = statKeys.map(k => ({k, v:AppState.user.stats[k]})).sort((a,b) => b.v - a.v);
    const newTitle = { 
        ko: `${titleVocab[top[0].k].ko.pre[0]} ${titleVocab[top[1].k].ko.suf[0]}`,
        en: `${titleVocab[top[0].k].en.pre[0]} ${titleVocab[top[1].k].en.suf[0]}`
    };
    AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitle });
    
    saveUserData(); updatePointUI(); drawRadarChart();
    alert("Level Up!");
    openTitleModal();
}

function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    
    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart(); 
        renderUsers(AppState.social.sortCriteria); 
        renderQuestList(); 
        renderCalendar(); 
        renderQuote();
        updatePointUI(); 
        updateDungeonStatus();
        loadPlayerName(); 
    }
}

// --- 외부 API 연동 명언 ---
async function renderQuote() {
    const quoteEl = document.getElementById('daily-quote');
    const authorEl = document.getElementById('daily-quote-author');
    if(!quoteEl || !authorEl) return;

    try {
        quoteEl.innerText = "위성 통신망에서 데이터를 수신 중입니다...";
        authorEl.innerText = "";

        let apiUrl = 'https://korean-advice-open-api.vercel.app/api/advice';
        if (AppState.currentLang === 'en' || AppState.currentLang === 'ja') {
            apiUrl = 'https://dummyjson.com/quotes/random';
        }

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("API 통신 에러");

        const data = await response.json();
        const quoteText = data.message || data.quote;
        const quoteAuthor = data.author || "Unknown";

        quoteEl.style.opacity = 0;
        authorEl.style.opacity = 0;
        
        setTimeout(() => {
            quoteEl.innerText = `"${quoteText}"`;
            authorEl.innerText = `- ${quoteAuthor} -`;
            quoteEl.style.opacity = 1;
            quoteEl.style.transition = "opacity 0.5s ease-in";
            authorEl.style.opacity = 1;
            authorEl.style.transition = "opacity 0.5s ease-in";
        }, 300);

    } catch (error) {
        console.error("명언 API 호출 실패:", error);
        quoteEl.innerText = `"어떠한 시련 속에서도 꾸준함은 시스템을 지탱하는 가장 강력한 무기이다."`;
        authorEl.innerText = `- System Offline -`;
        quoteEl.style.opacity = 1;
        authorEl.style.opacity = 1;
    }
}

// --- 소셜 탭 ---
async function fetchSocialData() {
    try {
        const snap = await getDocs(collection(db, "users"));
        AppState.social.users = snap.docs.map(d => {
            const data = d.data();
            let title = "각성자";
            if (data.titleHistoryStr) {
                try {
                    const hist = JSON.parse(data.titleHistoryStr);
                    const last = hist[hist.length - 1].title;
                    title = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last;
                } catch(e) {}
            }
            return { id: d.id, ...data, title, stats: data.stats || {str:0,int:0,cha:0,vit:0,wlth:0,agi:0}, isFriend: AppState.user.friends.includes(d.id), isMe: auth.currentUser?.uid === d.id };
        });
        renderUsers(AppState.social.sortCriteria);
    } catch(e) { console.error("소셜 로드 에러", e); }
}

function renderUsers(criteria, btn = null) {
    if(btn) { 
        AppState.social.sortCriteria = criteria; 
        document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); 
    }
    const container = document.getElementById('user-list-container');
    if(!container) return;

    let list = AppState.social.users.map(u => {
        const s = u.stats;
        const total = (Number(s.str)||0) + (Number(s.int)||0) + (Number(s.cha)||0) + (Number(s.vit)||0) + (Number(s.wlth)||0) + (Number(s.agi)||0);
        return { ...u, total, str:Number(s.str)||0, int:Number(s.int)||0, cha:Number(s.cha)||0, vit:Number(s.vit)||0, wlth:Number(s.wlth)||0, agi:Number(s.agi)||0 };
    });

    if(AppState.social.mode === 'friends') list = list.filter(u => u.isFriend || u.isMe);
    list.sort((a,b) => b[criteria] - a[criteria]);

    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

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
            ${!u.isMe ? `<button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="window.toggleFriend('${u.id}')">${u.isFriend ? '친구✓' : '추가'}</button>` : ''}
        </div>
    `).join('');
}

window.toggleFriend = async (id) => {
    const isFriend = AppState.user.friends.includes(id);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { friends: isFriend ? arrayRemove(id) : arrayUnion(id) });
    AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
    fetchSocialData();
};

function toggleSocialMode(mode, btn) { 
    AppState.social.mode = mode; 
    document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); 
    btn.classList.add('active'); 
    renderUsers(AppState.social.sortCriteria); 
}

// --- 로그인/인증 로직 ---
async function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const btn = document.getElementById('btn-login-submit');
    if(!email || !pw) { alert("이메일과 비밀번호를 입력해주세요."); return; }
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
    } catch(e) { console.error(e); alert("Google 로그인 실패: " + e.message); }
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

// --- ★ 팝업 모달창 로직 (호칭 표 등) ★ ---
function closeInfoModal() { 
    const m = document.getElementById('infoModal'); 
    m.classList.add('d-none'); 
    m.classList.remove('d-flex'); 
}

function closeTitleModal() { 
    const m = document.getElementById('titleModal'); 
    m.classList.add('d-none'); 
    m.classList.remove('d-flex');
}

function openTitleModal() {
    const container = document.getElementById('title-guide-container');
    
    const html = `
        <div style="font-size:0.8rem; color:var(--text-main); background: rgba(0, 217, 255, 0.05); border: 1px solid var(--neon-blue); padding: 12px; border-radius: 6px; margin-bottom:15px; line-height:1.5; word-break:keep-all;">
            💡 <b style="color:var(--neon-blue);">호칭 조합 공식</b><br>
            레벨업 시 보유한 스탯 점수를 기준으로 <b>[1위 스탯의 접두사] + [2위 스탯의 접미사]</b>가 결합되어 고유 호칭이 부여됩니다.
        </div>

        <table class="info-table">
            <thead>
                <tr>
                    <th>스탯</th>
                    <th>🥇 1위 (접두사)</th>
                    <th>🥈 2위 (접미사)</th>
                </tr>
            </thead>
            <tbody>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">STR</span></td><td>강인한</td><td>전사 / 호랑이</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">INT</span></td><td>예리한</td><td>학자 / 올빼미</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">CHA</span></td><td>매혹적인</td><td>셀럽 / 여우</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">VIT</span></td><td>지치지 않는</td><td>거북이 / 곰</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">WLTH</span></td><td>부유한</td><td>자본가 / 귀족</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">AGI</span></td><td>날렵한</td><td>그림자 / 표범</td></tr>
            </tbody>
        </table>
        <div style="font-size:0.7rem; color:var(--text-sub); margin-top:10px; text-align:right;">※ 스탯 동점 시 시스템 내부 우선순위에 따름</div>
    `;

    container.innerHTML = html;
    const m = document.getElementById('titleModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

function openStatusInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_status_title;
    const body = document.getElementById('info-modal-body');
    let html = `<table class="info-table"><thead><tr><th>${i18n[AppState.currentLang].th_stat}</th><th>${i18n[AppState.currentLang].th_desc}</th></tr></thead><tbody>`;
    statKeys.forEach(k => { 
        html += `<tr><td style="text-align:center"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">${k.toUpperCase()}</span><br><b style="font-size:0.75rem; color:var(--text-main); display:inline-block; margin-top:3px;">${i18n[AppState.currentLang][k]}</b></td><td style="color:var(--text-sub); line-height:1.5;">${i18n[AppState.currentLang]['desc_'+k]}</td></tr>`; 
    });
    body.innerHTML = html + `</tbody></table>`;
    const m = document.getElementById('infoModal'); 
    m.classList.remove('d-none'); 
    m.classList.add('d-flex');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_quest_title || "주간 퀘스트 목록";
    const body = document.getElementById('info-modal-body');
    const dayNames = { ko: ["일","월","화","수","목","금","토"], en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja: ["日","月","火","水","木","金","土"] };
    
    let html = `<table class="info-table">
        <thead>
            <tr>
                <th>${i18n[AppState.currentLang].th_day}</th>
                <th>${i18n[AppState.currentLang].th_stat}</th>
                <th>${i18n[AppState.currentLang].th_quest}</th>
            </tr>
        </thead>
        <tbody>`;
    
    weeklyQuestData.forEach((dayQuests, i) => { 
        dayQuests.forEach((q, j) => {
            const rowSpan = j === 0 ? `<td rowspan="${dayQuests.length}" style="text-align:center; vertical-align:middle; background:rgba(255,255,255,0.05);"><b>${dayNames[AppState.currentLang][i]}</b></td>` : '';
            const title = q.title[AppState.currentLang] || q.title.ko;
            const desc = q.desc[AppState.currentLang] || q.desc.ko;

            html += `<tr>
                ${rowSpan}
                <td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">${q.stat}</span></td>
                <td><b style="color:var(--text-main);">${title}</b><br><span style="font-size:0.65rem; color:var(--text-sub);">${desc}</span></td>
            </tr>`; 
        }); 
    });
    
    body.innerHTML = html + `</tbody></table>`;
    const m = document.getElementById('infoModal'); 
    m.classList.remove('d-none'); 
    m.classList.add('d-flex');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_dungeon_title || "이상 현상 목록";
    const body = document.getElementById('info-modal-body');
    
    const timeInfoHtml = `
        <div style="background:rgba(0, 217, 255, 0.05); border:1px solid var(--neon-blue); padding:8px; border-radius:6px; margin-bottom:10px; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-sub); margin-bottom:3px;">🕒 던전 시스템 개방 시간 (KST)</div>
            <div style="font-weight:bold; color:var(--neon-blue); font-size:0.8rem; letter-spacing:0.5px;">
                06:00~09:00  |  11:00~14:00  |  18:00~21:00
            </div>
        </div>
    `;

    let html = `<table class="info-table">
        <thead>
            <tr>
                <th>${i18n[AppState.currentLang].th_stat}</th>
                <th>${i18n[AppState.currentLang].th_raid}</th>
                <th>${i18n[AppState.currentLang].th_req}</th>
            </tr>
        </thead>
        <tbody>`;
    
    Object.keys(raidMissions).forEach(k => { 
        const m = raidMissions[k];
        const title = m.title[AppState.currentLang] || m.title.ko;
        const reqTask = m.desc2[AppState.currentLang] || m.desc2.ko;

        html += `<tr>
            <td style="text-align:center; vertical-align:middle;"><span class="quest-stat-tag" style="border-color:${m.color}; color:${m.color};">${m.stat}</span></td>
            <td style="word-break:keep-all; font-weight:bold; color:var(--text-main);">${title}</td>
            <td style="word-break:keep-all; color:var(--text-sub); font-size:0.75rem;">${reqTask}</td>
        </tr>`; 
    });
    
    body.innerHTML = timeInfoHtml + html + `</tbody></table>`;
    const m = document.getElementById('infoModal'); 
    m.classList.remove('d-none'); 
    m.classList.add('d-flex');
}

function changeTheme() { 
    const light = document.getElementById('theme-toggle').checked; 
    document.documentElement.setAttribute('data-theme', light ? 'light' : ''); 
    localStorage.setItem('theme', light ? 'light' : 'dark'); 
}

// --- GPS 및 건강 데이터 설정 ---
function toggleGPS() {
    const isChecked = document.getElementById('gps-toggle').checked;
    const statusDiv = document.getElementById('gps-status');
    statusDiv.style.display = 'flex';
    
    if (isChecked) {
        statusDiv.innerHTML = '위치 탐색 중...';
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                () => { statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].gps_on || '위치 권한 활성화됨'}</span>`; },
                () => {
                    statusDiv.innerHTML = `<span style="color:var(--neon-red);">${i18n[AppState.currentLang].gps_err || '위치 정보 오류'}</span>`;
                    document.getElementById('gps-toggle').checked = false;
                }
            );
        } else {
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">지원하지 않는 기기입니다.</span>`;
            document.getElementById('gps-toggle').checked = false;
        }
    } else {
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].gps_off || '위치 탐색 중지됨'}</span>`;
    }
}

function toggleHealthSync() { 
    AppState.user.syncEnabled = document.getElementById('sync-toggle').checked; 
    saveUserData(); 
    if(AppState.user.syncEnabled) syncHealthData(true); 
    else {
        const statusDiv = document.getElementById('sync-status');
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_off || '동기화 해제됨'}</span>`;
    }
}

async function syncHealthData(showMsg = false) {
    if (!AppState.user.syncEnabled) return;

    const statusDiv = document.getElementById('sync-status');
    if(showMsg) {
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">데이터 가져오는 중...</span>`;
    }

    const token = localStorage.getItem('gfit_token');
    if (!token) {
        if (showMsg) statusDiv.innerHTML = `<span style="color:var(--neon-red);">권한 없음. 다시 로그인 필요</span>`;
        AppState.user.syncEnabled = false;
        document.getElementById('sync-toggle').checked = false;
        saveUserData();
        return;
    }

    const now = new Date();
    const todayStr = now.toDateString();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = now.getTime();

    if (!AppState.user.stepData || AppState.user.stepData.date !== todayStr) {
        AppState.user.stepData = { date: todayStr, rewardedSteps: 0 };
    }

    try {
        const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aggregateBy: [{ dataTypeName: 'com.google.step_count.delta', dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps' }],
                bucketByTime: { durationMillis: 86400000 },
                startTimeMillis: startOfDay,
                endTimeMillis: endOfDay
            })
        });

        if (!response.ok) throw new Error("구글 인증 토큰 만료");

        const data = await response.json();
        let totalStepsToday = 0;

        if (data.bucket && data.bucket.length > 0) {
            data.bucket.forEach(b => {
                if (b.dataset && b.dataset[0] && b.dataset[0].point) {
                    b.dataset[0].point.forEach(p => {
                        totalStepsToday += p.value[0].intVal;
                    });
                }
            });
        }

        const unrewardedSteps = totalStepsToday - AppState.user.stepData.rewardedSteps;

        if (unrewardedSteps >= 1000) {
            const rewardChunks = Math.floor(unrewardedSteps / 1000);
            const earnedPoints = rewardChunks * 10;
            const earnedStr = rewardChunks * 0.5;

            AppState.user.points += earnedPoints;
            AppState.user.pendingStats.str += earnedStr;
            AppState.user.stepData.rewardedSteps += (rewardChunks * 1000);

            if (showMsg) {
                statusDiv.innerHTML = `<span style="color:var(--neon-blue);">동기화 완료: 총 ${totalStepsToday.toLocaleString()}보<br>추가 보상: +${earnedPoints}P, STR +${earnedStr}</span>`;
            }
            updatePointUI();
            drawRadarChart();
        } else {
            if (showMsg) {
                if(totalStepsToday === 0) {
                    statusDiv.innerHTML = `<span style="color:var(--neon-gold);">걸음 수 기록이 없습니다. (0보)</span>`;
                } else {
                    statusDiv.innerHTML = `<span style="color:var(--neon-blue);">동기화 완료: 총 ${totalStepsToday.toLocaleString()}보<br>(다음 보상까지 ${1000 - unrewardedSteps}보 남음)</span>`;
                }
            }
        }
        saveUserData();

    } catch (error) {
        console.error("동기화 에러:", error);
        if (showMsg) statusDiv.innerHTML = `<span style="color:var(--neon-red);">동기화 실패. 구글 재로그인 필요.</span>`;
        document.getElementById('sync-toggle').checked = false;
        AppState.user.syncEnabled = false;
    }
}
